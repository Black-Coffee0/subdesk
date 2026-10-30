import 'server-only';
import { query, tx } from '@/lib/db';
import { AppError, notFound } from '@/lib/errors';
import { likePattern, parseInput, text } from '@/lib/validation';
import { writeAudit } from './audit';
import { requireAdmin } from './authz';
import { notify } from './notifications';
import type { RequestMeta, Status } from './types';

export interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  email_verified_at: Date | null;
  is_test_data: boolean;
  deletion_requested_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  reddit_username: string | null;
  application_status: Status | null;
  available_paise: number;
}

export async function adminListUsers(
  adminId: string,
  f: { q?: string; filter?: string; page?: number } = {},
): Promise<{ rows: AdminUserRow[]; total: number; pageSize: number }> {
  await requireAdmin({ query }, adminId, 'manage_users');
  const pageSize = 25;
  const page = Math.max(1, f.page ?? 1);
  const where = ['u.deleted_at is null'];
  const params: unknown[] = [];
  if (f.q?.trim()) {
    params.push(likePattern(f.q));
    where.push(`(lower(u.username) like $${params.length} or lower(u.email) like $${params.length} or lower(coalesce(s.reddit_username, '')) like $${params.length})`);
  }
  if (f.filter === 'admins') where.push(`u.role = 'admin'`);
  if (f.filter === 'blocked') where.push(`u.status = 'suspended'`);
  if (f.filter === 'deletion') where.push(`u.deletion_requested_at is not null`);
  if (f.filter === 'unverified') where.push(`u.email_verified_at is null`);
  const from = `from users u left join reddit_submissions s on s.user_id = u.id and s.superseded_at is null left join wallets w on w.user_id = u.id where ${where.join(' and ')}`;
  const total = (await query<{ n: number }>(`select count(*)::bigint as n ${from}`, params)).rows[0].n;
  const rows = (await query<AdminUserRow>(
    `select u.id, u.email, u.username, u.role, u.status, u.email_verified_at, u.is_test_data, u.deletion_requested_at, u.deleted_at, u.created_at,
            s.reddit_username, s.status as application_status, coalesce(w.available_paise, 0) as available_paise
       ${from} order by u.created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  )).rows;
  return { rows, total, pageSize };
}

export async function adminGetUser(adminId: string, userId: string): Promise<AdminUserRow & { suspension_reason: string | null }> {
  await requireAdmin({ query }, adminId, 'manage_users');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound('That user');
  const r = (await query<AdminUserRow & { suspension_reason: string | null }>(
    `select u.id, u.email, u.username, u.role, u.status, u.suspension_reason, u.email_verified_at, u.is_test_data, u.deletion_requested_at, u.deleted_at, u.created_at,
            s.reddit_username, s.status as application_status, coalesce(w.available_paise, 0) as available_paise
       from users u left join reddit_submissions s on s.user_id = u.id and s.superseded_at is null left join wallets w on w.user_id = u.id
      where u.id = $1`,
    [userId],
  )).rows[0];
  if (!r) throw notFound('That user');
  return r;
}

/** Block / unblock an account. Blocked accounts cannot log in and lose all sessions at once. */
export async function adminSetAccountStatus(
  adminId: string,
  userId: string,
  status: 'active' | 'suspended',
  reasonInput: string,
  meta?: RequestMeta,
): Promise<void> {
  const reason = parseInput(text(500, 'Reason'), reasonInput ?? '');
  await tx(async (db) => {
    await requireAdmin(db, adminId, 'manage_users');
    if (adminId === userId) throw new AppError('forbidden', 'You cannot change your own account status.');
    const u = (await db.query<{ role: string; status: string }>(`select role, status from users where id = $1 and deleted_at is null for update`, [userId])).rows[0];
    if (!u) throw notFound('That user');
    if (u.role === 'admin') throw new AppError('forbidden', 'Administrator accounts cannot be blocked from the web interface.');
    if (status === 'suspended' && reason.length < 3) throw new AppError('validation', 'Please check the highlighted fields.', { reason: 'A reason is required.' });
    await db.query(`update users set status = $2, suspension_reason = $3, updated_at = now() where id = $1`, [userId, status, status === 'suspended' ? reason : null]);
    if (status === 'suspended') await db.query(`delete from sessions where user_id = $1`, [userId]);
    await writeAudit(db, { actorId: adminId, action: status === 'suspended' ? 'user.block' : 'user.unblock', targetType: 'user', targetId: userId, details: { reason: reason || undefined } }, meta);
    await notify(db, userId, 'account_status', status === 'suspended' ? 'Account suspended' : 'Account reactivated', reason || (status === 'active' ? 'Your account is active again.' : ''), '/dashboard');
  });
}

export async function adminMarkEmailVerified(adminId: string, userId: string, meta?: RequestMeta): Promise<void> {
  await tx(async (db) => {
    await requireAdmin(db, adminId, 'manage_users');
    const r = await db.query(`update users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = $1 and deleted_at is null`, [userId]);
    if (!r.rowCount) throw notFound('That user');
    await writeAudit(db, { actorId: adminId, action: 'user.email_verified_manually', targetType: 'user', targetId: userId }, meta);
  });
}

/**
 * Complete a deletion request: personal data is removed or anonymised. Wallet ledger and audit
 * records are retained (they are financial / security records) but no longer identify the person.
 */
export async function adminProcessDeletion(adminId: string, userId: string, meta?: RequestMeta): Promise<void> {
  await tx(async (db) => {
    await requireAdmin(db, adminId, 'manage_users');
    const u = (await db.query<{ role: string; deletion_requested_at: Date | null }>(`select role, deletion_requested_at from users where id = $1 and deleted_at is null for update`, [userId])).rows[0];
    if (!u) throw notFound('That user');
    if (u.role === 'admin') throw new AppError('forbidden', 'Administrator accounts cannot be deleted from the web interface.');
    if (!u.deletion_requested_at) throw new AppError('conflict', 'This user has not requested deletion.');
    const short = userId.replace(/-/g, '').slice(0, 10);
    await db.query(`delete from sessions where user_id = $1`, [userId]);
    await db.query(`delete from auth_tokens where user_id = $1`, [userId]);
    await db.query(`delete from notifications where user_id = $1`, [userId]);
    await db.query(`delete from reddit_submissions where user_id = $1`, [userId]); // cascades verification records + review decisions
    await db.query(`update task_applications set user_note = null, status = case when status in ('Applied','Under Review','Accepted') then 'Cancelled' else status end, updated_at = now() where user_id = $1`, [userId]);
    await db.query(
      `update users set email = $2, username = $3, password_hash = null, status = 'suspended', suspension_reason = 'Account deleted',
              email_verified_at = null, deleted_at = now(), updated_at = now() where id = $1`,
      [userId, `deleted-${short}@deleted.invalid`, `deleted_${short}`],
    );
    await writeAudit(db, { actorId: adminId, action: 'user.deleted', targetType: 'user', targetId: userId }, meta);
  });
}
