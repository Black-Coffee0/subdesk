import type { Metadata } from 'next';
import { PublicShell } from '@/components/shells';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Banner, one } from '@/components/ui';
import { verifyEmailAction } from '@/app/actions/auth';

export const metadata: Metadata = { title: 'Verify your email', robots: { index: false } };

/** Verification happens on a button press (POST), so email scanners that pre-open links cannot use up the token. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = one((await searchParams).token);
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl">Verify your email</h1>
        {!token ? (
          <div className="mt-6"><Banner tone="bad" title="This link is incomplete">Open the link from your verification email, or request a new one from your dashboard.</Banner></div>
        ) : (
          <div className="card mt-6">
            <p className="mb-4 text-muted">Confirm that this is your email address to unlock Reddit account submission.</p>
            <ActionForm action={verifyEmailAction}>
              <input type="hidden" name="token" value={token} />
              <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Verifying…">Confirm my email</SubmitButton>
            </ActionForm>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
