import 'server-only';
import { z } from 'zod';
import { query, tx } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { isUniqueViolation } from '@/lib/pg-errors';
import { rateLimit } from '@/lib/rate-limit';
import { hashPassword, hashToken, newOwnershipCode, newToken, verifyPassword } from '@/lib/security';
import { emailField, parseInput, passwordField, usernameField } from '@/lib/validation';
import { resetLink, sendMail, verifyLink } from '@/lib/mail';
import { writeAudit } from './audit';
import { getUserRow, requireActiveUser, type UserRow } from './authz';
import { notify } from './notifications';
import { getSettings } from './settings-store';
import type { RequestMeta } from './types';

const USER_SESSION_HOURS = 24 * 30;
const ADMIN_SESSION_HOURS = 12;
const GENERIC_LOGIN_ERROR = 'Incorrect email or password.';

export interface SessionUser extends UserRow {
  sessionId: string;
}

const ip = (m?: RequestMeta) => m?.ip || 'unknown';

// ---------------------------------------------------------------- sessions

export async function createSession(userId: string, role: 'user' | 'admin', meta?: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const hours = role === 'admin' ? ADMIN_SESSION_HOURS : USER_SESSION_HOURS;
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  await query(
    `insert into sessions (user_id, token_hash, expires_at, ip, user_agent) values ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), expiresAt, meta?.ip ?? null, (meta?.userAgent ?? '').slice(0, 300) || null],
  );
  return { token, expiresAt };
}

/** Resolve a session cookie value to the current user. Re-reads role/status from the database. */
export async function getSessionUser(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await query<SessionUser & { expires_at: Date; last_seen_at: Date }>(
    `select u.id, u.email, u.username, u.role, u.permissions, u.status, u.email_verified_at, u.verification_code,
            u.is_test_data, u.deletion_requested_at, u.created_at,
            s.id as "sessionId", s.expires_at, s.last_seen_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.deleted_at is null and u.status = 'active'`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  if (!row) return null;
  // sliding expiry, written at most every 10 minutes
  if (Date.now() - new Date(row.last_seen_at).getTime() > 10 * 60_000) {
    const hours = row.role === 'admin' ? ADMIN_SESSION_HOURS : USER_SESSION_HOURS;
    await query(`update sessions set last_seen_at = now(), expires_at = now() + make_interval(hours => $2) where id = $1`, [row.sessionId, hours]);
  }
  const { expires_at: _e, last_seen_at: _l, ...user } = row;
  return user;
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await query(`delete from sessions where token_hash = $1`, [hashToken(token)]);
}

// ----------------------------------------------------------------- sign up

const SignUpSchema = z
  .object({
    email: emailField,
    username: usernameField,
    password: passwordField,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: 'Please accept the Terms of Service and Privacy Policy.' }),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' })
  .refine((v) => !v.password.toLowerCase().includes(v.username.toLowerCase()), {
    path: ['password'],
    message: 'Your password should not contain your username.',
  });

export async function signUp(
  input: { email: string; username: string; password: string; confirmPassword: string; acceptTerms: boolean },
  meta?: RequestMeta,
): Promise<{ userId: string; devLink?: string; emailSent: boolean }> {
  await rateLimit(`signup:ip:${ip(meta)}`, 10, 3600, undefined, 'Too many sign-ups from this network. Please try again later.');
  const v = parseInput(SignUpSchema, input);
  const passwordHash = await hashPassword(v.password);

  let userId: string;
  try {
    userId = await tx(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into users (email, username, password_hash, verification_code) values ($1, $2, $3, $4) returning id`,
        [v.email, v.username, passwordHash, newOwnershipCode()],
      );
      const id = r.rows[0].id;
      await db.query(`insert into wallets (user_id) values ($1)`, [id]);
      await notify(db, id, 'welcome', 'Welcome!', 'Verify your email, then submit your Reddit profile for review.', '/application/submit');
      return id;
    });
  } catch (e) {
    if (isUniqueViolation(e, 'users_email_lower_uq')) throw new AppError('validation', 'Please check the highlighted fields.', { email: 'An account with this email already exists.' });
    if (isUniqueViolation(e, 'users_username_lower_uq')) throw new AppError('validation', 'Please check the highlighted fields.', { username: 'That username is taken.' });
    throw e;
  }

  const mail = await issueVerificationEmail(userId, v.email);
  return { userId, devLink: mail.devLink, emailSent: mail.delivered };
}

async function issueVerificationEmail(userId: string, email: string) {
  const token = newToken();
  await tx(async (db) => {
    await db.query(`delete from auth_tokens where user_id = $1 and kind = 'verify_email'`, [userId]);
    await db.query(
      `insert into auth_tokens (user_id, kind, token_hash, expires_at) values ($1, 'verify_email', $2, now() + interval '2 days')`,
      [userId, hashToken(token)],
    );
  });
  const settings = await getSettings();
  const link = verifyLink(token);
  return sendMail({
    to: email,
    subject: `Verify your email for ${settings.siteName}`,
    text: `Welcome to ${settings.siteName}!\n\nConfirm your email address by opening this link (valid for 2 days):\n${link}\n\nIf you did not create an account, you can ignore this message.`,
    link,
  });
}

export async function resendVerification(userId: string, meta?: RequestMeta): Promise<{ devLink?: string; emailSent: boolean }> {
  await rateLimit(`verify-resend:user:${userId}`, 3, 3600, undefined, 'Please wait a while before requesting another verification email.');
  const u = await requireActiveUser({ query }, userId);
  if (u.email_verified_at) return { emailSent: false };
  const mail = await issueVerificationEmail(u.id, u.email);
  return { devLink: mail.devLink, emailSent: mail.delivered };
}

export async function verifyEmail(token: string): Promise<boolean> {
  if (!token || token.length > 200) return false;
  return tx(async (db) => {
    const r = await db.query<{ id: string; user_id: string }>(
      `select id, user_id from auth_tokens
        where token_hash = $1 and kind = 'verify_email' and used_at is null and expires_at > now() for update`,
      [hashToken(token)],
    );
    const t = r.rows[0];
    if (!t) return false;
    await db.query(`update auth_tokens set used_at = now() where id = $1`, [t.id]);
    await db.query(`update users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = $1`, [t.user_id]);
    await notify(db, t.user_id, 'email_verified', 'Email verified', 'You can now submit your Reddit account.', '/application/submit');
    return true;
  });
}

// ------------------------------------------------------------------- login

export async function login(
  input: { email: string; password: string },
  opts: { adminOnly?: boolean } = {},
  meta?: RequestMeta,
): Promise<{ token: string; expiresAt: Date; user: { id: string; role: 'user' | 'admin' } }> {
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 254);
  const password = String(input.password ?? '').slice(0, 256);
  await rateLimit(`login:ip:${ip(meta)}`, 30, 600);
  await rateLimit(`login:email:${email}`, 8, 600, undefined, 'Too many login attempts for this account. Please wait 10 minutes and try again.');
  if (!email || !password) throw new AppError('invalid_login', GENERIC_LOGIN_ERROR);

  const r = await query<{ id: string; password_hash: string | null; role: 'user' | 'admin'; status: string }>(
    `select id, password_hash, role, status from users where lower(email) = $1 and deleted_at is null`,
    [email],
  );
  const u = r.rows[0];
  const ok = await verifyPassword(password, u?.password_hash);
  if (!u || !ok) throw new AppError('invalid_login', GENERIC_LOGIN_ERROR);
  // The admin login never reveals whether an ordinary account exists.
  if (opts.adminOnly && u.role !== 'admin') throw new AppError('invalid_login', GENERIC_LOGIN_ERROR);
  if (u.status !== 'active') throw new AppError('suspended', 'This account has been suspended. Please contact support.');

  const s = await createSession(u.id, u.role, meta);
  if (u.role === 'admin') {
    await writeAudit({ query }, { actorId: u.id, action: 'auth.admin_login', targetType: 'user', targetId: u.id }, meta);
  }
  return { ...s, user: { id: u.id, role: u.role } };
}

// ---------------------------------------------------------- password reset

export async function requestPasswordReset(emailInput: string, meta?: RequestMeta): Promise<{ devLink?: string }> {
  const email = String(emailInput ?? '').trim().toLowerCase().slice(0, 254);
  await rateLimit(`reset:ip:${ip(meta)}`, 10, 3600);
  await rateLimit(`reset:email:${email}`, 3, 3600, undefined, 'Too many reset requests for this email. Please try again later.');
  const parsed = emailField.safeParse(email);
  if (!parsed.success) throw new AppError('validation', 'Please check the highlighted fields.', { email: 'Enter a valid email address.' });

  // Always behave the same whether or not the account exists (no account enumeration).
  const u = (await query<{ id: string }>(`select id from users where lower(email) = $1 and deleted_at is null and status = 'active'`, [email])).rows[0];
  if (!u) return {};
  const token = newToken();
  await tx(async (db) => {
    await db.query(`delete from auth_tokens where user_id = $1 and kind = 'reset_password'`, [u.id]);
    await db.query(
      `insert into auth_tokens (user_id, kind, token_hash, expires_at) values ($1, 'reset_password', $2, now() + interval '1 hour')`,
      [u.id, hashToken(token)],
    );
  });
  const settings = await getSettings();
  const link = resetLink(token);
  const mail = await sendMail({
    to: email,
    subject: `Reset your ${settings.siteName} password`,
    text: `Someone asked to reset the password for this account.\n\nSet a new password here (valid for 1 hour):\n${link}\n\nIf this wasn't you, you can ignore this message — your password will not change.`,
    link,
  });
  return { devLink: mail.devLink };
}

export async function isResetTokenValid(token: string): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const r = await query(`select 1 from auth_tokens where token_hash = $1 and kind = 'reset_password' and used_at is null and expires_at > now()`, [hashToken(token)]);
  return r.rowCount > 0;
}

export async function resetPassword(token: string, newPassword: string, confirm: string, meta?: RequestMeta): Promise<void> {
  await rateLimit(`reset-submit:ip:${ip(meta)}`, 20, 3600);
  const v = parseInput(
    z.object({ password: passwordField, confirm: z.string() }).refine((x) => x.password === x.confirm, { path: ['confirm'], message: 'Passwords do not match.' }),
    { password: newPassword, confirm },
  );
  const hash = await hashPassword(v.password);
  const done = await tx(async (db) => {
    const r = await db.query<{ id: string; user_id: string }>(
      `select id, user_id from auth_tokens
        where token_hash = $1 and kind = 'reset_password' and used_at is null and expires_at > now() for update`,
      [hashToken(token ?? '')],
    );
    const t = r.rows[0];
    if (!t) return false;
    await db.query(`update auth_tokens set used_at = now() where id = $1`, [t.id]);
    await db.query(`update users set password_hash = $2, updated_at = now() where id = $1`, [t.user_id, hash]);
    await db.query(`delete from sessions where user_id = $1`, [t.user_id]); // sign out everywhere
    await writeAudit(db, { actorId: t.user_id, action: 'auth.password_reset', targetType: 'user', targetId: t.user_id }, meta);
    return true;
  });
  if (!done) throw new AppError('invalid_token', 'This reset link is invalid or has expired. Please request a new one.');
}

// ------------------------------------------------------- account settings

export async function changePassword(
  userId: string,
  input: { current: string; password: string; confirm: string },
  keepSessionId?: string,
  meta?: RequestMeta,
): Promise<void> {
  await rateLimit(`pwchange:user:${userId}`, 8, 3600);
  const v = parseInput(
    z.object({ current: z.string().min(1, 'Enter your current password.'), password: passwordField, confirm: z.string() })
      .refine((x) => x.password === x.confirm, { path: ['confirm'], message: 'Passwords do not match.' }),
    input,
  );
  const row = (await query<{ password_hash: string | null }>(`select password_hash from users where id = $1 and deleted_at is null`, [userId])).rows[0];
  if (!row || !(await verifyPassword(v.current, row.password_hash))) {
    throw new AppError('validation', 'Please check the highlighted fields.', { current: 'That is not your current password.' });
  }
  const hash = await hashPassword(v.password);
  await tx(async (db) => {
    await db.query(`update users set password_hash = $2, updated_at = now() where id = $1`, [userId, hash]);
    await db.query(`delete from sessions where user_id = $1 and ($2::uuid is null or id <> $2::uuid)`, [userId, keepSessionId ?? null]);
    await writeAudit(db, { actorId: userId, action: 'auth.password_change', targetType: 'user', targetId: userId }, meta);
  });
}

export async function updateUsername(userId: string, usernameInput: string): Promise<void> {
  const username = parseInput(usernameField, usernameInput);
  try {
    await tx(async (db) => {
      await requireActiveUser(db, userId);
      await db.query(`update users set username = $2, updated_at = now() where id = $1`, [userId, username]);
    });
  } catch (e) {
    if (isUniqueViolation(e, 'users_username_lower_uq')) throw new AppError('validation', 'Please check the highlighted fields.', { username: 'That username is taken.' });
    throw e;
  }
}

/** Users can ask for deletion; an administrator completes it (some records may be retained). */
export async function requestAccountDeletion(userId: string, password: string, meta?: RequestMeta): Promise<void> {
  await rateLimit(`delete-request:user:${userId}`, 5, 3600);
  const row = (await query<{ password_hash: string | null; role: string }>(`select password_hash, role from users where id = $1 and deleted_at is null`, [userId])).rows[0];
  if (!row) throw new AppError('not_found', 'Account not found.');
  if (row.role === 'admin') throw new AppError('forbidden', 'Administrator accounts cannot be deleted from here.');
  if (!(await verifyPassword(String(password ?? ''), row.password_hash))) {
    throw new AppError('validation', 'Please check the highlighted fields.', { password: 'That password is not correct.' });
  }
  await tx(async (db) => {
    await db.query(`update users set deletion_requested_at = coalesce(deletion_requested_at, now()), updated_at = now() where id = $1`, [userId]);
    await writeAudit(db, { actorId: userId, action: 'account.deletion_requested', targetType: 'user', targetId: userId }, meta);
    await notify(db, userId, 'account', 'Deletion requested', 'We received your request. An administrator will complete it; some records may be kept where required.', '/settings');
  });
}

export async function cancelAccountDeletion(userId: string, meta?: RequestMeta): Promise<void> {
  await tx(async (db) => {
    await db.query(`update users set deletion_requested_at = null, updated_at = now() where id = $1 and deleted_at is null`, [userId]);
    await writeAudit(db, { actorId: userId, action: 'account.deletion_cancelled', targetType: 'user', targetId: userId }, meta);
  });
}

export async function getUserById(userId: string): Promise<UserRow | null> {
  return getUserRow({ query }, userId);
}
