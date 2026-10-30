import 'server-only';
import type { Queryable } from '@/lib/db';
import { query } from '@/lib/db';
import { requireAdmin } from './authz';
import type { RequestMeta } from './types';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

/** Append an audit record. The actor label is snapshotted so history survives account changes. */
export async function writeAudit(db: Queryable, e: AuditEntry, meta?: RequestMeta): Promise<void> {
  await db.query(
    `insert into audit_logs (actor_id, actor_label, action, target_type, target_id, details, ip)
     values ($1::uuid,
             coalesce((select username || ' <' || email || '>' from users where id = $1::uuid), 'system'),
             $2, $3, $4, $5::jsonb, $6)`,
    [e.actorId, e.action, e.targetType ?? null, e.targetId ?? null, JSON.stringify(e.details ?? {}), meta?.ip ?? null],
  );
}

export interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  created_at: Date;
}

export async function listAudit(
  adminId: string,
  opts: { page?: number; action?: string; targetType?: string; targetId?: string } = {},
): Promise<{ rows: AuditRow[]; total: number; pageSize: number }> {
  await requireAdmin({ query }, adminId);
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.action) {
    params.push(`${opts.action}%`);
    where.push(`action like $${params.length}`);
  }
  if (opts.targetType) {
    params.push(opts.targetType);
    where.push(`target_type = $${params.length}`);
  }
  if (opts.targetId) {
    params.push(opts.targetId);
    where.push(`target_id = $${params.length}`);
  }
  const w = where.length ? `where ${where.join(' and ')}` : '';
  const total = (await query<{ n: number }>(`select count(*)::bigint as n from audit_logs ${w}`, params)).rows[0].n;
  const rows = (
    await query<AuditRow>(
      `select * from audit_logs ${w} order by id desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
      params,
    )
  ).rows;
  return { rows, total, pageSize };
}

export async function recentActivity(db: Queryable, limit = 10): Promise<AuditRow[]> {
  return (await db.query<AuditRow>(`select * from audit_logs order by id desc limit ${Math.min(limit, 50)}`)).rows;
}
