import 'server-only';
import type { Queryable } from '@/lib/db';
import { query } from '@/lib/db';
import {
  accountAgeMonths,
  evaluateSubreddit,
  isEligible,
  type EligibilityContext,
  type SubredditEligibility,
  type SubredditRules,
  type Thresholds,
  type VerifiedValues,
} from '@/lib/eligibility';
import { getUserRow, type UserRow } from './authz';
import { getSettings } from './settings-store';
import type { SubmissionRow } from './types';

export interface SubredditRow {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  description: string;
  restrictions: string;
  extra_requirements: string;
  active: boolean;
  min_account_age_months: number;
  min_comment_karma: number;
  min_post_karma: number;
  requires_manual_review: boolean;
}

export const SUBREDDIT_SELECT = `select s.id, s.name, s.category_id, c.name as category_name, s.description, s.restrictions,
  s.extra_requirements, s.active, s.min_account_age_months, s.min_comment_karma, s.min_post_karma, s.requires_manual_review
  from subreddits s join task_categories c on c.id = s.category_id`;

export function rulesOf(s: SubredditRow): SubredditRules {
  return {
    minAccountAgeMonths: s.min_account_age_months,
    minCommentKarma: s.min_comment_karma,
    minPostKarma: s.min_post_karma,
    requiresManualReview: s.requires_manual_review,
    extraRequirements: s.extra_requirements,
  };
}

export function valuesOf(s: SubmissionRow | null): VerifiedValues | null {
  if (!s || !s.values_source || !s.account_created_at || s.comment_karma === null || s.post_karma === null) return null;
  return {
    accountCreatedAt: s.account_created_at,
    commentKarma: s.comment_karma,
    postKarma: s.post_karma,
    source: s.values_source,
    verifiedAt: s.verified_at,
  };
}

export async function getBaseThresholds(db?: Queryable): Promise<Thresholds> {
  const s = await getSettings(db);
  return { minAccountAgeMonths: s.minAccountAgeMonths, minCommentKarma: s.minCommentKarma, minPostKarma: s.minPostKarma };
}

export async function getCurrentSubmissionRow(db: Queryable, userId: string): Promise<SubmissionRow | null> {
  return (
    (await db.query<SubmissionRow>(`select * from reddit_submissions where user_id = $1 and superseded_at is null`, [userId])).rows[0] ?? null
  );
}

export interface UserEligibilityContext {
  ctx: EligibilityContext;
  submission: SubmissionRow | null;
  user: UserRow;
}

/** Everything needed to evaluate a user, read straight from the database at call time. */
export async function loadUserContext(db: Queryable, userId: string, now: Date = new Date()): Promise<UserEligibilityContext | null> {
  const user = await getUserRow(db, userId);
  if (!user) return null;
  const submission = await getCurrentSubmissionRow(db, userId);
  const values = valuesOf(submission);
  const base = await getBaseThresholds(db);
  const restricted = user.status !== 'active' || submission?.status === 'Suspended';
  const approved = user.status === 'active' && submission?.status === 'Approved' && values !== null;
  return { ctx: { approved, restricted, values, base, now }, submission, user };
}

export interface AccountSummary {
  redditUsername: string;
  ageMonths: number;
  accountCreatedAt: Date;
  commentKarma: number;
  postKarma: number;
  source: VerifiedValues['source'];
  verifiedAt: Date | null;
}

export interface UserEligibility {
  approved: boolean;
  restricted: boolean;
  account: AccountSummary | null;
  base: Thresholds;
  subreddits: { subreddit: SubredditRow; eligibility: SubredditEligibility }[];
  eligibleCount: number;
}

export async function listActiveSubreddits(db: Queryable): Promise<SubredditRow[]> {
  return (await db.query<SubredditRow>(`${SUBREDDIT_SELECT} where s.active order by lower(s.name)`)).rows;
}

/**
 * Per-user eligibility for every active subreddit. Computed live on each call, so any
 * rule change is reflected immediately. Subreddit data is only returned to approved users.
 */
export async function getUserEligibility(userId: string, db: Queryable = { query }): Promise<UserEligibility> {
  const loaded = await loadUserContext(db, userId);
  if (!loaded) throw new Error('user not found');
  const { ctx, submission } = loaded;
  const account: AccountSummary | null =
    ctx.values && submission
      ? {
          redditUsername: submission.reddit_username,
          ageMonths: accountAgeMonths(ctx.values.accountCreatedAt, ctx.now),
          accountCreatedAt: ctx.values.accountCreatedAt,
          commentKarma: ctx.values.commentKarma,
          postKarma: ctx.values.postKarma,
          source: ctx.values.source,
          verifiedAt: ctx.values.verifiedAt,
        }
      : null;

  if (!ctx.approved) {
    return { approved: false, restricted: ctx.restricted, account, base: ctx.base, subreddits: [], eligibleCount: 0 };
  }
  const subs = await listActiveSubreddits(db);
  const results = subs.map((s) => ({ subreddit: s, eligibility: evaluateSubreddit(rulesOf(s), ctx) }));
  return {
    approved: true,
    restricted: false,
    account,
    base: ctx.base,
    subreddits: results,
    eligibleCount: results.filter((r) => isEligible(r.eligibility)).length,
  };
}

/** Is this user eligible for this subreddit right now? Used to re-check at application time. */
export async function evaluateUserForSubreddit(
  db: Queryable,
  userId: string,
  subreddit: SubredditRow,
): Promise<{ eligibility: SubredditEligibility; ctx: EligibilityContext }> {
  const loaded = await loadUserContext(db, userId);
  if (!loaded) throw new Error('user not found');
  return { eligibility: evaluateSubreddit(rulesOf(subreddit), loaded.ctx), ctx: loaded.ctx };
}

// ---------- change detection: "new eligible tasks are available" ----------

/** userId → set of ids of active tasks (in active subreddits) the user currently qualifies for. */
export async function snapshotEligibleTasks(db: Queryable = { query }): Promise<Map<string, Set<string>>> {
  const users = (
    await db.query<{
      user_id: string;
      account_created_at: Date;
      comment_karma: number;
      post_karma: number;
      values_source: VerifiedValues['source'];
      verified_at: Date | null;
    }>(
      `select u.id as user_id, s.account_created_at, s.comment_karma, s.post_karma, s.values_source, s.verified_at
         from users u join reddit_submissions s on s.user_id = u.id and s.superseded_at is null and s.status = 'Approved'
        where u.status = 'active' and u.deleted_at is null and s.account_created_at is not null`,
    )
  ).rows;
  const out = new Map<string, Set<string>>();
  if (!users.length) return out;

  const subs = new Map((await listActiveSubreddits(db)).map((s) => [s.id, s]));
  const tasks = (
    await db.query<{ id: string; subreddit_id: string }>(
      `select t.id, t.subreddit_id from tasks t join subreddits s on s.id = t.subreddit_id where t.active and s.active`,
    )
  ).rows;
  const base = await getBaseThresholds(db);
  const now = new Date();

  for (const u of users) {
    const ctx: EligibilityContext = {
      approved: true,
      restricted: false,
      base,
      now,
      values: {
        accountCreatedAt: u.account_created_at,
        commentKarma: u.comment_karma,
        postKarma: u.post_karma,
        source: u.values_source,
        verifiedAt: u.verified_at,
      },
    };
    const perSub = new Map<string, boolean>();
    const set = new Set<string>();
    for (const t of tasks) {
      const sub = subs.get(t.subreddit_id);
      if (!sub) continue;
      if (!perSub.has(sub.id)) perSub.set(sub.id, isEligible(evaluateSubreddit(rulesOf(sub), ctx)));
      if (perSub.get(sub.id)) set.add(t.id);
    }
    out.set(u.user_id, set);
  }
  return out;
}

/**
 * Run a rule/task mutation, then notify every approved user who newly qualifies for tasks
 * because of it. Eligibility itself is never cached, so no explicit "recalculation" is needed.
 */
export async function withEligibilityDiff<T>(mutation: () => Promise<T>): Promise<T> {
  let before: Map<string, Set<string>> | null = null;
  try {
    before = await snapshotEligibleTasks();
  } catch (e) {
    console.error('[eligibility] snapshot (before) failed:', (e as Error).message);
  }
  const result = await mutation();
  if (before) {
    try {
      const after = await snapshotEligibleTasks();
      for (const [userId, tasks] of after) {
        const prior = before.get(userId) ?? new Set<string>();
        let gained = 0;
        for (const id of tasks) if (!prior.has(id)) gained++;
        if (gained > 0) {
          await query(`insert into notifications (user_id, kind, title, body, link) values ($1, 'new_tasks', $2, $3, '/tasks')`, [
            userId,
            gained === 1 ? 'A new task is available' : `${gained} new tasks are available`,
            gained === 1 ? 'A task that matches your account was just added or unlocked.' : 'Tasks that match your account were just added or unlocked.',
          ]);
        }
      }
    } catch (e) {
      console.error('[eligibility] snapshot (after) failed:', (e as Error).message);
    }
  }
  return result;
}
