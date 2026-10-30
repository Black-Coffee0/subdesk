import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { accountAgeMonths, addMonthsUTC, checkBase, evaluateSubreddit, type EligibilityContext, type VerifiedValues } from '@/lib/eligibility';
import { parseRedditProfileUrl } from '@/lib/reddit-url';
import { formatINR, parseRupeesToPaise } from '@/lib/money';
import { hashPassword, verifyPassword, hashToken } from '@/lib/security';
import { clearRedditTokenCache, lookupRedditUser } from '@/lib/reddit';
import { interpretLookup } from '@/services/submissions';

const d = (s: string) => new Date(s);
const base = { minAccountAgeMonths: 3, minCommentKarma: 100, minPostKarma: 100 };
const vals = (over: Partial<VerifiedValues> = {}): VerifiedValues => ({
  accountCreatedAt: d('2025-01-01T00:00:00Z'), commentKarma: 500, postKarma: 300, source: 'reddit_api', verifiedAt: d('2026-10-01T00:00:00Z'), ...over,
});

describe('account age maths', () => {
  it('counts whole calendar months', () => {
    expect(accountAgeMonths(d('2026-07-23T12:00:00Z'), d('2026-10-23T12:00:00Z'))).toBe(3);
    expect(accountAgeMonths(d('2026-07-23T12:00:01Z'), d('2026-10-23T12:00:00Z'))).toBe(2); // one second short
    expect(accountAgeMonths(d('2026-10-24T00:00:00Z'), d('2026-10-23T12:00:00Z'))).toBe(0); // created "in the future"
  });
  it('clamps month ends', () => {
    expect(addMonthsUTC(d('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsUTC(d('2026-11-30T00:00:00Z'), 3).toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });
});

describe('base requirements: all three are mandatory', () => {
  const now = d('2026-10-23T00:00:00Z');
  it('passes when all three pass', () => {
    expect(checkBase(vals({ accountCreatedAt: d('2026-07-01T00:00:00Z'), commentKarma: 100, postKarma: 100 }), base, now).allPassed).toBe(true);
  });
  it('fails on age alone', () => expect(checkBase(vals({ accountCreatedAt: d('2026-08-01T00:00:00Z') }), base, now).allPassed).toBe(false));
  it('fails on comment karma alone', () => expect(checkBase(vals({ commentKarma: 99 }), base, now).allPassed).toBe(false));
  it('fails on post karma alone', () => expect(checkBase(vals({ postKarma: 99 }), base, now).allPassed).toBe(false));
  it('cannot be determined without verified values', () => {
    const r = checkBase(null, base, now);
    expect(r.allPassed).toBe(false);
    expect(r.determinable).toBe(false);
    expect(r.checks.every((c) => c.passed === null)).toBe(true);
  });
});

describe('subreddit rules', () => {
  const now = d('2026-10-23T00:00:00Z');
  const ctx = (over: Partial<EligibilityContext> = {}): EligibilityContext => ({ approved: true, restricted: false, values: vals(), base, now, ...over });
  const rules = { minAccountAgeMonths: 0, minCommentKarma: 0, minPostKarma: 0, requiresManualReview: false, extraRequirements: '' };

  it('never lets a subreddit be looser than the platform baseline', () => {
    const e = evaluateSubreddit(rules, ctx({ values: vals({ commentKarma: 50 }) }));
    expect(e.state).toBe('unavailable');
    expect(e.unmet.join()).toMatch(/Comment karma/);
  });
  it('uses the stricter subreddit requirement and says what is unmet', () => {
    const e = evaluateSubreddit({ ...rules, minPostKarma: 1000 }, ctx());
    expect(e.state).toBe('unavailable');
    expect(e.unmet[0]).toMatch(/Post karma: at least 1000 required — yours is 300/);
  });
  it('flags manual review separately from the numbers', () => {
    expect(evaluateSubreddit({ ...rules, requiresManualReview: true }, ctx()).state).toBe('eligible_review');
    expect(evaluateSubreddit({ ...rules, extraRequirements: 'Must read the sidebar' }, ctx()).state).toBe('eligible_review');
    expect(evaluateSubreddit(rules, ctx()).state).toBe('eligible');
  });
  it('blocks unapproved and restricted users', () => {
    expect(evaluateSubreddit(rules, ctx({ approved: false })).state).toBe('unavailable');
    expect(evaluateSubreddit(rules, ctx({ restricted: true })).blockedReason).toMatch(/suspended/);
  });
});

describe('Reddit URL normaliser', () => {
  it.each([
    ['https://www.reddit.com/user/Some_User/', 'Some_User'],
    ['https://reddit.com/u/Some_User', 'Some_User'],
    ['http://old.reddit.com/user/abc-def/submitted/?sort=new#x', 'abc-def'],
    ['reddit.com/user/AbcDef', 'AbcDef'],
    ['u/AbcDef', 'AbcDef'],
    ['/user/AbcDef/', 'AbcDef'],
    ['  https://np.reddit.com/user/AbcDef/comments  ', 'AbcDef'],
  ])('accepts %s', (input, name) => {
    const r = parseRedditProfileUrl(input);
    expect(r.ok && r.username).toBe(name);
    expect(r.ok && r.canonicalUrl).toBe(`https://www.reddit.com/user/${name}/`);
  });
  it.each([
    '', '   ', 'hello', 'https://example.com/user/abc', 'https://reddit.com.evil.com/user/abc', 'https://evilreddit.com/user/abc',
    'https://www.reddit.com/r/programming/', 'https://www.reddit.com/user/', 'https://www.reddit.com/user/ab', 'https://www.reddit.com/user/this_username_is_way_too_long',
    'https://www.reddit.com/user/bad name', 'https://user:pw@www.reddit.com/user/abc', 'https://www.reddit.com:8443/user/abc', 'javascript:alert(1)',
    'ftp://www.reddit.com/user/abc', 'https://www.reddit.com/user/<script>', 'https://www.reddit.com/user/ab%00cd', 'x'.repeat(400),
  ])('rejects %j', (input) => {
    expect(parseRedditProfileUrl(input).ok).toBe(false);
  });
});

describe('money and passwords', () => {
  it('parses rupees to paise without floats', () => {
    expect(parseRupeesToPaise('250')).toBe(25000);
    expect(parseRupeesToPaise('99.5')).toBe(9950);
    expect(parseRupeesToPaise('1,250.05')).toBe(125005);
    expect(parseRupeesToPaise('0.1')).toBe(10);
    for (const bad of ['', 'abc', '-5', '1.234', '1e3', '999999999999']) expect(parseRupeesToPaise(bad)).toBeNull();
    expect(formatINR(0)).toBe('₹0.00');
    expect(formatINR(125005)).toBe('₹1,250.05');
  });
  it('hashes with scrypt and verifies', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('correct');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
    expect(hashToken('abc')).toHaveLength(64);
  });
});

describe('Reddit API client (fetch stubbed — no network)', () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const token = () => json({ access_token: 'tok', expires_in: 3600 });
  const about = (data: Record<string, unknown>) => json({ kind: 't2', data: { name: 'Alice_1', created_utc: 1700000000, link_karma: 120, comment_karma: 340, total_karma: 500, is_suspended: false, subreddit: { public_description: 'hi subdesk-abc' }, ...data } });

  beforeEach(() => {
    clearRedditTokenCache();
    process.env.REDDIT_CLIENT_ID = 'id';
    process.env.REDDIT_CLIENT_SECRET = 'secret';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
  });
  const stub = (...responses: Response[]) => {
    const f = vi.fn();
    responses.forEach((r) => f.mockResolvedValueOnce(r));
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('is unavailable (never "verified") when credentials are missing', async () => {
    delete process.env.REDDIT_CLIENT_ID;
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await lookupRedditUser('Alice_1')).toEqual({ kind: 'unavailable', reason: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
  it('maps a good response; post karma is link_karma', async () => {
    const f = stub(token(), about({}));
    const r = await lookupRedditUser('Alice_1');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.postKarma).toBe(120);
      expect(r.commentKarma).toBe(340);
      expect(r.createdAt.toISOString()).toBe('2023-11-14T22:13:20.000Z');
      expect(r.bio).toContain('subdesk-abc');
      expect(r.evidence).toMatchObject({ source: 'reddit_oauth_api' });
    }
    expect(String(f.mock.calls[1][0])).toBe('https://oauth.reddit.com/user/Alice_1/about?raw_json=1');
    expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });
  it.each([
    [404, 'not_found'],
    [403, 'forbidden'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    stub(token(), json({}, status));
    expect((await lookupRedditUser('Alice_1')).kind).toBe(kind);
  });
  it('maps suspended accounts', async () => {
    stub(token(), about({ is_suspended: true }));
    expect((await lookupRedditUser('Alice_1')).kind).toBe('suspended');
  });
  it('treats 429, 5xx, network errors and bad tokens as unavailable', async () => {
    stub(token(), json({}, 429));
    expect(await lookupRedditUser('Alice_1')).toMatchObject({ kind: 'unavailable', reason: 'rate_limited' });
    clearRedditTokenCache();
    stub(token(), json({}, 503));
    expect(await lookupRedditUser('Alice_1')).toMatchObject({ kind: 'unavailable', reason: 'bad_response' });
    clearRedditTokenCache();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await lookupRedditUser('Alice_1')).toMatchObject({ kind: 'unavailable', reason: 'network' });
    clearRedditTokenCache();
    stub(json({ error: 'invalid_grant' }, 401));
    expect(await lookupRedditUser('Alice_1')).toMatchObject({ kind: 'unavailable', reason: 'auth_failed' });
  });
  it('refuses incomplete or mismatched data instead of guessing', async () => {
    stub(token(), about({ created_utc: undefined }));
    expect(await lookupRedditUser('Alice_1')).toMatchObject({ kind: 'unavailable', reason: 'bad_response' });
    clearRedditTokenCache();
    stub(token(), about({ link_karma: 'lots' }));
    expect(await lookupRedditUser('Alice_1')).toMatchObject({ kind: 'unavailable', reason: 'bad_response' });
    clearRedditTokenCache();
    stub(token(), about({ name: 'SomeoneElse' }));
    expect(await lookupRedditUser('Alice_1')).toMatchObject({ kind: 'unavailable', reason: 'bad_response' });
  });
  it('never calls out for an invalid username', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await lookupRedditUser('../etc/passwd')).kind).toBe('not_found');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('verification outcomes are transparent', () => {
  const o = { ownershipCode: 'subdesk-abc', requireOwnership: true, base, now: d('2026-10-23T00:00:00Z') };
  it('verified + ownership confirmed when the code is in the bio', () => {
    const r = interpretLookup({ kind: 'ok', username: 'a', createdAt: d('2025-01-01T00:00:00Z'), commentKarma: 200, postKarma: 200, bio: 'x SUBDESK-ABC y', evidence: {} }, o);
    expect(r).toMatchObject({ state: 'verified', ownership: 'confirmed', meetsMinimums: true });
  });
  it('reports every unmet minimum', () => {
    const r = interpretLookup({ kind: 'ok', username: 'a', createdAt: d('2026-09-01T00:00:00Z'), commentKarma: 5, postKarma: 5, bio: '', evidence: {} }, o);
    expect(r.meetsMinimums).toBe(false);
    expect(r.unmet).toHaveLength(3);
    expect(r.ownership).toBe('not_confirmed');
  });
  it.each([
    [{ kind: 'not_found' }, 'unverified'],
    [{ kind: 'suspended' }, 'unverified'],
    [{ kind: 'forbidden' }, 'manual_review_required'],
    [{ kind: 'unavailable', reason: 'not_configured' }, 'manual_review_required'],
    [{ kind: 'unavailable', reason: 'network' }, 'manual_review_required'],
  ] as const)('%j → %s with no values', (lookup, state) => {
    const r = interpretLookup(lookup as any, o);
    expect(r.state).toBe(state);
    expect(r.values).toBeNull();
  });
});
