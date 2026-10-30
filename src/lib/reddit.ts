import 'server-only';
import { REDDIT_USERNAME_RE } from './reddit-url';

/**
 * Reddit account lookup via Reddit's official OAuth API (application-only token).
 *
 * This module NEVER fabricates data. Every outcome is one of:
 *   ok           – we retrieved the account and its numbers from Reddit
 *   not_found    – Reddit says no such account (nonexistent / deleted)
 *   suspended    – Reddit reports the account as suspended
 *   forbidden    – Reddit refused access to the profile (private / restricted)
 *   unavailable  – we could not complete a lookup (not configured, rate limited, network, bad response)
 * Anything other than `ok` leads to a manual-review workflow upstream.
 *
 * Requires a Reddit app (https://www.reddit.com/prefs/apps) and compliance with
 * Reddit's Data API terms. See README → "Reddit API setup".
 */

export type RedditLookup =
  | {
      kind: 'ok';
      username: string;
      createdAt: Date;
      commentKarma: number;
      postKarma: number;
      bio: string;
      evidence: Record<string, unknown>;
    }
  | { kind: 'not_found' }
  | { kind: 'suspended' }
  | { kind: 'forbidden' }
  | {
      kind: 'unavailable';
      reason: 'not_configured' | 'auth_failed' | 'rate_limited' | 'network' | 'bad_response';
      detail?: string;
    };

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const TIMEOUT_MS = 8000;

let cachedToken: { value: string; expiresAt: number } | null = null;
let rateLimitedUntil = 0;

export function isRedditConfigured(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID?.trim() && process.env.REDDIT_CLIENT_SECRET?.trim());
}

function userAgent(): string {
  return (
    process.env.REDDIT_USER_AGENT?.trim() ||
    'web:subdesk-eligibility-check:v1.0 (set REDDIT_USER_AGENT to include your reddit username)'
  );
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

async function getToken(): Promise<{ token: string } | { error: RedditLookup }> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return { token: cachedToken.value };
  const id = process.env.REDDIT_CLIENT_ID!.trim();
  const secret = process.env.REDDIT_CLIENT_SECRET!.trim();
  let res: Response;
  try {
    res = await fetchWithTimeout(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent(),
      },
      body: 'grant_type=client_credentials',
    });
  } catch (e) {
    return { error: { kind: 'unavailable', reason: 'network', detail: (e as Error).name } };
  }
  if (res.status === 429) return { error: { kind: 'unavailable', reason: 'rate_limited' } };
  if (!res.ok) return { error: { kind: 'unavailable', reason: 'auth_failed', detail: `token endpoint returned ${res.status}` } };
  try {
    const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!j.access_token) return { error: { kind: 'unavailable', reason: 'auth_failed', detail: j.error ?? 'no access_token' } };
    cachedToken = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return { token: j.access_token };
  } catch {
    return { error: { kind: 'unavailable', reason: 'bad_response', detail: 'token response was not JSON' } };
  }
}

export function clearRedditTokenCache(): void {
  cachedToken = null;
  rateLimitedUntil = 0;
}

/** Look up a Reddit user's public profile numbers. Never throws. */
export async function lookupRedditUser(username: string): Promise<RedditLookup> {
  if (!REDDIT_USERNAME_RE.test(username)) return { kind: 'not_found' };
  if (!isRedditConfigured()) return { kind: 'unavailable', reason: 'not_configured' };
  if (Date.now() < rateLimitedUntil) return { kind: 'unavailable', reason: 'rate_limited', detail: 'backing off' };

  const tok = await getToken();
  if ('error' in tok) return tok.error;

  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}/user/${encodeURIComponent(username)}/about?raw_json=1`, {
      headers: { Authorization: `Bearer ${tok.token}`, 'User-Agent': userAgent(), Accept: 'application/json' },
    });
  } catch (e) {
    return { kind: 'unavailable', reason: 'network', detail: (e as Error).name };
  }

  // Respect Reddit's rate-limit signals instead of hammering the API.
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(remaining) && remaining < 2 && Number.isFinite(reset) && reset > 0) {
    rateLimitedUntil = Date.now() + Math.min(reset, 120) * 1000;
  }

  if (res.status === 401) {
    cachedToken = null;
    return { kind: 'unavailable', reason: 'auth_failed', detail: 'token rejected' };
  }
  if (res.status === 429) {
    rateLimitedUntil = Date.now() + 60_000;
    return { kind: 'unavailable', reason: 'rate_limited' };
  }
  if (res.status === 404) return { kind: 'not_found' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'unavailable', reason: 'bad_response', detail: `HTTP ${res.status}` };

  let body: any;
  try {
    body = await res.json();
  } catch {
    return { kind: 'unavailable', reason: 'bad_response', detail: 'not JSON' };
  }
  const d = body?.data;
  if (body?.kind !== 't2' || !d || typeof d !== 'object') {
    return { kind: 'unavailable', reason: 'bad_response', detail: 'unexpected shape' };
  }
  if (d.is_suspended === true) return { kind: 'suspended' };

  const created = Number(d.created_utc);
  const comment = Number(d.comment_karma);
  const post = Number(d.link_karma); // Reddit calls post karma "link_karma"
  if (
    typeof d.name !== 'string' ||
    d.name.toLowerCase() !== username.toLowerCase() ||
    !Number.isFinite(created) ||
    created <= 0 ||
    !Number.isInteger(comment) ||
    !Number.isInteger(post)
  ) {
    // Incomplete data must not be treated as verified.
    return { kind: 'unavailable', reason: 'bad_response', detail: 'missing or malformed fields' };
  }

  return {
    kind: 'ok',
    username: d.name,
    createdAt: new Date(created * 1000),
    commentKarma: Math.max(0, comment),
    postKarma: Math.max(0, post),
    bio: String(d.subreddit?.public_description ?? '').slice(0, 1000),
    evidence: {
      source: 'reddit_oauth_api',
      endpoint: '/user/{username}/about',
      fetched_at: new Date().toISOString(),
      fields: {
        name: d.name,
        created_utc: created,
        link_karma: post,
        comment_karma: comment,
        total_karma: typeof d.total_karma === 'number' ? d.total_karma : null,
        is_suspended: Boolean(d.is_suspended),
      },
    },
  };
}
