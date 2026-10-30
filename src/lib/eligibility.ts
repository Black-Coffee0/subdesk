/**
 * Pure eligibility engine — no database, no I/O, fully unit-testable.
 *
 * Two separate questions are answered here:
 *   1. Does the account meet the PLATFORM minimums?          (checkBase)
 *   2. Does it meet a specific SUBREDDIT's configured rules? (evaluateSubreddit)
 * Meeting the numbers never guarantees a subreddit will accept the person; that is
 * why subreddit-specific manual review / extra requirements are surfaced separately.
 */

export interface VerifiedValues {
  accountCreatedAt: Date;
  commentKarma: number;
  postKarma: number;
  source: 'reddit_api' | 'admin_manual' | 'test_fixture';
  verifiedAt: Date | null;
}

export interface Thresholds {
  minAccountAgeMonths: number;
  minCommentKarma: number;
  minPostKarma: number;
}

export interface SubredditRules {
  minAccountAgeMonths: number;
  minCommentKarma: number;
  minPostKarma: number;
  requiresManualReview: boolean;
  extraRequirements: string;
}

export interface Check {
  key: 'age' | 'comment' | 'post';
  label: string;
  required: number;
  actual: number | null;
  passed: boolean | null; // null = cannot be determined
  unit: 'months' | 'karma';
}

export type EligibilityState =
  | 'eligible' // meets every configured rule
  | 'eligible_review' // meets the numbers, but admin review / extra requirements still apply
  | 'unavailable'; // does not currently qualify (or access is restricted)

export interface SubredditEligibility {
  state: EligibilityState;
  checks: Check[];
  unmet: string[];
  notes: string[];
  blockedReason?: string;
}

/** Add whole calendar months in UTC, clamping to month end (Jan 31 + 1 month = Feb 28/29). */
export function addMonthsUTC(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Number of full calendar months the account has existed at `now`. */
export function accountAgeMonths(createdAt: Date, now: Date = new Date()): number {
  if (createdAt.getTime() > now.getTime()) return 0;
  let months =
    (now.getUTCFullYear() - createdAt.getUTCFullYear()) * 12 + (now.getUTCMonth() - createdAt.getUTCMonth());
  if (months < 0) return 0;
  while (months > 0 && addMonthsUTC(createdAt, months).getTime() > now.getTime()) months--;
  return months;
}

function ageCheck(required: number, v: VerifiedValues | null, now: Date, label = 'Account age'): Check {
  if (!v) return { key: 'age', label, required, actual: null, passed: null, unit: 'months' };
  const months = accountAgeMonths(v.accountCreatedAt, now);
  return { key: 'age', label, required, actual: months, passed: addMonthsUTC(v.accountCreatedAt, required).getTime() <= now.getTime(), unit: 'months' };
}

function karmaCheck(key: 'comment' | 'post', label: string, required: number, actual: number | null): Check {
  return { key, label, required, actual, passed: actual === null ? null : actual >= required, unit: 'karma' };
}

/** Platform-wide minimums. ALL three must pass. */
export function checkBase(
  v: VerifiedValues | null,
  t: Thresholds,
  now: Date = new Date(),
): { checks: Check[]; allPassed: boolean; determinable: boolean } {
  const checks = [
    ageCheck(t.minAccountAgeMonths, v, now),
    karmaCheck('comment', 'Comment karma', t.minCommentKarma, v ? v.commentKarma : null),
    karmaCheck('post', 'Post karma', t.minPostKarma, v ? v.postKarma : null),
  ];
  return {
    checks,
    allPassed: checks.every((c) => c.passed === true),
    determinable: checks.every((c) => c.passed !== null),
  };
}

export function describeUnmet(c: Check): string {
  const unit = c.unit === 'months' ? (c.required === 1 ? 'month' : 'months') : 'karma';
  if (c.actual === null) return `${c.label}: at least ${c.required} ${unit} required (not verified yet)`;
  if (c.unit === 'months') return `${c.label}: at least ${c.required} ${unit} required — yours is ${c.actual}`;
  return `${c.label}: at least ${c.required} required — yours is ${c.actual}`;
}

export interface EligibilityContext {
  /** Application is Approved (and therefore carries verified values). */
  approved: boolean;
  /** Account-level block or Suspended application status. */
  restricted: boolean;
  values: VerifiedValues | null;
  base: Thresholds;
  now?: Date;
}

/**
 * Effective requirement for each dimension is the HIGHER of the platform minimum and the
 * subreddit's own minimum, so a subreddit can never be looser than the platform baseline.
 */
export function evaluateSubreddit(rules: SubredditRules, ctx: EligibilityContext): SubredditEligibility {
  const now = ctx.now ?? new Date();
  const eff: Thresholds = {
    minAccountAgeMonths: Math.max(ctx.base.minAccountAgeMonths, rules.minAccountAgeMonths),
    minCommentKarma: Math.max(ctx.base.minCommentKarma, rules.minCommentKarma),
    minPostKarma: Math.max(ctx.base.minPostKarma, rules.minPostKarma),
  };
  const { checks } = checkBase(ctx.values, eff, now);

  if (ctx.restricted) {
    return { state: 'unavailable', checks, unmet: [], notes: [], blockedReason: 'Your task access is currently suspended.' };
  }
  if (!ctx.approved || !ctx.values) {
    return { state: 'unavailable', checks, unmet: [], notes: [], blockedReason: 'Your Reddit account must be approved first.' };
  }

  const unmet = checks.filter((c) => c.passed !== true).map(describeUnmet);
  if (unmet.length) return { state: 'unavailable', checks, unmet, notes: [] };

  const notes: string[] = [];
  if (rules.requiresManualReview) notes.push('Applications for this subreddit are reviewed manually by the administrator.');
  if (rules.extraRequirements.trim()) notes.push('Additional requirements are checked by the administrator.');
  return { state: notes.length ? 'eligible_review' : 'eligible', checks, unmet: [], notes };
}

export function isEligible(e: SubredditEligibility): boolean {
  return e.state === 'eligible' || e.state === 'eligible_review';
}
