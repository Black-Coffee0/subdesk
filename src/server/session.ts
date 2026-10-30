import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { destroySession, getSessionUser, type SessionUser } from '@/services/auth';
import type { Permission, RequestMeta } from '@/services/types';

/**
 * Sessions are random 256-bit tokens in an httpOnly cookie; only a hash is stored in the database.
 * Users and administrators use two different cookies, so an admin session is never reachable from
 * (or confused with) the public site, and the admin cookie is SameSite=Strict with a shorter life.
 */
const prod = process.env.NODE_ENV === 'production';
const COOKIES = {
  user: prod ? '__Host-sd_session' : 'sd_session',
  admin: prod ? '__Host-sd_admin' : 'sd_admin',
} as const;
export type SessionKind = keyof typeof COOKIES;

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return { ip: (h.get('x-real-ip') || fwd || 'unknown').slice(0, 64), userAgent: h.get('user-agent') ?? undefined };
}

export async function setSessionCookie(kind: SessionKind, token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(COOKIES[kind], token, {
    httpOnly: true,
    secure: prod,
    sameSite: kind === 'admin' ? 'strict' : 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(kind: SessionKind): Promise<void> {
  const jar = await cookies();
  await destroySession(jar.get(COOKIES[kind])?.value);
  jar.delete(COOKIES[kind]);
}

const load = (kind: SessionKind) =>
  cache(async (): Promise<SessionUser | null> => {
    const token = (await cookies()).get(COOKIES[kind])?.value;
    const u = await getSessionUser(token);
    if (!u) return null;
    // The role is re-read from the database on every request; a cookie can never promote itself.
    if (kind === 'admin' ? u.role !== 'admin' : u.role !== 'user') return null;
    return u;
  });

export const getCurrentUser = load('user');
export const getCurrentAdmin = load('admin');

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) redirect('/login');
  return u;
}

/** Page-level guard. (The services re-check permissions again — this only decides what to render.) */
export async function requireAdminPage(permission?: Permission): Promise<SessionUser> {
  const a = await getCurrentAdmin();
  if (!a) redirect('/admin/login');
  if (permission && !a.permissions.includes(permission)) redirect(`/admin?denied=${permission}`);
  return a;
}
