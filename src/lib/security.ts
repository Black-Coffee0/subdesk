import 'server-only';
import crypto from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer, opts = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, opts.keylen, { N: opts.N, r: opts.r, p: opts.p, maxmem: opts.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** scrypt$N$r$p$salt$hash (base64url). Parameters are stored so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // burn comparable time so "no such user" is not distinguishable by timing
    await scrypt(password, Buffer.alloc(16));
    return false;
  }
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
    maxmem: SCRYPT.maxmem,
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Opaque random token for sessions / emailed links (256 bits). */
export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Only the hash of a token is stored in the database. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Short public code a user can paste into their Reddit bio to show they control the account. */
export function newOwnershipCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `subdesk-${out}`;
}

export function randomUuid(): string {
  return crypto.randomUUID();
}
