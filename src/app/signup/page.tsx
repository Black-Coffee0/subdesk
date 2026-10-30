import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { PublicShell } from '@/components/shells';
import { ActionForm, CheckField, DevContinue, Field, PasswordField, SubmitButton } from '@/components/forms';
import { getSettings } from '@/services/settings';
import { signUpAction } from '@/app/actions/auth';
import { getCurrentUser } from '@/server/session';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect('/dashboard');
  const s = await getSettings();
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl">Create your account</h1>
        <p className="mt-2 text-muted">Takes a minute. You&apos;ll submit your Reddit profile after confirming your email.</p>
        <div className="card mt-6">
          <ActionForm action={signUpAction}>
            <Field name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
            <Field name="username" label="Username" autoComplete="username" required hint="3–24 letters, numbers or underscores. This is your name on this site, not your Reddit name." />
            <PasswordField name="password" label="Password" autoComplete="new-password" hint="At least 10 characters." />
            <PasswordField name="confirmPassword" label="Confirm password" autoComplete="new-password" />
            <CheckField name="acceptTerms" label={<>I agree to the <Link href="/terms" target="_blank">Terms of Service</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>.</>} />
            <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Creating account…">Create account</SubmitButton>
            <DevContinue href="/dashboard">Continue to your dashboard</DevContinue>
          </ActionForm>
        </div>
        <p className="mt-5 text-center text-muted">Already have an account? <Link href="/login" className="font-semibold">Log in</Link></p>
        <p className="mt-3 text-center text-sm text-muted">{s.siteName} will never ask for your Reddit password.</p>
      </div>
    </PublicShell>
  );
}
