import Link from 'next/link';
import type { Metadata } from 'next';
import { PublicShell } from '@/components/shells';
import { ActionForm, PasswordField, SubmitButton } from '@/components/forms';
import { Banner, one } from '@/components/ui';
import { isResetTokenValid } from '@/services/auth';
import { resetPasswordAction } from '@/app/actions/auth';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = one((await searchParams).token);
  const valid = token ? await isResetTokenValid(token) : false;
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl">Choose a new password</h1>
        {!valid ? (
          <div className="mt-6 space-y-4">
            <Banner tone="bad" title="This reset link is invalid or has expired">Reset links work once and last one hour.</Banner>
            <Link href="/forgot-password" className="btn btn-primary">Request a new link</Link>
          </div>
        ) : (
          <div className="card mt-6">
            <ActionForm action={resetPasswordAction}>
              <input type="hidden" name="token" value={token} />
              <PasswordField name="password" label="New password" autoComplete="new-password" hint="At least 10 characters." />
              <PasswordField name="confirm" label="Confirm new password" autoComplete="new-password" />
              <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Saving…">Save new password</SubmitButton>
            </ActionForm>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
