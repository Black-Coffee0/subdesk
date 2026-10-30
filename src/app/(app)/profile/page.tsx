import Link from 'next/link';
import type { Metadata } from 'next';
import { ActionForm, Field, PasswordField, SubmitButton } from '@/components/forms';
import { Banner, DefList, PageTitle, fmtDate } from '@/components/ui';
import { changePasswordAction, cancelDeletionAction, requestDeletionAction, updateUsernameAction } from '@/app/actions/user';
import { logoutAction } from '@/app/actions/auth';
import { getCurrentSubmission } from '@/services/submissions';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Profile and settings' };

export default async function ProfilePage() {
  const user = await requireUser();
  const sub = await getCurrentSubmission(user.id);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageTitle title="Profile and settings" />

      <section className="card" aria-labelledby="acct-h">
        <h2 id="acct-h" className="text-xl">Your account</h2>
        <div className="mt-2">
          <DefList items={[
            { label: 'Email', value: <>{user.email} {user.email_verified_at ? <span className="pill pill-ok ml-1">Verified</span> : <span className="pill pill-warn ml-1">Not verified</span>}</> },
            { label: 'Username', value: user.username },
            { label: 'Member since', value: fmtDate(user.created_at) },
            { label: 'Reddit account', value: sub ? <>u/{sub.reddit_username} · <Link href="/application">view application</Link></> : <Link href="/application/submit">Not submitted yet</Link> },
          ]} />
        </div>
      </section>

      <section className="card" aria-labelledby="un-h">
        <h2 id="un-h" className="text-xl">Change username</h2>
        <div className="mt-4"><ActionForm action={updateUsernameAction}>
          <Field name="username" label="Username" defaultValue={user.username} required autoComplete="username" />
          <SubmitButton pendingLabel="Saving…">Save username</SubmitButton>
        </ActionForm></div>
      </section>

      <section className="card" aria-labelledby="pw-h">
        <h2 id="pw-h" className="text-xl">Change password</h2>
        <div className="mt-4"><ActionForm action={changePasswordAction}>
          <PasswordField name="current" label="Current password" />
          <PasswordField name="password" label="New password" autoComplete="new-password" hint="At least 10 characters." />
          <PasswordField name="confirm" label="Confirm new password" autoComplete="new-password" />
          <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
        </ActionForm></div>
      </section>

      <section className="card" aria-labelledby="del-h">
        <h2 id="del-h" className="text-xl">Delete my account</h2>
        {user.deletion_requested_at ? (
          <div className="mt-3 space-y-3">
            <Banner tone="warn" title={`Deletion requested on ${fmtDate(user.deletion_requested_at)}`}>An administrator will remove your personal data and your Reddit submission. Wallet and audit records may be kept in anonymised form where there&apos;s a legitimate reason to retain them.</Banner>
            <form action={cancelDeletionAction}><button className="btn btn-outline" type="submit">Cancel deletion request</button></form>
          </div>
        ) : (
          <>
            <p className="mt-2 text-muted">Ask for your account to be deleted. An administrator processes the request: your email, username and Reddit submission are removed. Wallet and audit records may be kept without identifying you, where there&apos;s a legitimate reason to retain them.</p>
            <div className="mt-4"><ActionForm action={requestDeletionAction}>
              <PasswordField name="password" label="Confirm with your password" />
              <SubmitButton className="btn btn-danger-outline" pendingLabel="Requesting…" confirm="Request deletion of your account?">Request account deletion</SubmitButton>
            </ActionForm></div>
          </>
        )}
      </section>

      <form action={logoutAction}><button className="btn btn-outline btn-block sm:hidden" type="submit">Log out</button></form>
    </div>
  );
}
