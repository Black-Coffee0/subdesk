import Link from 'next/link';
import type { Metadata } from 'next';
import { PublicShell } from '@/components/shells';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { forgotPasswordAction } from '@/app/actions/auth';

export const metadata: Metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl">Reset your password</h1>
        <p className="mt-2 text-muted">Enter your account email and we&apos;ll send you a link to choose a new password.</p>
        <div className="card mt-6">
          <ActionForm action={forgotPasswordAction}>
            <Field name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
            <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Sending…">Send reset link</SubmitButton>
          </ActionForm>
        </div>
        <p className="mt-5 text-center"><Link href="/login">Back to log in</Link></p>
      </div>
    </PublicShell>
  );
}
