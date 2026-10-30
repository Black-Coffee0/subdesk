import 'server-only';
import { z } from 'zod';
import type { Queryable } from '@/lib/db';
import { query, tx } from '@/lib/db';
import { checkBase, describeUnmet, type Thresholds } from '@/lib/eligibility';
import { AppError, forbidden, notFound } from '@/lib/errors';
import { isUniqueViolation } from '@/lib/pg-errors';
import { rateLimit } from '@/lib/rate-limit';
import { lookupRedditUser, type RedditLookup } from '@/lib/reddit';
import { parseRedditProfileUrl } from '@/lib/reddit-url';
import { intField, likePattern, parseInput, requiredText, text } from '@/lib/validation';
import { writeAudit } from './audit';
import { requireActiveUser, requireAdmin } from './authz';
import { getBaseThresholds, getCurrentSubmissionRow, valuesOf } from './eligibility';
import { notify } from './notifications';
import { getSettings } from './settings-store';
import type { OwnershipState, RequestMeta, Status, SubmissionRow, VerificationState } from './types';

export const OPEN_STATUSES: Status[] = ['Pending Verification', 'Pending Admin Review', 'Needs More Information'];
const MAX_SUBMISSIONS_PER_USER = 10;

// ------------------------------------------------------------------ reading

export async function getCurrentSubmission(userId: string): Promise<SubmissionRow | null> {
  return getCurrentSubmissionRow({ query }, userId);
}

export async function listSubmissionHistory(userId: string): Promise<SubmissionRow[]> {
  return (await query<SubmissionRow>(`select * from reddit_submissions where user_id = $1 order by submitted_at desc`, [userId])).rows;
}

export interface VerificationRecord {
  id: string;
  submission_id: string;
  method: 'reddit_api' | 'admin_manual' | 'test_fixture';
  outcome: VerificationState;
  failure_code: string | null;
  detail: string | null;
  reddit_username: string | null;
  account_created_at: Date | null;
  comment_karma: number | null;
  post_karma: number | null;
  ownership_state: OwnershipState;
  checks: Record<string, any>;
  evidence: Record<string, any>;
  checked_by: string | null;
  created_at: Date;
}

export async function listVerificationRecords(submissionId: string, db: Queryable = { query }): Promise<VerificationRecord[]> {
  return (await db.query<VerificationRecord>(`select * from verification_records where submission_id = $1 order by created_at desc`, [submissionId])).rows;
}

/** Whether (and why not) a user may submit a new Reddit account right now. */
export async function canSubmit(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  const [settings, current, count] = await Promise.all([
    getSettings(),
    getCurrentSubmission(userId),
    query<{ n: number }>(`select count(*)::bigint as n from reddit_submissions where user_id = $1`, [userId]),
  ]);
  return submitGate(settings.applicationsOpen, current, count.rows[0].n);
}

function submitGate(open: boolean, current: SubmissionRow | null, totalCount: number): { allowed: boolean; reason?: string } {
  if (!open) return { allowed: false, reason: 'New applications are temporarily closed. Please check back later.' };
  if (current) {
    switch (current.status) {
      case 'Pending Verification':
      case 'Pending Admin Review':
        return { allowed: false, reason: 'Your application is already being reviewed.' };
      case 'Approved':
        return { allowed: false, reason: 'Your Reddit account is already approved. Contact support if you need to change it.' };
      case 'Suspended':
        return { allowed: false, reason: 'Your task access is suspended. Please contact support.' };
      case 'Rejected':
        if (!current.allow_resubmit) return { allowed: false, reason: 'Resubmission is not available for this application. Please contact support.' };
        break;
      case 'Needs More Information':
        break;
    }
  }
  if (totalCount >= MAX_SUBMISSIONS_PER_USER) return { allowed: false, reason: 'You have reached the maximum number of submissions. Please contact support.' };
  return { allowed: true };
}

// --------------------------------------------------------- verification core

interface Outcome {
  state: VerificationState;
  failureCode: string | null;
  detail: string;
  values: { createdAt: Date; commentKarma: number; postKarma: number } | null;
  ownership: OwnershipState;
  checks: Record<string, unknown>;
  evidence: Record<string, unknown>;
  meetsMinimums: boolean | null;
  unmet: string[];
}

/** Turn a raw Reddit lookup into a transparent, recordable verification outcome. Pure. */
export function interpretLookup(
  lookup: RedditLookup,
  o: { ownershipCode: string; requireOwnership: boolean; base: Thresholds; now?: Date },
): Outcome {
  const now = o.now ?? new Date();
  const none = { values: null, ownership: 'not_checked' as OwnershipState, meetsMinimums: null, unmet: [] as string[] };
  switch (lookup.kind) {
    case 'ok': {
      const values = { createdAt: lookup.createdAt, commentKarma: lookup.commentKarma, postKarma: lookup.postKarma };
      const base = checkBase({ accountCreatedAt: values.createdAt, commentKarma: values.commentKarma, postKarma: values.postKarma, source: 'reddit_api', verifiedAt: now }, o.base, now);
      const ownership: OwnershipState = o.requireOwnership
        ? lookup.bio.toLowerCase().includes(o.ownershipCode.toLowerCase())
          ? 'confirmed'
          : 'not_confirmed'
        : 'not_checked';
      const unmet = base.checks.filter((c) => c.passed !== true).map(describeUnmet);
      return {
        state: 'verified',
        failureCode: null,
        detail: base.allPassed
          ? 'Reddit returned the account details. All three platform minimums are met.'
          : `Reddit returned the account details. Minimums not met — ${unmet.join('; ')}.`,
        values,
        ownership,
        checks: { base: base.checks, allPassed: base.allPassed, thresholds: o.base, ownership: { required: o.requireOwnership, state: ownership } },
        evidence: lookup.evidence,
        meetsMinimums: base.allPassed,
        unmet,
      };
    }
    case 'not_found':
      return { ...none, state: 'unverified', failureCode: 'not_found', detail: 'Reddit reports no account with this username (it may not exist or may have been deleted).', checks: {}, evidence: { source: 'reddit_oauth_api', result: 'not_found' } };
    case 'suspended':
      return { ...none, state: 'unverified', failureCode: 'suspended', detail: 'Reddit reports that this account is suspended.', checks: {}, evidence: { source: 'reddit_oauth_api', result: 'suspended' } };
    case 'forbidden':
      return { ...none, state: 'manual_review_required', failureCode: 'restricted', detail: 'Reddit refused access to this profile (it may be private or restricted). An administrator must verify it manually.', checks: {}, evidence: { source: 'reddit_oauth_api', result: 'forbidden' } };
    case 'unavailable': {
      const why: Record<string, string> = {
        not_configured: 'Automatic verification is not configured on this platform.',
        auth_failed: 'The Reddit API credentials were rejected.',
        rate_limited: 'Reddit is rate limiting requests right now.',
        network: 'Reddit could not be reached.',
        bad_response: 'Reddit returned incomplete or unexpected data.',
      };
      return { ...none, state: 'manual_review_required', failureCode: lookup.reason, detail: `${why[lookup.reason]} An administrator must verify this account manually.`, checks: {}, evidence: { source: 'reddit_oauth_api', result: 'unavailable', reason: lookup.reason, detail: lookup.detail ?? null } };
    }
  }
}

/**
 * Run (or re-run) the automated Reddit check for a submission and record the result.
 * The network call happens OUTSIDE any database transaction.
 */
export async function runVerification(
  submissionId: string,
  mode: 'initial' | 'reverify' = 'initial',
  actorId: string | null = null,
  meta?: RequestMeta,
): Promise<{ status: Status; state: VerificationState; detail: string }> {
  const sub = (await query<SubmissionRow & { verification_code: string }>(
    `select s.*, u.verification_code from reddit_submissions s join users u on u.id = s.user_id where s.id = $1`,
    [submissionId],
  )).rows[0];
  if (!sub) throw notFound('That application');
  if (sub.superseded_at) throw new AppError('conflict', 'This submission was replaced by a newer one.');

  const settings = await getSettings();
  const base = await getBaseThresholds();
  const lookup = await lookupRedditUser(sub.reddit_username);
  const outcome = interpretLookup(lookup, { ownershipCode: sub.verification_code, requireOwnership: settings.requireOwnershipCode, base });

  return tx(async (db) => {
    const cur = (await db.query<SubmissionRow>(`select * from reddit_submissions where id = $1 for update`, [submissionId])).rows[0];
    if (!cur || cur.superseded_at) throw new AppError('conflict', 'This submission was replaced by a newer one.');
    if (mode === 'initial' && cur.status !== 'Pending Verification') {
      return { status: cur.status, state: cur.verification_state, detail: outcome.detail };
    }

    await db.query(
      `insert into verification_records (submission_id, method, outcome, failure_code, detail, reddit_username, account_created_at,
                                          comment_karma, post_karma, ownership_state, checks, evidence, checked_by)
       values ($1, 'reddit_api', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)`,
      [
        submissionId, outcome.state, outcome.failureCode, outcome.detail, sub.reddit_username,
        outcome.values?.createdAt ?? null, outcome.values?.commentKarma ?? null, outcome.values?.postKarma ?? null,
        outcome.ownership, JSON.stringify(outcome.checks), JSON.stringify(outcome.evidence), actorId,
      ],
    );

    // Don't let a failed re-check wipe values an administrator already verified.
    const keepExisting = mode === 'reverify' && outcome.state !== 'verified';
    let status: Status = cur.status;
    let autoRejected = false;

    if (!keepExisting) {
      if (mode === 'initial') status = 'Pending Admin Review';
      const settingsNow = await getSettings(db);
      if (mode === 'initial' && settingsNow.autoRejectBelowMinimums && outcome.state === 'verified' && outcome.meetsMinimums === false) {
        status = 'Rejected';
        autoRejected = true;
      }
      await db.query(
        `update reddit_submissions set
            status = $2, verification_state = $3, ownership_state = $4,
            values_source = $5, account_created_at = $6, comment_karma = $7, post_karma = $8, verified_at = $9,
            rejection_reason = $10, allow_resubmit = case when $11 then true else allow_resubmit end,
            decided_at = case when $11 then now() else decided_at end, updated_at = now()
          where id = $1`,
        [
          submissionId, status, outcome.state, outcome.ownership,
          outcome.values ? 'reddit_api' : cur.values_source,
          outcome.values?.createdAt ?? cur.account_created_at,
          outcome.values?.commentKarma ?? cur.comment_karma,
          outcome.values?.postKarma ?? cur.post_karma,
          outcome.values ? new Date() : cur.verified_at,
          autoRejected ? `Automatic check: ${outcome.unmet.join('; ')}. You can resubmit once your account meets the requirements.` : cur.rejection_reason,
          autoRejected,
        ],
      );
      if (autoRejected) {
        await db.query(
          `insert into review_decisions (submission_id, admin_id, action, from_status, to_status, reason) values ($1, null, 'auto_reject', $2, 'Rejected', $3)`,
          [submissionId, cur.status, outcome.unmet.join('; ')],
        );
      }
    }

    if (mode === 'initial') {
      const msg =
        outcome.state === 'verified'
          ? autoRejected
            ? `Your account does not currently meet the minimums: ${outcome.unmet.join('; ')}.`
            : 'We retrieved your Reddit account details. An administrator will now review your application.'
          : outcome.state === 'manual_review_required'
            ? 'We could not complete the automatic check, so an administrator will verify your account manually.'
            : 'We could not verify this account automatically. An administrator will review the result.';
      await notify(db, cur.user_id, 'verification_complete', autoRejected ? 'Application not approved' : 'Verification complete', msg, '/application');
    }
    await writeAudit(
      db,
      { actorId, action: mode === 'initial' ? 'submission.verified' : 'submission.reverified', targetType: 'submission', targetId: submissionId, details: { outcome: outcome.state, code: outcome.failureCode } },
      meta,
    );
    return { status, state: keepExisting ? cur.verification_state : outcome.state, detail: outcome.detail };
  });
}

// ----------------------------------------------------- user: submit account

export async function submitRedditAccount(
  userId: string,
  input: { profileUrl: string; note?: string },
  meta?: RequestMeta,
): Promise<{ submissionId: string; status: Status; verificationState: VerificationState; detail: string }> {
  await rateLimit(`submit:user:${userId}`, 6, 86400, undefined, 'You have submitted too many times today. Please try again tomorrow.');
  await rateLimit(`submit:ip:${meta?.ip ?? 'unknown'}`, 30, 86400);

  const parsed = parseRedditProfileUrl(String(input.profileUrl ?? ''));
  if (!parsed.ok) throw new AppError('validation', 'Please check the highlighted fields.', { profileUrl: parsed.error });
  const note = parseInput(text(500, 'Note'), input.note ?? '');

  const submissionId = await tx(async (db) => {
    await requireActiveUser(db, userId, { verifiedEmail: true });
    const settings = await getSettings(db);
    const current = (await db.query<SubmissionRow>(`select * from reddit_submissions where user_id = $1 and superseded_at is null for update`, [userId])).rows[0] ?? null;
    const total = (await db.query<{ n: number }>(`select count(*)::bigint as n from reddit_submissions where user_id = $1`, [userId])).rows[0].n;
    const gate = submitGate(settings.applicationsOpen, current, total);
    if (!gate.allowed) throw new AppError('not_allowed', gate.reason!);

    if (current) await db.query(`update reddit_submissions set superseded_at = now() where id = $1`, [current.id]);
    try {
      const r = await db.query<{ id: string }>(
        `insert into reddit_submissions (user_id, profile_url, reddit_username, user_note, status)
         values ($1, $2, $3, $4, 'Pending Verification') returning id`,
        [userId, parsed.canonicalUrl, parsed.username, note || null],
      );
      await notify(db, userId, 'submission_received', 'Reddit account submitted', `We received u/${parsed.username} and are checking it now.`, '/application');
      await writeAudit(db, { actorId: userId, action: 'submission.created', targetType: 'submission', targetId: r.rows[0].id, details: { reddit_username: parsed.username } }, meta);
      return r.rows[0].id;
    } catch (e) {
      if (isUniqueViolation(e, 'rs_one_active_per_reddit_name')) {
        throw new AppError('validation', 'Please check the highlighted fields.', { profileUrl: 'That Reddit account is already linked to another user on this platform.' });
      }
      if (isUniqueViolation(e, 'rs_one_current_per_user')) throw new AppError('not_allowed', 'Your application is already being processed.');
      throw e;
    }
  });

  // Network lookup runs outside the transaction. If it ever fails, the row simply stays
  // "Pending Verification" and an administrator can re-run it — nothing is faked.
  let result: { status: Status; state: VerificationState; detail: string };
  try {
    result = await runVerification(submissionId, 'initial', null, meta);
  } catch (e) {
    console.error('[verification] failed:', (e as Error).message);
    result = { status: 'Pending Verification', state: 'unverified', detail: 'Verification will be completed by an administrator.' };
  }
  return { submissionId, status: result.status, verificationState: result.state, detail: result.detail };
}

// -------------------------------------------------------------- admin: queue

export interface QueueRow {
  id: string;
  user_id: string;
  platform_username: string;
  email: string;
  is_test_data: boolean;
  reddit_username: string;
  profile_url: string;
  status: Status;
  verification_state: VerificationState;
  ownership_state: OwnershipState;
  values_source: SubmissionRow['values_source'];
  account_created_at: Date | null;
  comment_karma: number | null;
  post_karma: number | null;
  submitted_at: Date;
  attempts: number;
}

export async function adminListApplications(
  adminId: string,
  f: { status?: string; state?: string; q?: string; page?: number } = {},
): Promise<{ rows: QueueRow[]; total: number; pageSize: number }> {
  await requireAdmin({ query }, adminId, 'review_applications');
  const pageSize = 25;
  const page = Math.max(1, f.page ?? 1);
  const where = ['s.superseded_at is null', 'u.deleted_at is null'];
  const params: unknown[] = [];
  if (f.status) { params.push(f.status); where.push(`s.status = $${params.length}`); }
  if (f.state) { params.push(f.state); where.push(`s.verification_state = $${params.length}`); }
  if (f.q?.trim()) {
    params.push(likePattern(f.q));
    where.push(`(lower(s.reddit_username) like $${params.length} or lower(u.username) like $${params.length} or lower(u.email) like $${params.length})`);
  }
  const w = where.join(' and ');
  const total = (await query<{ n: number }>(`select count(*)::bigint as n from reddit_submissions s join users u on u.id = s.user_id where ${w}`, params)).rows[0].n;
  const rows = (
    await query<QueueRow>(
      `select s.id, s.user_id, u.username as platform_username, u.email, u.is_test_data, s.reddit_username, s.profile_url, s.status,
              s.verification_state, s.ownership_state, s.values_source, s.account_created_at, s.comment_karma, s.post_karma, s.submitted_at,
              (select count(*)::bigint from reddit_submissions x where x.user_id = s.user_id) as attempts
         from reddit_submissions s join users u on u.id = s.user_id
        where ${w}
        order by case s.status when 'Pending Admin Review' then 0 when 'Pending Verification' then 1 when 'Needs More Information' then 2 else 3 end,
                 s.submitted_at asc
        limit ${pageSize} offset ${(page - 1) * pageSize}`,
      params,
    )
  ).rows;
  return { rows, total, pageSize };
}

export interface ApplicationDetail {
  submission: SubmissionRow;
  user: { id: string; username: string; email: string; created_at: Date; email_verified_at: Date | null; is_test_data: boolean; status: string; verification_code: string };
  records: VerificationRecord[];
  decisions: { id: string; admin_label: string | null; action: string; from_status: string | null; to_status: string | null; reason: string | null; created_at: Date }[];
  previous: SubmissionRow[];
  sameRedditName: { id: string; username: string; status: string }[];
  baseCheck: ReturnType<typeof checkBase>;
  base: Thresholds;
  requireOwnership: boolean;
}

export async function adminGetApplication(adminId: string, id: string): Promise<ApplicationDetail> {
  await requireAdmin({ query }, adminId, 'review_applications');
  const submission = (await query<SubmissionRow>(`select * from reddit_submissions where id = $1`, [id])).rows[0];
  if (!submission) throw notFound('That application');
  const user = (
    await query<ApplicationDetail['user']>(
      `select id, username, email, created_at, email_verified_at, is_test_data, status, verification_code from users where id = $1`,
      [submission.user_id],
    )
  ).rows[0];
  const [records, decisions, previous, same, base, settings] = await Promise.all([
    listVerificationRecords(id),
    query(
      `select d.id, coalesce(u.username, case when d.action = 'auto_reject' then 'System (automatic)' else null end) as admin_label,
              d.action, d.from_status, d.to_status, d.reason, d.created_at
         from review_decisions d left join users u on u.id = d.admin_id where d.submission_id = $1 order by d.created_at desc`,
      [id],
    ),
    query<SubmissionRow>(`select * from reddit_submissions where user_id = $1 and id <> $2 order by submitted_at desc`, [submission.user_id, id]),
    query<{ id: string; username: string; status: string }>(
      `select s.id, u.username, s.status from reddit_submissions s join users u on u.id = s.user_id
        where lower(s.reddit_username) = lower($1) and s.user_id <> $2 order by s.submitted_at desc limit 10`,
      [submission.reddit_username, submission.user_id],
    ),
    getBaseThresholds(),
    getSettings(),
  ]);
  return {
    submission,
    user,
    records,
    decisions: decisions.rows as ApplicationDetail['decisions'],
    previous: previous.rows,
    sameRedditName: same.rows,
    baseCheck: checkBase(valuesOf(submission), base),
    base,
    requireOwnership: settings.requireOwnershipCode,
  };
}

// ------------------------------------------------------------ admin: decide

export type DecisionAction = 'approve' | 'reject' | 'request_info' | 'mark_manual' | 'suspend' | 'reinstate';

const TRANSITIONS: Record<DecisionAction, { from: Status[]; to: Status }> = {
  approve: { from: ['Pending Admin Review', 'Needs More Information', 'Rejected'], to: 'Approved' },
  reject: { from: ['Pending Verification', 'Pending Admin Review', 'Needs More Information'], to: 'Rejected' },
  request_info: { from: ['Pending Admin Review'], to: 'Needs More Information' },
  mark_manual: { from: ['Pending Verification', 'Pending Admin Review', 'Needs More Information'], to: 'Pending Admin Review' },
  suspend: { from: ['Approved'], to: 'Suspended' },
  reinstate: { from: ['Suspended'], to: 'Approved' },
};

export async function adminDecide(
  adminId: string,
  submissionId: string,
  action: DecisionAction,
  input: { reason?: string; allowResubmit?: boolean } = {},
  meta?: RequestMeta,
): Promise<{ status: Status }> {
  const reason = parseInput(text(1000, 'Reason'), input.reason ?? '');
  const t = TRANSITIONS[action];
  if (!t) throw new AppError('validation', 'Unknown action.');

  return tx(async (db) => {
    await requireAdmin(db, adminId, 'review_applications');
    const s = (await db.query<SubmissionRow>(`select * from reddit_submissions where id = $1 for update`, [submissionId])).rows[0];
    if (!s) throw notFound('That application');
    if (s.superseded_at) throw new AppError('conflict', 'This submission was replaced by a newer one and can no longer be changed.');
    if (!t.from.includes(s.status)) {
      throw new AppError('conflict', `Cannot ${action.replace('_', ' ')} an application that is "${s.status}".`);
    }
    if (['reject', 'request_info', 'suspend'].includes(action) && reason.length < 3) {
      throw new AppError('validation', 'Please check the highlighted fields.', {
        reason: action === 'reject' ? 'A rejection reason is required.' : action === 'request_info' ? 'Tell the user what information you need.' : 'A reason is required.',
      });
    }

    if (action === 'approve' || action === 'reinstate') {
      const user = (await db.query<{ status: string; deleted_at: Date | null }>(`select status, deleted_at from users where id = $1`, [s.user_id])).rows[0];
      if (!user || user.deleted_at) throw new AppError('conflict', 'This user account no longer exists.');
      if (user.status !== 'active') throw new AppError('conflict', 'This user account is blocked. Reactivate the account before approving.');
      const values = valuesOf(s);
      if (!values || s.verification_state !== 'verified') {
        throw new AppError('verification_required', 'Verified account values are required before approval. Run the automatic check again, or enter the values manually after reviewing the profile.');
      }
      const base = await getBaseThresholds(db);
      const check = checkBase(values, base);
      if (!check.allPassed) {
        throw new AppError('minimums_not_met', `The account does not meet the platform minimums: ${check.checks.filter((c) => c.passed !== true).map(describeUnmet).join('; ')}.`);
      }
      const settings = await getSettings(db);
      if (settings.requireOwnershipCode && s.ownership_state !== 'confirmed') {
        throw new AppError('ownership_required', "Ownership of this Reddit account is not confirmed. Look for the user's verification code in the profile bio, then record the values with ownership confirmed (or turn off the ownership requirement in Settings).");
      }
    }

    const set: string[] = ['status = $2', 'decided_by = $3', 'decided_at = now()', 'updated_at = now()'];
    const p: unknown[] = [submissionId, t.to, adminId];
    const add = (col: string, v: unknown) => { p.push(v); set.push(`${col} = $${p.length}`); };
    if (action === 'approve' || action === 'reinstate') {
      add('rejection_reason', null); add('info_request', null); add('suspension_reason', null);
    } else if (action === 'reject') {
      add('rejection_reason', reason); add('allow_resubmit', input.allowResubmit !== false); add('info_request', null);
    } else if (action === 'request_info') {
      add('info_request', reason);
    } else if (action === 'suspend') {
      add('suspension_reason', reason);
    } else if (action === 'mark_manual') {
      add('verification_state', s.verification_state === 'verified' ? 'verified' : 'manual_review_required');
    }
    await db.query(`update reddit_submissions set ${set.join(', ')} where id = $1`, p);
    await db.query(
      `insert into review_decisions (submission_id, admin_id, action, from_status, to_status, reason) values ($1, $2, $3, $4, $5, $6)`,
      [submissionId, adminId, action, s.status, t.to, reason || null],
    );
    await writeAudit(db, { actorId: adminId, action: `submission.${action}`, targetType: 'submission', targetId: submissionId, details: { from: s.status, to: t.to, reason: reason || undefined, user_id: s.user_id } }, meta);

    const messages: Record<DecisionAction, [string, string, string]> = {
      approve: ['Your Reddit account was approved', 'You can now browse the tasks your account is eligible for.', '/tasks'],
      reject: ['Your application was not approved', reason, '/application'],
      request_info: ['More information needed', reason, '/application'],
      mark_manual: ['Manual verification in progress', 'An administrator is verifying your account manually.', '/application'],
      suspend: ['Task access suspended', reason, '/application'],
      reinstate: ['Task access restored', 'Your task access has been restored.', '/tasks'],
    };
    const [title, body, link] = messages[action];
    await notify(db, s.user_id, action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'account_status', title, body, link);
    return { status: t.to };
  });
}

// ------------------------------------------------- admin: manual values

const DateOnly = z
  .string({ error: 'Enter the account creation date.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .transform((v, ctx) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) { ctx.addIssue({ code: 'custom', message: 'That is not a real date.' }); return z.NEVER; }
    if (d.getTime() > Date.now()) { ctx.addIssue({ code: 'custom', message: 'The date cannot be in the future.' }); return z.NEVER; }
    if (d.getUTCFullYear() < 2005) { ctx.addIssue({ code: 'custom', message: 'Reddit did not exist before 2005.' }); return z.NEVER; }
    return d;
  });

export async function adminSetManualValues(
  adminId: string,
  submissionId: string,
  input: { accountCreatedAt: string; commentKarma: number | string; postKarma: number | string; ownershipConfirmed: boolean; evidenceNote: string },
  meta?: RequestMeta,
): Promise<void> {
  const v = parseInput(
    z.object({
      accountCreatedAt: DateOnly,
      commentKarma: intField(0, 100_000_000, 'Comment karma'),
      postKarma: intField(0, 100_000_000, 'Post karma'),
      ownershipConfirmed: z.boolean(),
      evidenceNote: requiredText(5, 500, 'Evidence note'),
    }),
    input,
  );
  await tx(async (db) => {
    await requireAdmin(db, adminId, 'review_applications');
    const s = (await db.query<SubmissionRow>(`select * from reddit_submissions where id = $1 for update`, [submissionId])).rows[0];
    if (!s) throw notFound('That application');
    if (s.superseded_at) throw new AppError('conflict', 'This submission was replaced by a newer one and can no longer be changed.');
    const settings = await getSettings(db);
    const ownership: OwnershipState = v.ownershipConfirmed ? 'confirmed' : settings.requireOwnershipCode ? 'not_confirmed' : 'not_checked';
    const nextStatus: Status = s.status === 'Pending Verification' ? 'Pending Admin Review' : s.status;

    await db.query(
      `insert into verification_records (submission_id, method, outcome, detail, reddit_username, account_created_at, comment_karma, post_karma,
                                          ownership_state, checks, evidence, checked_by)
       values ($1, 'admin_manual', 'verified', $2, $3, $4, $5, $6, $7, '{}'::jsonb, $8::jsonb, $9)`,
      [submissionId, 'Values entered by an administrator after reviewing the Reddit profile.', s.reddit_username, v.accountCreatedAt, v.commentKarma, v.postKarma, ownership,
        JSON.stringify({ source: 'admin_manual', note: v.evidenceNote, entered_at: new Date().toISOString() }), adminId],
    );
    await db.query(
      `update reddit_submissions set values_source = 'admin_manual', account_created_at = $2, comment_karma = $3, post_karma = $4,
              verification_state = 'verified', ownership_state = $5, verified_at = now(), status = $6, updated_at = now() where id = $1`,
      [submissionId, v.accountCreatedAt, v.commentKarma, v.postKarma, ownership, nextStatus],
    );
    await db.query(
      `insert into review_decisions (submission_id, admin_id, action, from_status, to_status, reason) values ($1, $2, 'manual_values', $3, $4, $5)`,
      [submissionId, adminId, s.status, nextStatus, v.evidenceNote],
    );
    await writeAudit(db, {
      actorId: adminId, action: 'submission.manual_values', targetType: 'submission', targetId: submissionId,
      details: { account_created_at: v.accountCreatedAt.toISOString().slice(0, 10), comment_karma: v.commentKarma, post_karma: v.postKarma, ownership, note: v.evidenceNote, previous: { source: s.values_source, comment_karma: s.comment_karma, post_karma: s.post_karma } },
    }, meta);
  });
}

export async function adminReverify(adminId: string, submissionId: string, meta?: RequestMeta): Promise<{ state: VerificationState; detail: string }> {
  await requireAdmin({ query }, adminId, 'review_applications');
  const s = await query<SubmissionRow>(`select * from reddit_submissions where id = $1`, [submissionId]);
  if (!s.rows[0]) throw notFound('That application');
  const cur = s.rows[0];
  // Initial mode resolves a stuck "Pending Verification"; otherwise refresh as a re-check.
  const r = await runVerification(submissionId, cur.status === 'Pending Verification' ? 'initial' : 'reverify', adminId, meta);
  return { state: r.state, detail: r.detail };
}

export async function adminSaveNotes(adminId: string, submissionId: string, notes: string, meta?: RequestMeta): Promise<void> {
  const clean = parseInput(text(2000, 'Notes'), notes);
  await tx(async (db) => {
    await requireAdmin(db, adminId, 'review_applications');
    const r = await db.query(`update reddit_submissions set admin_notes = $2, updated_at = now() where id = $1`, [submissionId, clean || null]);
    if (!r.rowCount) throw notFound('That application');
    await writeAudit(db, { actorId: adminId, action: 'submission.notes', targetType: 'submission', targetId: submissionId }, meta);
  });
}

export { forbidden };
