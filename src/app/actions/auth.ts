'use server';

import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { createSession, destroySession, login, requestPasswordReset, resendVerification, resetPassword, signUp, verifyEmail } from '@/services/auth';
import { safe, str, type ActionState } from '@/server/action';
import { endSession, getCurrentUser, requestMeta, setSessionCookie } from '@/server/session';

/** Only same-site relative paths are accepted as a post-login destination (no open redirects). */
function safeNext(v: string): string | null {
  return /^\/(?![/\\])[A-Za-z0-9/_\-?=&%.]*$/.test(v) && !v.startsWith('/admin') ? v : null;
}

export async function signUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const meta = await requestMeta();
    const out = await signUp(
      { email: str(fd, 'email'), username: str(fd, 'username'), password: str(fd, 'password'), confirmPassword: str(fd, 'confirmPassword'), acceptTerms: fd.get('acceptTerms') === 'on' },
      meta,
    );
    const s = await createSession(out.userId, 'user', meta);
    await setSessionCookie('user', s.token, s.expiresAt);
    return { data: out.devLink ? { devLink: out.devLink } : undefined, message: out.emailSent ? 'Account created. Check your inbox to verify your email.' : undefined };
  }, fd);
  // With email configured, go straight to the dashboard. In local development there is no email,
  // so the form stays put and shows the verification link instead.
  if (r.ok && !r.data?.devLink) redirect('/dashboard?welcome=1');
  if (r.ok) return { ...r, message: 'Account created. Email is not configured on this server, so use the link below to verify.' };
  return r;
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const s = await login({ email: str(fd, 'email'), password: str(fd, 'password') }, {}, await requestMeta());
    if (s.user.role === 'admin') {
      await destroySession(s.token);
      throw new AppError('invalid_login', 'Administrators sign in from the administrator login page.');
    }
    await setSessionCookie('user', s.token, s.expiresAt);
  }, fd);
  if (r.ok) redirect(safeNext(str(fd, 'next')) ?? '/dashboard');
  return r;
}

export async function adminLoginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const s = await login({ email: str(fd, 'email'), password: str(fd, 'password') }, { adminOnly: true }, await requestMeta());
    await setSessionCookie('admin', s.token, s.expiresAt);
  }, fd);
  if (r.ok) redirect('/admin');
  return r;
}

export async function logoutAction(): Promise<void> {
  await endSession('user');
  redirect('/');
}

export async function adminLogoutAction(): Promise<void> {
  await endSession('admin');
  redirect('/admin/login');
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return safe(async () => {
    const r = await requestPasswordReset(str(fd, 'email'), await requestMeta());
    return {
      message: 'If an account exists for that email, we have sent a reset link. It is valid for one hour.',
      data: r.devLink ? { devLink: r.devLink } : undefined,
    };
  }, fd);
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => resetPassword(str(fd, 'token'), str(fd, 'password'), str(fd, 'confirm'), await requestMeta()), fd);
  if (r.ok) redirect('/login?reset=1');
  return r;
}

export async function verifyEmailAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const ok = await verifyEmail(str(fd, 'token'));
    if (!ok) throw new AppError('invalid_token', 'This verification link is invalid or has expired. Request a new one from your dashboard.');
  });
  if (r.ok) redirect((await getCurrentUser()) ? '/dashboard?verified=1' : '/login?verified=1');
  return r;
}

export async function resendVerificationAction(_: ActionState): Promise<ActionState> {
  return safe(async () => {
    const u = await getCurrentUser();
    if (!u) throw new AppError('unauthenticated', 'Please log in to continue.');
    const r = await resendVerification(u.id, await requestMeta());
    return {
      message: r.emailSent ? 'Verification email sent. Check your inbox.' : r.devLink ? 'Email is not configured on this server. Use the link below.' : 'Your email is already verified.',
      data: r.devLink ? { devLink: r.devLink } : undefined,
    };
  });
}
