import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock('@/lib/reddit', () => ({
  lookupRedditUser: lookupMock,
  isRedditConfigured: () => true,
  clearRedditTokenCache: () => {},
}));

import { query, resetDbForTests } from '@/lib/db';
import { createSession, getSessionUser, login, resetPassword, requestPasswordReset, signUp, verifyEmail, destroySession } from '@/services/auth';
import {
  adminDecide, adminGetApplication, adminListApplications, adminReverify, adminSetManualValues, getCurrentSubmission, submitRedditAccount,
} from '@/services/submissions';
import { getUserEligibility } from '@/services/eligibility';
import {
  adminDecideTaskApplication, adminSaveSubreddit, adminSaveTask, adminSetTaskActive, applyToTask, cancelApplication, getTaskForUser, listMarketplace,
  listUserApplications, adminListTasks, adminListSubreddits,
} from '@/services/tasks';
import { adminAdjustWallet, getWalletSummary, listLedger } from '@/services/wallet';
import { getSettings, updateSettings } from '@/services/settings';
import { adminListUsers, adminGetUser, adminSetAccountStatus, adminProcessDeletion } from '@/services/users';
import { listAudit } from '@/services/audit';
import { listNotifications, markRead } from '@/services/notifications';
import { getAdminOverview } from '@/services/dashboard';
import { ADMIN_PERMISSIONS } from '@/services/types';
import { requestAccountDeletion } from '@/services/auth';

const PASSWORD = 'correct horse battery';
let seq = 0;
const DAY = 86400_000;

interface TestUser { id: string; email: string; username: string; code: string; reddit: string; ip: string }

async function mkUser(opts: { verified?: boolean } = {}): Promise<TestUser> {
  seq++;
  const email = `person${seq}@example.test`;
  const username = `person_${seq}`;
  const ip = `10.1.${Math.floor(seq / 250)}.${seq % 250}`;
  const { userId } = await signUp({ email, username, password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true }, { ip });
  if (opts.verified !== false) await query(`update users set email_verified_at = now() where id = $1`, [userId]);
  const code = (await query<{ verification_code: string }>(`select verification_code from users where id = $1`, [userId])).rows[0].verification_code;
  return { id: userId, email, username, code, reddit: `redditor_${seq}`, ip };
}

async function mkAdmin(perms: readonly string[] = ADMIN_PERMISSIONS): Promise<string> {
  seq++;
  const r = await query<{ id: string }>(
    `insert into users (email, username, password_hash, role, permissions, email_verified_at, verification_code)
     values ($1, $2, null, 'admin', $3, now(), 'x') returning id`,
    [`admin${seq}@example.test`, `admin_${seq}`, [...perms]],
  );
  return r.rows[0].id;
}

const ok = (u: TestUser, o: { days?: number; comment?: number; post?: number; bio?: string } = {}) => ({
  kind: 'ok' as const,
  username: u.reddit,
  createdAt: new Date(Date.now() - (o.days ?? 400) * DAY),
  commentKarma: o.comment ?? 500,
  postKarma: o.post ?? 400,
  bio: o.bio ?? `hello ${u.code}`,
  evidence: { source: 'reddit_oauth_api', fields: { name: u.reddit } },
});

async function submit(u: TestUser, lookup: any, url = `https://www.reddit.com/user/${u.reddit}/`) {
  lookupMock.mockResolvedValueOnce(lookup);
  return submitRedditAccount(u.id, { profileUrl: url }, { ip: u.ip });
}

/** A user that has been submitted, verified by the (mock) API and approved by an admin. */
async function mkApproved(admin: string, o: Parameters<typeof ok>[1] = {}): Promise<TestUser> {
  const u = await mkUser();
  const r = await submit(u, ok(u, o));
  await adminDecide(admin, r.submissionId, 'approve');
  return u;
}

const catId = async () => (await query<{ id: string }>(`select id from task_categories limit 1`)).rows[0].id;

async function mkSubreddit(admin: string, name: string, over: Record<string, unknown> = {}) {
  return adminSaveSubreddit(admin, null, {
    name, categoryId: await catId(), description: 'Test subreddit', restrictions: '', extraRequirements: '', active: true,
    minAccountAgeMonths: 0, minCommentKarma: 0, minPostKarma: 0, requiresManualReview: false, ...over,
  });
}
async function mkTask(admin: string, subredditId: string, title: string, over: Record<string, unknown> = {}) {
  return adminSaveTask(admin, null, {
    subredditId, categoryId: await catId(), title, description: 'desc', instructions: 'do the thing', reward: '', active: true, allowRepeat: false, ...over,
  });
}
const rejects = async (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

let admin: string;
beforeAll(async () => {
  await resetDbForTests();
  admin = await mkAdmin();
});
beforeEach(() => lookupMock.mockReset());

// ---------------------------------------------------------------- 1
describe('1. registration and login', () => {
  it('registers, verifies email, logs in and out', async () => {
    const r = await signUp({ email: 'New.User@Example.test', username: 'new_user', password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true }, { ip: '9.9.9.1' });
    expect(r.devLink).toBeTruthy();
    const stored = (await query(`select email, password_hash, role, email_verified_at from users where id = $1`, [r.userId])).rows[0];
    expect(stored.email).toBe('new.user@example.test'); // normalised
    expect(stored.role).toBe('user'); // public sign-up can never create an admin
    expect(stored.password_hash).toMatch(/^scrypt\$/);
    expect(stored.password_hash).not.toContain(PASSWORD);
    expect(stored.email_verified_at).toBeNull();
    const w = await getWalletSummary(r.userId);
    expect(w).toEqual({ availablePaise: 0, totalEarnedPaise: 0, pendingRewardsPaise: 0 });

    const token = new URL(r.devLink!).searchParams.get('token')!;
    expect(await verifyEmail('wrong-token')).toBe(false);
    expect(await verifyEmail(token)).toBe(true);
    expect(await verifyEmail(token)).toBe(false); // single use

    const s = await login({ email: 'new.user@example.test', password: PASSWORD }, {}, { ip: '9.9.9.1' });
    const me = await getSessionUser(s.token);
    expect(me?.id).toBe(r.userId);
    expect(me?.email_verified_at).toBeTruthy();
    const rawRow = (await query(`select token_hash from sessions where user_id = $1`, [r.userId])).rows[0];
    expect(rawRow.token_hash).not.toBe(s.token); // only a hash is stored
    await destroySession(s.token);
    expect(await getSessionUser(s.token)).toBeNull();
  });

  it('rejects bad logins with one generic message and duplicates / weak input', async () => {
    const u = await mkUser();
    await rejects(login({ email: u.email, password: 'nope-nope-nope' }, {}, { ip: '9.9.9.2' }), /Incorrect email or password/);
    await rejects(login({ email: 'ghost@example.test', password: PASSWORD }, {}, { ip: '9.9.9.2' }), /Incorrect email or password/);
    await rejects(signUp({ email: u.email, username: 'other_name', password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true }, { ip: '9.9.9.3' }), /highlighted/);
    await rejects(signUp({ email: 'x@example.test', username: u.username.toUpperCase(), password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true }, { ip: '9.9.9.3' }), /highlighted/);
    await rejects(signUp({ email: 'x@example.test', username: 'okname', password: 'short', confirmPassword: 'short', acceptTerms: true }, { ip: '9.9.9.3' }), /highlighted/);
    await rejects(signUp({ email: 'not-an-email', username: 'okname', password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true }, { ip: '9.9.9.3' }), /highlighted/);
  });

  it('rate-limits login attempts', async () => {
    const u = await mkUser();
    for (let i = 0; i < 8; i++) await login({ email: u.email, password: 'bad-bad-bad-bad' }, {}, { ip: '8.8.8.8' }).catch(() => {});
    await rejects(login({ email: u.email, password: PASSWORD }, {}, { ip: '8.8.8.8' }), /Too many/);
  });

  it('password reset works once, signs out other sessions and does not reveal accounts', async () => {
    const u = await mkUser();
    const s = await login({ email: u.email, password: PASSWORD }, {}, { ip: '7.7.7.1' });
    expect(await requestPasswordReset('nobody@example.test', { ip: '7.7.7.2' })).toEqual({});
    const { devLink } = await requestPasswordReset(u.email, { ip: '7.7.7.2' });
    const token = new URL(devLink!).searchParams.get('token')!;
    await resetPassword(token, 'brand new password!', 'brand new password!', { ip: '7.7.7.2' });
    await rejects(resetPassword(token, 'another password!!', 'another password!!', { ip: '7.7.7.2' }), /invalid or has expired/);
    expect(await getSessionUser(s.token)).toBeNull();
    await login({ email: u.email, password: 'brand new password!' }, {}, { ip: '7.7.7.3' });
  });

  it('the admin login does not accept ordinary accounts', async () => {
    const u = await mkUser();
    await rejects(login({ email: u.email, password: PASSWORD }, { adminOnly: true }, { ip: '6.6.6.6' }), /Incorrect email or password/);
  });
});

// ------------------------------------------------------------- 2–6
describe('2–6. Reddit submission and minimum requirements', () => {
  it('2. rejects invalid Reddit URLs and creates nothing', async () => {
    const u = await mkUser();
    for (const bad of ['', 'https://example.com/user/abc', 'https://www.reddit.com/r/foo/', 'not a url', 'https://reddit.com.evil.io/user/abcd']) {
      await expect(submitRedditAccount(u.id, { profileUrl: bad }, { ip: u.ip })).rejects.toMatchObject({ code: 'validation', fieldErrors: { profileUrl: expect.any(String) } });
    }
    expect(await getCurrentSubmission(u.id)).toBeNull();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('requires a verified email before submitting', async () => {
    const u = await mkUser({ verified: false });
    await rejects(submitRedditAccount(u.id, { profileUrl: `https://www.reddit.com/user/${u.reddit}/` }, { ip: u.ip }), /verify your email/i);
  });

  it('normalises the URL and records verification evidence', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u), `reddit.com/u/${u.reddit}`);
    expect(r).toMatchObject({ status: 'Pending Admin Review', verificationState: 'verified' });
    const s = (await getCurrentSubmission(u.id))!;
    expect(s.profile_url).toBe(`https://www.reddit.com/user/${u.reddit}/`);
    expect(s.values_source).toBe('reddit_api');
    const rec = (await query(`select * from verification_records where submission_id = $1`, [s.id])).rows[0];
    expect(rec.method).toBe('reddit_api');
    expect(rec.outcome).toBe('verified');
    expect(rec.evidence.source).toBe('reddit_oauth_api');
    expect(rec.checks.allPassed).toBe(true);
  });

  it.each([
    ['3. too-young account', { days: 40 }],
    ['4. too little comment karma', { comment: 99 }],
    ['5. too little post karma', { post: 99 }],
  ])('%s fails the minimum check and can never be approved', async (_n, o) => {
    const u = await mkUser();
    const r = await submit(u, ok(u, o));
    expect(r.status).toBe('Pending Admin Review'); // owner still decides, but the failure is recorded
    const detail = await adminGetApplication(admin, r.submissionId);
    expect(detail.baseCheck.allPassed).toBe(false);
    expect(detail.records[0].checks.allPassed).toBe(false);
    await rejects(adminDecide(admin, r.submissionId, 'approve'), /does not meet the platform minimums/);
    expect((await getCurrentSubmission(u.id))!.status).not.toBe('Approved');
  });

  it('exactly-at-the-minimum values pass (boundary)', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u, { days: 95, comment: 100, post: 100 }));
    const detail = await adminGetApplication(admin, r.submissionId);
    expect(detail.baseCheck.allPassed).toBe(true);
  });

  it('can auto-reject below-minimum accounts when the owner turns that on', async () => {
    await updateSettings(admin, { autoRejectBelowMinimums: true });
    try {
      const u = await mkUser();
      const r = await submit(u, ok(u, { comment: 5 }));
      expect(r.status).toBe('Rejected');
      const s = (await getCurrentSubmission(u.id))!;
      expect(s.rejection_reason).toMatch(/Comment karma/);
      expect(s.allow_resubmit).toBe(true);
      const d = await adminGetApplication(admin, s.id);
      expect(d.decisions[0].action).toBe('auto_reject');
    } finally {
      await updateSettings(admin, { autoRejectBelowMinimums: false });
    }
  });

  it('6. a fully qualifying account still waits for administrator approval', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u));
    expect(r.status).toBe('Pending Admin Review');
    const el = await getUserEligibility(u.id);
    expect(el.approved).toBe(false);
    expect(el.subreddits).toEqual([]);
    await rejects(listMarketplace(u.id), /approved/i);
  });

  it('never marks anything verified when Reddit data is unavailable — Manual Review Required', async () => {
    for (const lookup of [{ kind: 'unavailable', reason: 'not_configured' }, { kind: 'unavailable', reason: 'rate_limited' }, { kind: 'forbidden' }]) {
      const u = await mkUser();
      const r = await submit(u, lookup);
      expect(r).toMatchObject({ status: 'Pending Admin Review', verificationState: 'manual_review_required' });
      const s = (await getCurrentSubmission(u.id))!;
      expect([s.values_source, s.account_created_at, s.comment_karma, s.post_karma]).toEqual([null, null, null, null]);
      await rejects(adminDecide(admin, s.id, 'approve'), /Verified account values are required/);
    }
  });

  it('handles nonexistent and suspended Reddit accounts as Unverified', async () => {
    for (const kind of ['not_found', 'suspended']) {
      const u = await mkUser();
      expect(await submit(u, { kind })).toMatchObject({ verificationState: 'unverified' });
    }
  });

  it('admin can enter verified values manually (with audit trail) and then approve', async () => {
    const u = await mkUser();
    const r = await submit(u, { kind: 'unavailable', reason: 'not_configured' });
    await rejects(adminSetManualValues(admin, r.submissionId, { accountCreatedAt: '2999-01-01', commentKarma: 5, postKarma: 5, ownershipConfirmed: true, evidenceNote: 'looked at profile' }), /future|highlighted/);
    await rejects(adminSetManualValues(admin, r.submissionId, { accountCreatedAt: '2024-01-01', commentKarma: 5, postKarma: 5, ownershipConfirmed: true, evidenceNote: '' }), /highlighted/);
    await adminSetManualValues(admin, r.submissionId, { accountCreatedAt: '2024-01-01', commentKarma: 500, postKarma: 250, ownershipConfirmed: true, evidenceNote: 'Viewed profile, code in bio' });
    const d = await adminGetApplication(admin, r.submissionId);
    expect(d.submission).toMatchObject({ values_source: 'admin_manual', verification_state: 'verified', comment_karma: 500, ownership_state: 'confirmed' });
    expect(d.records[0]).toMatchObject({ method: 'admin_manual', checked_by: admin });
    const audit = await listAudit(admin, { action: 'submission.manual_values' });
    expect(audit.rows[0].details).toMatchObject({ comment_karma: 500, note: 'Viewed profile, code in bio' });
    await adminDecide(admin, r.submissionId, 'approve');
    expect((await getCurrentSubmission(u.id))!.status).toBe('Approved');
  });

  it('requires proof of ownership (bio code) before approval', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u, { bio: 'no code here' }));
    await rejects(adminDecide(admin, r.submissionId, 'approve'), /Ownership .* not confirmed/);
    await adminSetManualValues(admin, r.submissionId, { accountCreatedAt: '2024-01-01', commentKarma: 500, postKarma: 250, ownershipConfirmed: true, evidenceNote: 'Code seen in bio' });
    await adminDecide(admin, r.submissionId, 'approve');
  });

  it('prevents duplicate / abusive submissions', async () => {
    const a = await mkUser();
    const b = await mkUser();
    await submit(a, ok(a));
    await rejects(submit(a, ok(a)), /already being reviewed/); // pending → no second submission
    await expect(submit(b, ok(b), `https://www.reddit.com/user/${a.reddit}/`)).rejects.toMatchObject({ fieldErrors: { profileUrl: expect.stringMatching(/already linked/) } });
  });

  it('rejection needs a reason; the user sees it and may resubmit when allowed', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u));
    await expect(adminDecide(admin, r.submissionId, 'reject', { reason: '' })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    await adminDecide(admin, r.submissionId, 'reject', { reason: 'Profile looks inactive', allowResubmit: true });
    const s = (await getCurrentSubmission(u.id))!;
    expect(s).toMatchObject({ status: 'Rejected', rejection_reason: 'Profile looks inactive' });
    expect((await listNotifications(u.id)).some((n) => n.kind === 'rejected' && n.body.includes('inactive'))).toBe(true);
    const r2 = await submit(u, ok(u));
    expect(r2.status).toBe('Pending Admin Review');
    const prev = (await adminGetApplication(admin, r2.submissionId)).previous;
    expect(prev).toHaveLength(1);
    await adminDecide(admin, r2.submissionId, 'reject', { reason: 'Final decision', allowResubmit: false });
    await rejects(submit(u, ok(u)), /not available|contact support/i);
  });

  it('request-more-info moves to Needs More Information and allows a response', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u));
    await adminDecide(admin, r.submissionId, 'request_info', { reason: 'Please add the code to your bio' });
    expect((await getCurrentSubmission(u.id))!.status).toBe('Needs More Information');
    const r2 = await submit(u, ok(u));
    expect(r2.status).toBe('Pending Admin Review');
  });

  it('re-running verification keeps administrator-entered values if Reddit is down', async () => {
    const u = await mkUser();
    const r = await submit(u, { kind: 'unavailable', reason: 'network' });
    await adminSetManualValues(admin, r.submissionId, { accountCreatedAt: '2024-01-01', commentKarma: 321, postKarma: 123, ownershipConfirmed: true, evidenceNote: 'checked by hand' });
    lookupMock.mockResolvedValueOnce({ kind: 'unavailable', reason: 'network' });
    await adminReverify(admin, r.submissionId);
    const s = (await getCurrentSubmission(u.id))!;
    expect(s).toMatchObject({ comment_karma: 321, values_source: 'admin_manual', verification_state: 'verified' });
    expect((await adminGetApplication(admin, r.submissionId)).records).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- 7
describe('7. administrator review', () => {
  it('lists the queue with everything the owner needs and approves', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u));
    const q = await adminListApplications(admin, { status: 'Pending Admin Review', q: u.reddit });
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0]).toMatchObject({ platform_username: u.username, reddit_username: u.reddit, values_source: 'reddit_api', comment_karma: 500, post_karma: 400, attempts: 1 });
    expect(q.rows[0].profile_url).toBe(`https://www.reddit.com/user/${u.reddit}/`);
    await adminDecide(admin, r.submissionId, 'approve');
    const s = (await getCurrentSubmission(u.id))!;
    expect(s).toMatchObject({ status: 'Approved', decided_by: admin });
    expect((await listNotifications(u.id)).some((n) => n.kind === 'approved')).toBe(true);
    const audit = await listAudit(admin, { action: 'submission.approve' });
    expect(audit.rows[0]).toMatchObject({ actor_id: admin, target_id: r.submissionId });
    expect(audit.rows[0].actor_label).toContain('admin_');
  });

  it('refuses invalid state transitions', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u));
    await rejects(adminDecide(admin, r.submissionId, 'suspend', { reason: 'nope' }), /Cannot suspend/);
    await rejects(adminDecide(admin, r.submissionId, 'reinstate'), /Cannot reinstate/);
    await adminDecide(admin, r.submissionId, 'approve');
    await rejects(adminDecide(admin, r.submissionId, 'approve'), /Cannot approve/);
  });
});

// ------------------------------------------------------------ 8, 9, 10
describe('8–10. task marketplace and server-side enforcement', () => {
  let subLow: string, subHigh: string, taskLow: string, taskHigh: string;
  beforeAll(async () => {
    subLow = await mkSubreddit(admin, 'LowBar');
    subHigh = await mkSubreddit(admin, 'HighBar', { minCommentKarma: 1000 });
    taskLow = await mkTask(admin, subLow, 'Low bar task');
    taskHigh = await mkTask(admin, subHigh, 'High bar task');
  });

  it('8. an approved user sees only tasks they qualify for, with real values', async () => {
    const u = await mkApproved(admin, { comment: 300, post: 200 });
    const tasks = await listMarketplace(u.id);
    expect(tasks.map((t) => t.title)).toContain('Low bar task');
    expect(tasks.map((t) => t.title)).not.toContain('High bar task');
    const el = await getUserEligibility(u.id);
    expect(el.account).toMatchObject({ commentKarma: 300, postKarma: 200, source: 'reddit_api' });
    const high = el.subreddits.find((s) => s.subreddit.name === 'HighBar')!;
    expect(high.eligibility.state).toBe('unavailable');
    expect(high.eligibility.unmet[0]).toMatch(/Comment karma: at least 1000 required — yours is 300/);
    expect(el.eligibleCount).toBe(el.subreddits.filter((s) => s.eligibility.state !== 'unavailable').length);
    await rejects(getTaskForUser(u.id, taskHigh), /requirements|karma/i);
  });

  it('filters and searches', async () => {
    const u = await mkApproved(admin, { comment: 5000, post: 200 });
    expect((await listMarketplace(u.id, { q: 'high bar' })).map((t) => t.title)).toEqual(['High bar task']);
    expect((await listMarketplace(u.id, { subreddit: subLow })).map((t) => t.title)).toEqual(['Low bar task']);
    expect(await listMarketplace(u.id, { q: 'zzzz-no-match' })).toEqual([]);
  });

  it('9. pending, rejected and unsubmitted users cannot see or apply to approved-only tasks', async () => {
    const none = await mkUser();
    const pending = await mkUser();
    await submit(pending, ok(pending));
    const rejected = await mkUser();
    const rr = await submit(rejected, ok(rejected));
    await adminDecide(admin, rr.submissionId, 'reject', { reason: 'Profile does not match the requirements.' });
    for (const u of [none, pending, rejected]) {
      await rejects(listMarketplace(u.id), /approved/i);
      await rejects(getTaskForUser(u.id, taskLow), /approved|requirements/i);
      await rejects(applyToTask(u.id, taskLow, ''), /approved|requirements/i);
      expect((await getUserEligibility(u.id)).subreddits).toEqual([]);
    }
  });

  it('10. an ineligible user cannot bypass the UI to apply', async () => {
    const u = await mkApproved(admin, { comment: 300, post: 200 });
    await rejects(applyToTask(u.id, taskHigh, ''), /do not currently meet|requirements/i);
    expect(await listUserApplications(u.id)).toEqual([]);
    await rejects(applyToTask(u.id, '00000000-0000-0000-0000-000000000000', ''), /could not be found/);
    await rejects(applyToTask(u.id, "'; drop table users; --", ''), /could not be found/);
    // direct attempt with a made-up admin-ish id
    await rejects(adminDecideTaskApplication(u.id, '00000000-0000-0000-0000-000000000000', 'Accepted'), /Administrator|permission/);
  });

  it('applies successfully, snapshots the evaluation and blocks duplicates', async () => {
    const u = await mkApproved(admin);
    const a = await applyToTask(u.id, taskLow, 'please pick me');
    expect(a.status).toBe('Applied');
    const row = (await query(`select eligibility_snapshot from task_applications where id = $1`, [a.id])).rows[0];
    expect(row.eligibility_snapshot.values.comment_karma).toBe(500);
    await rejects(applyToTask(u.id, taskLow, ''), /already have an open application/);
    // concurrent double submit → exactly one succeeds
    const u2 = await mkApproved(admin);
    const results = await Promise.allSettled([applyToTask(u2.id, taskLow, ''), applyToTask(u2.id, taskLow, '')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // cancel, then re-apply is allowed
    await cancelApplication(u2.id, (await listUserApplications(u2.id))[0].id);
    expect((await applyToTask(u2.id, taskLow, '')).status).toBe('Applied');
  });

  it('applications close when the owner switches them off, and for deactivated tasks', async () => {
    const u = await mkApproved(admin);
    const t = await mkTask(admin, subLow, 'Temp task');
    await adminSetTaskActive(admin, t, false);
    await rejects(applyToTask(u.id, t, ''), /no longer available/);
    await adminSetTaskActive(admin, t, true);
    await updateSettings(admin, { taskApplicationsOpen: false });
    await rejects(applyToTask(u.id, t, ''), /temporarily closed/);
    await updateSettings(admin, { taskApplicationsOpen: true });
    await applyToTask(u.id, t, '');
  });

  it('subreddits that need manual review start applications as Under Review', async () => {
    const u = await mkApproved(admin);
    const s = await mkSubreddit(admin, 'ManualOnly', { requiresManualReview: true });
    const t = await mkTask(admin, s, 'Manual task');
    const eligibility = (await getUserEligibility(u.id)).subreddits.find((x) => x.subreddit.name === 'ManualOnly')!.eligibility;
    expect(eligibility.state).toBe('eligible_review');
    expect((await applyToTask(u.id, t, '')).status).toBe('Under Review');
  });

  it('enforces suspension on the backend', async () => {
    const u = await mkUser();
    const r = await submit(u, ok(u));
    await adminDecide(admin, r.submissionId, 'approve');
    const a = await applyToTask(u.id, taskLow, '');
    await rejects(adminDecide(admin, r.submissionId, 'suspend', { reason: '' }), /highlighted/);
    await adminDecide(admin, r.submissionId, 'suspend', { reason: 'Abuse reported' });
    await rejects(listMarketplace(u.id), /approved/i);
    await rejects(applyToTask(u.id, taskLow, ''), /suspended|approved/i);
    await rejects(adminDecideTaskApplication(admin, a.id, 'Accepted'), /good standing/);
    expect((await getUserEligibility(u.id)).restricted).toBe(true);
    await adminDecide(admin, r.submissionId, 'reinstate');
    expect((await listMarketplace(u.id)).length).toBeGreaterThan(0);
  });

  it('an account-level block ends sessions and prevents login', async () => {
    const u = await mkApproved(admin);
    const s = await login({ email: u.email, password: PASSWORD }, {}, { ip: '5.5.5.5' });
    await adminSetAccountStatus(admin, u.id, 'suspended', 'Fraud');
    expect(await getSessionUser(s.token)).toBeNull();
    await rejects(login({ email: u.email, password: PASSWORD }, {}, { ip: '5.5.5.5' }), /suspended/);
    await rejects(applyToTask(u.id, taskLow, ''), /suspended/);
    await adminSetAccountStatus(admin, u.id, 'active', '');
    await login({ email: u.email, password: PASSWORD }, {}, { ip: '5.5.5.5' });
  });
});

// ---------------------------------------------------------------- 11
describe('11. users cannot reach each other’s private data', () => {
  it('scopes notifications, applications, wallet and admin views', async () => {
    const sub = await mkSubreddit(admin, 'PrivacyTest');
    const task = await mkTask(admin, sub, 'Privacy task');
    const a = await mkApproved(admin);
    const b = await mkApproved(admin);
    const appB = await applyToTask(b.id, task, 'secret note');
    expect((await listUserApplications(a.id)).map((x) => x.id)).not.toContain(appB.id);
    await rejects(cancelApplication(a.id, appB.id), /cannot be cancelled/);
    expect((await listUserApplications(b.id))[0].status).toBe('Applied');

    const nb = (await listNotifications(b.id))[0];
    await markRead(a.id, nb.id);
    expect((await listNotifications(b.id)).find((n) => n.id === nb.id)!.read_at).toBeNull();
    expect((await listNotifications(a.id)).map((n) => n.id)).not.toContain(nb.id);

    await adminAdjustWallet(admin, { userId: b.id, direction: 'credit', amount: '10', reason: 'privacy test', idempotencyKey: 'privacy-test-key-1' });
    expect((await listLedger(a.id)).rows.every((r) => r.user_id === a.id)).toBe(true);
    expect((await getWalletSummary(a.id)).availablePaise).toBe(0);

    await rejects(adminGetUser(a.id, b.id), /Administrator/);
    await rejects(adminGetApplication(a.id, (await getCurrentSubmission(b.id))!.id), /Administrator/);
  });
});

// ---------------------------------------------------------------- 12
describe('12. non-admins cannot use administrator functions', () => {
  it('rejects ordinary users, unknown ids and admins lacking the permission', async () => {
    const u = await mkApproved(admin);
    const sub = await mkSubreddit(admin, 'AdminOnly');
    const s = (await getCurrentSubmission(u.id))!;
    const input = {
      name: 'Hack', categoryId: await catId(), description: '', restrictions: '', extraRequirements: '', active: true,
      minAccountAgeMonths: 0, minCommentKarma: 0, minPostKarma: 0, requiresManualReview: false,
    };
    const calls: [string, () => Promise<unknown>][] = [
      ['overview', () => getAdminOverview(u.id)],
      ['queue', () => adminListApplications(u.id)],
      ['approve own', () => adminDecide(u.id, s.id, 'approve')],
      ['manual values', () => adminSetManualValues(u.id, s.id, { accountCreatedAt: '2020-01-01', commentKarma: 9999, postKarma: 9999, ownershipConfirmed: true, evidenceNote: 'self-served' })],
      ['save subreddit', () => adminSaveSubreddit(u.id, null, input)],
      ['edit subreddit', () => adminSaveSubreddit(u.id, sub, input)],
      ['save task', () => adminSaveTask(u.id, null, { subredditId: sub, categoryId: input.categoryId, title: 'Mine', description: '', instructions: '', reward: '100', active: true, allowRepeat: true })],
      ['list tasks', () => adminListTasks(u.id)],
      ['list subs', () => adminListSubreddits(u.id)],
      ['settings', () => updateSettings(u.id, { minCommentKarma: 0, minPostKarma: 0, minAccountAgeMonths: 0 })],
      ['wallet', () => adminAdjustWallet(u.id, { userId: u.id, direction: 'credit', amount: '1000', reason: 'give me money', idempotencyKey: 'hack-hack-1' })],
      ['users', () => adminListUsers(u.id)],
      ['block', () => adminSetAccountStatus(u.id, admin, 'suspended', 'lol')],
      ['audit', () => listAudit(u.id)],
      ['delete', () => adminProcessDeletion(u.id, u.id)],
    ];
    for (const [name, fn] of calls) await expect(fn(), name).rejects.toThrow(/Administrator access|permission|log in/i);

    const limited = await mkAdmin(['review_applications']);
    await rejects(adminAdjustWallet(limited, { userId: u.id, direction: 'credit', amount: '5', reason: 'nope nope', idempotencyKey: 'limited-admin-1' }), /permission/);
    await rejects(updateSettings(limited, { minCommentKarma: 1 }), /permission/);
    await rejects(adminSaveSubreddit(limited, null, input), /permission/);
    await adminListApplications(limited); // allowed
    await rejects(adminDecide('11111111-1111-1111-1111-111111111111', s.id, 'approve'), /log in/i);

    // a suspended admin loses access immediately, even with a still-valid session object
    const gone = await mkAdmin();
    await query(`update users set status = 'suspended' where id = $1`, [gone]);
    await rejects(getAdminOverview(gone), /Administrator access/);
    expect((await getSettings()).minCommentKarma).toBe(100); // untouched by any of the above
    expect(await getWalletSummary(u.id)).toMatchObject({ availablePaise: 0 });
  });
});

// ---------------------------------------------------------------- 13
describe('13. eligibility follows rule changes', () => {
  it('re-evaluates after subreddit and platform rule edits, logs them and notifies', async () => {
    const sub = await mkSubreddit(admin, 'Movable');
    await mkTask(admin, sub, 'Movable task');
    const u = await mkApproved(admin, { comment: 300, post: 200, days: 400 });
    const state = async () => (await getUserEligibility(u.id)).subreddits.find((s) => s.subreddit.name === 'Movable')!.eligibility.state;
    expect(await state()).toBe('eligible');

    const edit = (over: Record<string, unknown>) =>
      mkSubredditEdit(sub, over);
    async function mkSubredditEdit(id: string, over: Record<string, unknown>) {
      return adminSaveSubreddit(admin, id, {
        name: 'Movable', categoryId: await catId(), description: 'Test subreddit', restrictions: '', extraRequirements: '', active: true,
        minAccountAgeMonths: 0, minCommentKarma: 0, minPostKarma: 0, requiresManualReview: false, ...over,
      });
    }
    await edit({ minCommentKarma: 400 });
    expect(await state()).toBe('unavailable');
    await edit({ minCommentKarma: 400, minAccountAgeMonths: 36 }); // age requirement
    expect(await state()).toBe('unavailable');
    const before = (await listNotifications(u.id)).filter((n) => n.kind === 'new_tasks').length;
    await edit({ minCommentKarma: 250 }); // helper resets the age requirement to 0 → user becomes eligible
    expect(await state()).toBe('eligible');
    expect((await listNotifications(u.id)).filter((n) => n.kind === 'new_tasks').length).toBe(before + 1); // notified once on the transition
    await edit({ minCommentKarma: 250, minAccountAgeMonths: 6 }); // still eligible → no duplicate notification
    expect(await state()).toBe('eligible');
    expect((await listNotifications(u.id)).filter((n) => n.kind === 'new_tasks').length).toBe(before + 1);
    await edit({ active: false });
    expect((await getUserEligibility(u.id)).subreddits.find((s) => s.subreddit.name === 'Movable')).toBeUndefined();

    // platform-wide thresholds
    await edit({ active: true });
    expect(await state()).toBe('eligible');
    await updateSettings(admin, { minPostKarma: 250 });
    expect(await state()).toBe('unavailable');
    await updateSettings(admin, { minPostKarma: 100 });
    expect(await state()).toBe('eligible');

    const audit = await listAudit(admin, { action: 'subreddit.update', targetId: sub });
    expect(audit.rows.length).toBeGreaterThanOrEqual(4);
    expect(audit.rows.at(-1)!.details).toHaveProperty('before');
    expect((await listAudit(admin, { action: 'settings.update' })).rows[0].details).toMatchObject({ minPostKarma: { from: 250, to: 100 } });
  });

  it('rejects out-of-range settings', async () => {
    await rejects(updateSettings(admin, { minCommentKarma: -5 }), /highlighted/);
    await rejects(updateSettings(admin, { supportEmail: 'not-an-email' }), /highlighted/);
    expect((await getSettings()).minCommentKarma).toBe(100);
  });
});

// ---------------------------------------------------------------- 14
describe('14. wallet ledger', () => {
  it('records adjustments, shows who/when, is idempotent and never goes negative', async () => {
    const u = await mkApproved(admin);
    expect((await getWalletSummary(u.id)).availablePaise).toBe(0);
    const r1 = await adminAdjustWallet(admin, { userId: u.id, direction: 'credit', amount: '250.50', reason: 'Goodwill credit', idempotencyKey: 'wallet-key-0001' });
    expect(r1).toEqual({ duplicate: false, balanceAfterPaise: 25050 });
    const again = await adminAdjustWallet(admin, { userId: u.id, direction: 'credit', amount: '250.50', reason: 'Goodwill credit', idempotencyKey: 'wallet-key-0001' });
    expect(again.duplicate).toBe(true);
    expect((await getWalletSummary(u.id)).availablePaise).toBe(25050);

    await adminAdjustWallet(admin, { userId: u.id, direction: 'debit', amount: '50', reason: 'Correction of error', idempotencyKey: 'wallet-key-0002' });
    await rejects(adminAdjustWallet(admin, { userId: u.id, direction: 'debit', amount: '999', reason: 'Too much', idempotencyKey: 'wallet-key-0003' }), /larger than the available balance/);
    await expect(adminAdjustWallet(admin, { userId: u.id, direction: 'credit', amount: '10', reason: '', idempotencyKey: 'wallet-key-0004' })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    await expect(adminAdjustWallet(admin, { userId: u.id, direction: 'credit', amount: '-5', reason: 'negative', idempotencyKey: 'wallet-key-0005' })).rejects.toMatchObject({ fieldErrors: { amount: expect.any(String) } });
    await expect(adminAdjustWallet(admin, { userId: u.id, direction: 'credit', amount: '0', reason: 'zero amount', idempotencyKey: 'wallet-key-0006' })).rejects.toMatchObject({ fieldErrors: { amount: expect.any(String) } });

    const w = await getWalletSummary(u.id);
    expect(w.availablePaise).toBe(20050);
    expect(w.totalEarnedPaise).toBe(0); // adjustments are not "earnings"
    const { rows } = await listLedger(u.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ direction: 'debit', amount_paise: 5000, balance_after_paise: 20050, status: 'posted', created_by: admin });
    expect(rows[0].created_by_name).toContain('admin_');
    expect(rows[0].created_at).toBeInstanceOf(Date);
    expect((await listAudit(admin, { action: 'wallet.adjust' })).rows[0].details).toMatchObject({ reason: 'Correction of error' });
    expect((await listNotifications(u.id)).some((n) => n.kind === 'wallet')).toBe(true);
    // balance always equals the sum of the ledger
    const sum = (await query<{ s: number }>(`select coalesce(sum(case when direction='credit' then amount_paise else -amount_paise end),0)::bigint as s from wallet_ledger where user_id = $1`, [u.id])).rows[0].s;
    expect(sum).toBe(w.availablePaise);
  });

  it('cannot be changed by anyone but the ledger: no direct edits, no history rewrites', async () => {
    const u = await mkApproved(admin);
    await adminAdjustWallet(admin, { userId: u.id, direction: 'credit', amount: '5', reason: 'seed for test', idempotencyKey: 'wallet-key-0100' });
    await rejects(query(`update wallets set available_paise = 99999900 where user_id = $1`, [u.id]), /only change through wallet_ledger/);
    await rejects(query(`update wallet_ledger set amount_paise = 1 where user_id = $1`, [u.id]), /append-only/);
    await rejects(query(`delete from wallet_ledger where user_id = $1`, [u.id]), /append-only/);
    await rejects(query(`delete from audit_logs`), /append-only/);
    await rejects(query(`insert into wallets (user_id, available_paise) values (gen_random_uuid(), 5)`), /violates foreign key|created empty/);
  });

  it('switches off globally when the owner disables adjustments', async () => {
    const u = await mkApproved(admin);
    await updateSettings(admin, { walletAdjustmentsEnabled: false });
    await rejects(adminAdjustWallet(admin, { userId: u.id, direction: 'credit', amount: '5', reason: 'should fail', idempotencyKey: 'wallet-key-0200' }), /switched off/);
    await updateSettings(admin, { walletAdjustmentsEnabled: true });
  });

  it('credits a task reward exactly once, only when an admin completes it', async () => {
    const u = await mkApproved(admin);
    const sub = await mkSubreddit(admin, 'Rewarding');
    const task = await mkTask(admin, sub, 'Paid task', { reward: '75.25' });
    const app = await applyToTask(u.id, task, '');
    expect((await getWalletSummary(u.id)).availablePaise).toBe(0); // applying earns nothing
    await adminDecideTaskApplication(admin, app.id, 'Under Review');
    await adminDecideTaskApplication(admin, app.id, 'Accepted');
    expect(await getWalletSummary(u.id)).toMatchObject({ availablePaise: 0, pendingRewardsPaise: 7525 });
    await rejects(adminDecideTaskApplication(admin, app.id, 'Applied' as any), /cannot be changed/);
    expect(await adminDecideTaskApplication(admin, app.id, 'Completed', { creditReward: true })).toEqual({ rewardCredited: true });
    await rejects(adminDecideTaskApplication(admin, app.id, 'Completed', { creditReward: true }), /cannot be changed/);
    expect(await getWalletSummary(u.id)).toMatchObject({ availablePaise: 7525, totalEarnedPaise: 7525, pendingRewardsPaise: 0 });
    expect((await listLedger(u.id)).rows[0]).toMatchObject({ kind: 'task_reward', amount_paise: 7525 });
    expect((await listUserApplications(u.id))[0]).toMatchObject({ status: 'Completed', reward_credited_paise: 7525 });

    // completing without ticking "credit" does not pay
    const t2 = await mkTask(admin, sub, 'Unpaid completion', { reward: '10' });
    const a2 = await applyToTask(u.id, t2, '');
    await adminDecideTaskApplication(admin, a2.id, 'Accepted');
    await adminDecideTaskApplication(admin, a2.id, 'Completed', { creditReward: false });
    expect((await getWalletSummary(u.id)).availablePaise).toBe(7525);
    // rejection needs a reason
    const t3 = await mkTask(admin, sub, 'Rejectable');
    const a3 = await applyToTask(u.id, t3, '');
    await expect(adminDecideTaskApplication(admin, a3.id, 'Rejected')).rejects.toMatchObject({ fieldErrors: { note: expect.any(String) } });
    await adminDecideTaskApplication(admin, a3.id, 'Rejected', { note: 'Does not fit' });
  });
});

// ------------------------------------------------------------- misc
describe('account deletion and test-data separation', () => {
  it('lets a user request deletion; an admin anonymises while keeping the ledger', async () => {
    const u = await mkApproved(admin);
    await adminAdjustWallet(admin, { userId: u.id, direction: 'credit', amount: '20', reason: 'before deletion', idempotencyKey: 'wallet-key-0300' });
    await rejects(requestAccountDeletion(u.id, 'wrong password'), /highlighted|not correct/);
    await requestAccountDeletion(u.id, PASSWORD);
    expect((await adminListUsers(admin, { filter: 'deletion' })).rows.map((r) => r.id)).toContain(u.id);
    await adminProcessDeletion(admin, u.id);
    const row = (await query(`select email, username, password_hash, deleted_at from users where id = $1`, [u.id])).rows[0];
    expect(row.email).toMatch(/@deleted\.invalid$/);
    expect(row.password_hash).toBeNull();
    expect(row.deleted_at).toBeTruthy();
    expect((await query(`select 1 from reddit_submissions where user_id = $1`, [u.id])).rowCount).toBe(0);
    expect((await query(`select 1 from wallet_ledger where user_id = $1`, [u.id])).rowCount).toBe(1); // retained
    await rejects(login({ email: u.email, password: PASSWORD }, {}, { ip: '4.4.4.4' }), /Incorrect/);
  });

  it('exposes only real counts on the admin overview', async () => {
    const o = await getAdminOverview(admin);
    expect(o.totalUsers).toBeGreaterThan(5);
    expect(o.approvedUsers).toBeGreaterThan(0);
    expect(o.recent.length).toBeGreaterThan(0);
  });

  it('keeps default content free of fake tasks or subreddits on a fresh database', async () => {
    await resetDbForTests();
    expect((await query(`select 1 from tasks`)).rowCount).toBe(0);
    expect((await query(`select 1 from subreddits`)).rowCount).toBe(0);
    expect((await query(`select 1 from users`)).rowCount).toBe(0);
    expect((await query(`select 1 from wallet_ledger`)).rowCount).toBe(0);
    expect((await query(`select value from platform_settings where key = 'min_account_age_months'`)).rows[0].value).toBe(3);
  });
});
