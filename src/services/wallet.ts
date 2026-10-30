import 'server-only';
import { z } from 'zod';
import type { Queryable } from '@/lib/db';
import { query, tx } from '@/lib/db';
import { AppError, notFound } from '@/lib/errors';
import { formatINR, parseRupeesToPaise } from '@/lib/money';
import { isUniqueViolation, messageHas } from '@/lib/pg-errors';
import { rateLimit } from '@/lib/rate-limit';
import { parseInput, requiredText } from '@/lib/validation';
import { writeAudit } from './audit';
import { requireAdmin } from './authz';
import { notify } from './notifications';
import { getSettings } from './settings-store';
import type { RequestMeta } from './types';

export interface WalletSummary {
  availablePaise: number;
  totalEarnedPaise: number;
  /** Rewards configured on tasks the user was ACCEPTED for but that are not completed yet. Not yet credited. */
  pendingRewardsPaise: number;
}

export interface LedgerRow {
  id: number;
  user_id: string;
  direction: 'credit' | 'debit';
  amount_paise: number;
  kind: 'task_reward' | 'admin_adjustment';
  status: 'posted';
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  balance_after_paise: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
}

const LEDGER_SELECT = `select l.id, l.user_id, l.direction, l.amount_paise, l.kind, l.status, l.description, l.reference_type, l.reference_id,
  l.balance_after_paise, l.created_by, cu.username as created_by_name, l.created_at
  from wallet_ledger l left join users cu on cu.id = l.created_by`;

export async function getWalletSummary(userId: string, db: Queryable = { query }): Promise<WalletSummary> {
  const w = (await db.query<{ available_paise: number; total_earned_paise: number }>(
    `select available_paise, total_earned_paise from wallets where user_id = $1`, [userId])).rows[0];
  const pending = (await db.query<{ n: number }>(
    `select coalesce(sum(t.reward_paise), 0)::bigint as n from task_applications a join tasks t on t.id = a.task_id
      where a.user_id = $1 and a.status = 'Accepted' and t.reward_paise > 0`, [userId])).rows[0].n;
  return { availablePaise: w?.available_paise ?? 0, totalEarnedPaise: w?.total_earned_paise ?? 0, pendingRewardsPaise: pending };
}

export async function listLedger(userId: string, opts: { limit?: number; page?: number } = {}): Promise<{ rows: LedgerRow[]; total: number; pageSize: number }> {
  const pageSize = Math.min(opts.limit ?? 25, 100);
  const page = Math.max(1, opts.page ?? 1);
  const total = (await query<{ n: number }>(`select count(*)::bigint as n from wallet_ledger where user_id = $1`, [userId])).rows[0].n;
  const rows = (await query<LedgerRow>(`${LEDGER_SELECT} where l.user_id = $1 order by l.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`, [userId])).rows;
  return { rows, total, pageSize };
}

/** Admin: every transaction on the platform (optionally one user). */
export async function adminListTransactions(
  adminId: string,
  opts: { userId?: string; kind?: string; page?: number } = {},
): Promise<{ rows: (LedgerRow & { username: string })[]; total: number; pageSize: number }> {
  await requireAdmin({ query }, adminId);
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.userId) { params.push(opts.userId); where.push(`l.user_id = $${params.length}`); }
  if (opts.kind) { params.push(opts.kind); where.push(`l.kind = $${params.length}`); }
  const w = where.length ? `where ${where.join(' and ')}` : '';
  const total = (await query<{ n: number }>(`select count(*)::bigint as n from wallet_ledger l ${w}`, params)).rows[0].n;
  const rows = (
    await query<LedgerRow & { username: string }>(
      `select l.id, l.user_id, l.direction, l.amount_paise, l.kind, l.status, l.description, l.reference_type, l.reference_id,
              l.balance_after_paise, l.created_by, cu.username as created_by_name, l.created_at, u.username
         from wallet_ledger l join users u on u.id = l.user_id left join users cu on cu.id = l.created_by
         ${w} order by l.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
      params,
    )
  ).rows;
  return { rows, total, pageSize };
}

export async function adminWalletTotals(adminId: string): Promise<{ users: number; totalHeldPaise: number; entries: number }> {
  await requireAdmin({ query }, adminId);
  const r = (await query<{ users: number; held: number; entries: number }>(
    `select (select count(*)::bigint from wallets where available_paise > 0) as users,
            (select coalesce(sum(available_paise), 0)::bigint from wallets) as held,
            (select count(*)::bigint from wallet_ledger) as entries`)).rows[0];
  return { users: r.users, totalHeldPaise: r.held, entries: r.entries };
}

const AdjustSchema = z.object({
  userId: z.string().uuid('Choose a valid user.'),
  direction: z.enum(['credit', 'debit'], { error: 'Choose credit or debit.' }),
  amount: z.string({ error: 'Enter an amount.' }),
  reason: requiredText(5, 300, 'Reason'),
  idempotencyKey: z.string().min(8).max(100),
});

/**
 * Internal ledger adjustment (NOT a payment). The balance can only change through this insert;
 * the database trigger applies it atomically and refuses to go below zero.
 * The idempotency key makes a double-submitted form harmless.
 */
export async function adminAdjustWallet(
  adminId: string,
  input: { userId: string; direction: string; amount: string; reason: string; idempotencyKey: string },
  meta?: RequestMeta,
): Promise<{ duplicate: boolean; balanceAfterPaise: number }> {
  await rateLimit(`wallet-adjust:admin:${adminId}`, 60, 3600);
  const v = parseInput(AdjustSchema, input);
  const paise = parseRupeesToPaise(v.amount);
  if (!paise || paise <= 0) throw new AppError('validation', 'Please check the highlighted fields.', { amount: 'Enter an amount greater than zero, for example 250 or 99.50.' });

  try {
    return await tx(async (db) => {
      await requireAdmin(db, adminId, 'wallet_adjust');
      const settings = await getSettings(db);
      if (!settings.walletAdjustmentsEnabled) throw new AppError('disabled', 'Wallet adjustments are currently switched off in Settings.');
      const target = (await db.query<{ id: string; username: string }>(`select id, username from users where id = $1 and deleted_at is null`, [v.userId])).rows[0];
      if (!target) throw notFound('That user');

      const key = `adjust:${v.idempotencyKey}`;
      const existing = (await db.query<{ balance_after_paise: number }>(`select balance_after_paise from wallet_ledger where idempotency_key = $1`, [key])).rows[0];
      if (existing) return { duplicate: true, balanceAfterPaise: existing.balance_after_paise };

      const r = await db.query<{ balance_after_paise: number }>(
        `insert into wallet_ledger (user_id, direction, amount_paise, kind, description, idempotency_key, created_by)
         values ($1, $2, $3, 'admin_adjustment', $4, $5, $6) returning balance_after_paise`,
        [v.userId, v.direction, paise, v.reason, key, adminId],
      );
      await writeAudit(db, {
        actorId: adminId, action: 'wallet.adjust', targetType: 'user', targetId: v.userId,
        details: { direction: v.direction, amount_paise: paise, reason: v.reason, balance_after_paise: r.rows[0].balance_after_paise },
      }, meta);
      await notify(db, v.userId, 'wallet', v.direction === 'credit' ? 'Wallet credited' : 'Wallet debited', `${formatINR(paise)} — ${v.reason}`, '/wallet');
      return { duplicate: false, balanceAfterPaise: r.rows[0].balance_after_paise };
    });
  } catch (e) {
    if (messageHas(e, 'insufficient_balance')) throw new AppError('insufficient_balance', 'That debit is larger than the available balance.');
    if (isUniqueViolation(e, 'wallet_ledger_idempotency_key_key')) return { duplicate: true, balanceAfterPaise: 0 };
    throw e;
  }
}

/** Internal: credit a task reward inside the caller's transaction. Idempotent per application. */
export async function creditTaskReward(
  db: Queryable,
  adminId: string,
  app: { id: string; user_id: string; task_title: string; reward_paise: number },
): Promise<boolean> {
  const key = `task_reward:${app.id}`;
  const existing = await db.query(`select 1 from wallet_ledger where idempotency_key = $1`, [key]);
  if (existing.rowCount) return false;
  await db.query(
    `insert into wallet_ledger (user_id, direction, amount_paise, kind, description, reference_type, reference_id, idempotency_key, created_by)
     values ($1, 'credit', $2, 'task_reward', $3, 'task_application', $4, $5, $6)`,
    [app.user_id, app.reward_paise, `Reward for task: ${app.task_title}`.slice(0, 300), app.id, key, adminId],
  );
  await notify(db, app.user_id, 'wallet', 'Reward credited', `${formatINR(app.reward_paise)} for “${app.task_title}” was added to your wallet.`, '/wallet');
  return true;
}
