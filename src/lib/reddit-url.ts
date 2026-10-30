/**
 * Reddit profile URL normalisation. Pure (no I/O) so it is easy to test.
 * Accepts reddit.com profile links in common shapes and returns the canonical form.
 */

const ALLOWED_HOSTS = new Set([
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'np.reddit.com',
  'm.reddit.com',
]);

export const REDDIT_USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

export type ParsedRedditUrl =
  | { ok: true; username: string; canonicalUrl: string }
  | { ok: false; error: string };

export function canonicalProfileUrl(username: string): string {
  return `https://www.reddit.com/user/${username}/`;
}

export function parseRedditProfileUrl(input: string): ParsedRedditUrl {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'Please enter your Reddit profile URL.' };
  if (raw.length > 300) return { ok: false, error: 'That link is too long to be a Reddit profile URL.' };
  if (/[\s<>"'`\\]/.test(raw)) return { ok: false, error: 'That does not look like a valid Reddit profile URL.' };

  // Allow shorthand such as "u/name" or "/user/name" without a host.
  let candidate = raw;
  if (/^\/?(u|user)\//i.test(candidate)) candidate = `https://www.reddit.com/${candidate.replace(/^\//, '')}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only reddit.com links are accepted.' };
  }
  if (url.username || url.password) return { ok: false, error: 'That does not look like a valid Reddit profile URL.' };
  if (url.port) return { ok: false, error: 'That does not look like a valid Reddit profile URL.' };
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, error: 'Only reddit.com profile links are accepted (for example https://www.reddit.com/user/yourname/).' };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const kind = segments[0]?.toLowerCase();
  if (kind !== 'user' && kind !== 'u') {
    return { ok: false, error: 'That link is not a Reddit user profile. It should look like https://www.reddit.com/user/yourname/' };
  }
  let name: string;
  try {
    name = decodeURIComponent(segments[1] ?? '');
  } catch {
    return { ok: false, error: 'That username is not valid.' };
  }
  if (!name) return { ok: false, error: 'The link does not include a username.' };
  if (!REDDIT_USERNAME_RE.test(name)) {
    return { ok: false, error: 'That Reddit username is not valid (3–20 letters, numbers, "_" or "-").' };
  }
  return { ok: true, username: name, canonicalUrl: canonicalProfileUrl(name) };
}
