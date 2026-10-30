import 'server-only';
import type { Queryable } from '@/lib/db';
import { AppError, forbidden, unauthenticated } from '@/lib/errors';
import { emailVerificationRequired } from '@/lib/config';
import type { Permission } from './types';

export interface UserRow {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  permissions: string[];
  status: 'active' | 'suspended';
  email_verified_at: Date | null;
  verification_code: string;
  is_test_data: boolean;
  deletion_requested_at: Date | null;
  created_at: Date;
}

const USER_COLS =
  'id, email, username, role, permissions, status, email_verified_at, verification_code, is_test_data, deletion_requested_at, created_at';

/**
 * Privileges are ALWAYS re-read from the database. A caller-supplied "role" is never trusted,
 * so a stale session object, a forged argument or a hidden-button bypass cannot elevate access.
 */
export async function requireAdmin(db: Queryable, actorId: string | null | undefined, permission?: Permission): Promise<UserRow> {
  if (!actorId) throw unauthenticated();
  const r = await db.query<UserRow>(
    `select ${USER_COLS} from users where id = $1 and deleted_at is null`,
    [actorId],
  );
  const u = r.rows[0];
  if (!u) throw unauthenticated();
  if (u.role !== 'admin' || u.status !== 'active') throw forbidden('Administrator access is required.');
  if (permission && !u.permissions.includes(permission)) {
    throw forbidden('You do not have permission to perform this administrator action.');
  }
  return u;
}

export async function requireActiveUser(
  db: Queryable,
  userId: string | null | undefined,
  opts: { verifiedEmail?: boolean } = {},
): Promise<UserRow> {
  if (!userId) throw unauthenticated();
  const r = await db.query<UserRow>(`select ${USER_COLS} from users where id = $1 and deleted_at is null`, [userId]);
  const u = r.rows[0];
  if (!u) throw unauthenticated();
  if (u.status !== 'active') throw forbidden('This account has been suspended. Please contact support.');
  if (opts.verifiedEmail && emailVerificationRequired() && !u.email_verified_at) {
    throw new AppError('email_unverified', 'Please verify your email address first. Check your inbox or request a new link from your dashboard.');
  }
  return u;
}

export async function getUserRow(db: Queryable, userId: string): Promise<UserRow | null> {
  const r = await db.query<UserRow>(`select ${USER_COLS} from users where id = $1 and deleted_at is null`, [userId]);
  return r.rows[0] ?? null;
}
