import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PublicShell } from '@/components/shells';
import { ActionForm, Field, PasswordField, SubmitButton } from '@/components/forms';
import { Banner, one } from '@/components/ui';
import { loginAction } from '@/app/actions/auth';
import { getCurrentUser } from '@/server/session';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getCurrentUser()) redirect('/dashboard');
  const sp = await searchParams;
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl">Log in</h1>
        <div className="mt-5 space-y-3">
          {one(sp.reset) && <Banner tone="ok">Your password was updated. Log in with the new one.</Banner>}
          {one(sp.verified) && <Banner tone="ok">Email verified. Log in to continue.</Banner>}
        </div>
        <div className="card mt-5">
          <ActionForm action={loginAction}>
            <input type="hidden" name="next" value={one(sp.next)} />
            <Field name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
            <PasswordField name="password" label="Password" />
            <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Logging in…">Log in</SubmitButton>
          </ActionForm>
          <p className="mt-4 text-center text-sm"><Link href="/forgot-password">Forgot your password?</Link></p>
        </div>
        <p className="mt-5 text-center text-muted">New here? <Link href="/signup" className="font-semibold">Create an account</Link></p>
      </div>
    </PublicShell>
  );
}
