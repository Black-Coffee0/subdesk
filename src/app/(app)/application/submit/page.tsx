import Link from 'next/link';
import type { Metadata } from 'next';
import { ActionForm, SubmitButton, TextArea } from '@/components/forms';
import { CopyButton } from '@/components/copy-button';
import { RedditUrlField } from '@/components/reddit-url-field';
import { Banner, PageTitle, monthsLabel } from '@/components/ui';
import { emailVerificationRequired } from '@/lib/config';
import { isRedditConfigured } from '@/lib/reddit';
import { getSettings } from '@/services/settings';
import { canSubmit, getCurrentSubmission } from '@/services/submissions';
import { submitRedditAction } from '@/app/actions/user';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Submit Reddit account' };

export default async function SubmitPage() {
  const user = await requireUser();
  const [s, gate, current] = await Promise.all([getSettings(), canSubmit(user.id), getCurrentSubmission(user.id)]);
  const needsVerify = emailVerificationRequired() && !user.email_verified_at;
  const auto = isRedditConfigured();
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Submit your Reddit account">
        {current ? 'Update your application. Your previous submission is kept in your history.' : 'Check the requirements, then paste your profile link.'}
      </PageTitle>

      <section className="card" aria-labelledby="req-h">
        <h2 id="req-h" className="text-xl">Requirements</h2>
        <p className="mt-1 text-sm text-muted">Your Reddit account must meet all three. Two out of three isn&apos;t enough.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ['Account age', `At least ${monthsLabel(s.minAccountAgeMonths)}`],
            ['Comment karma', `At least ${s.minCommentKarma}`],
            ['Post karma', `At least ${s.minPostKarma}`],
          ].map(([k, v]) => (
            <li key={k} className="rounded-lg bg-paper px-4 py-3"><p className="text-sm text-muted">{k}</p><p className="font-display text-lg font-semibold">{v}</p></li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">After the check, an administrator reviews every application and makes the final decision.</p>
      </section>

      {s.requireOwnershipCode && (
        <section className="card mt-5" aria-labelledby="code-h">
          <h2 id="code-h" className="text-xl">Step 1: Add your code to your Reddit bio</h2>
          <p className="mt-1 text-muted">This shows the account is yours. Paste it anywhere in the &ldquo;About&rdquo; section of your Reddit profile and save. You can remove it after you&apos;re approved.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-line-strong bg-paper px-4 py-2.5 font-mono text-lg font-semibold tracking-wide" aria-label="Your personal code">{user.verification_code}</code>
            <CopyButton text={user.verification_code} label="Copy code" />
          </div>
        </section>
      )}

      <section className="card mt-5" aria-labelledby="form-h">
        <h2 id="form-h" className="text-xl">{s.requireOwnershipCode ? 'Step 2: Submit your profile link' : 'Your profile link'}</h2>
        {!auto && (
          <div className="mt-3"><Banner tone="info" title="Manual verification">Automatic Reddit checks are not set up on this platform, so an administrator will verify your account by hand. Your application will show as &ldquo;Manual Review Required&rdquo;.</Banner></div>
        )}
        {needsVerify ? (
          <div className="mt-4"><Banner tone="warn" title="Verify your email first">Open the link we emailed you, or request a new one from your <Link href="/dashboard">dashboard</Link>.</Banner></div>
        ) : !gate.allowed ? (
          <div className="mt-4 space-y-3"><Banner tone="warn">{gate.reason}</Banner><Link href="/application" className="btn btn-outline">View my application</Link></div>
        ) : (
          <div className="mt-4">
            <ActionForm action={submitRedditAction}>
              <RedditUrlField />
              <TextArea name="note" label="Anything we should know? (optional)" rows={3} maxLength={500} hint="For example, why you changed accounts. Up to 500 characters." />
              <p className="text-sm text-muted">We only store your Reddit username, account creation date and karma values. We never ask for your Reddit password.</p>
              <SubmitButton className="btn btn-primary btn-lg btn-block" pendingLabel="Checking your account…">Submit for review</SubmitButton>
            </ActionForm>
          </div>
        )}
      </section>
    </div>
  );
}
