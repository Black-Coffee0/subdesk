import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm, SubmitButton, TextArea } from '@/components/forms';
import { Banner, DefList, PageTitle, StatusPill, fmtDate, fmtDateTime } from '@/components/ui';
import { isAppError } from '@/lib/errors';
import { formatINR } from '@/lib/money';
import { listAudit } from '@/services/audit';
import { getCurrentSubmission } from '@/services/submissions';
import { adminGetUser } from '@/services/users';
import { markEmailVerifiedAction, processDeletionAction, setUserStatusAction } from '@/app/actions/admin';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'User' };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage('manage_users');
  const { id } = await params;
  const u = await adminGetUser(admin.id, id).catch((e) => { if (isAppError(e) && e.code === 'not_found') return null; throw e; });
  if (!u) notFound();
  const [sub, audit] = await Promise.all([getCurrentSubmission(u.id), listAudit(admin.id, { targetId: u.id })]);
  const isAdminAccount = u.role === 'admin';
  const self = u.id === admin.id;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/admin/users" className="text-sm font-semibold">← Users</Link>
        <div className="mt-2"><PageTitle title={u.username} actions={<StatusPill status={u.status === 'active' ? 'active' : 'blocked'} label={u.status === 'active' ? 'Active' : 'Blocked'} />}>{u.email}</PageTitle></div>
      </div>
      {u.deleted_at && <Banner tone="bad" title="This account was deleted">Personal data was removed on {fmtDate(u.deleted_at)}.</Banner>}
      {u.deletion_requested_at && !u.deleted_at && <Banner tone="warn" title="Deletion requested">Requested on {fmtDate(u.deletion_requested_at)}. Processing removes the email, username and Reddit submission, and keeps wallet and audit records without identifying details.</Banner>}

      <section className="card"><DefList items={[
        { label: 'Role', value: u.role === 'admin' ? 'Administrator' : 'User' },
        { label: 'Email', value: <>{u.email} {u.email_verified_at ? <span className="pill pill-ok">Verified</span> : <span className="pill pill-warn">Not verified</span>}</> },
        { label: 'Joined', value: fmtDate(u.created_at) },
        { label: 'Reddit application', value: sub ? <><Link href={`/admin/applications/${sub.id}`}>u/{sub.reddit_username}</Link> <StatusPill status={sub.status} /></> : 'Not submitted' },
        { label: 'Wallet balance', value: <>{formatINR(u.available_paise)} · <Link href={`/admin/wallet?user=${u.id}`}>ledger and adjustments</Link></> },
        ...(u.suspension_reason ? [{ label: 'Block reason', value: u.suspension_reason }] : []),
        ...(u.is_test_data ? [{ label: 'Data', value: 'Test account (not live data)' }] : []),
      ]} /></section>

      {!u.deleted_at && (
        <section className="card space-y-5" aria-labelledby="act-h">
          <h2 id="act-h" className="text-xl">Account actions</h2>
          {isAdminAccount || self ? <p className="text-muted">Administrator accounts can&apos;t be blocked or deleted from the web interface. This protects you from locking yourself out.</p> : (
            <>
              <ActionForm action={setUserStatusAction}>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="status" value={u.status === 'active' ? 'suspended' : 'active'} />
                <TextArea name="reason" label={u.status === 'active' ? 'Reason for blocking' : 'Note (optional)'} rows={2} maxLength={500} hint={u.status === 'active' ? 'Blocking ends all of their sessions immediately and stops them logging in.' : undefined} />
                <SubmitButton className={u.status === 'active' ? 'btn btn-danger-outline' : 'btn btn-primary'} pendingLabel="Saving…" confirm={u.status === 'active' ? 'Block this account?' : undefined}>{u.status === 'active' ? 'Block account' : 'Reactivate account'}</SubmitButton>
              </ActionForm>
              {!u.email_verified_at && (
                <ActionForm action={markEmailVerifiedAction} className="border-t border-line pt-5">
                  <input type="hidden" name="userId" value={u.id} />
                  <p className="text-sm text-muted">Use this if the user can&apos;t receive email and you&apos;ve confirmed their address another way.</p>
                  <SubmitButton className="btn btn-outline btn-sm" pendingLabel="Saving…">Mark email as verified</SubmitButton>
                </ActionForm>
              )}
              {u.deletion_requested_at && (
                <ActionForm action={processDeletionAction} className="border-t border-line pt-5">
                  <input type="hidden" name="userId" value={u.id} />
                  <SubmitButton className="btn btn-danger" pendingLabel="Deleting…" confirm="Permanently remove this person's personal data? This cannot be undone.">Process deletion request</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </section>
      )}

      <section aria-labelledby="aud-h">
        <h2 id="aud-h" className="mb-3 text-xl">Activity about this user</h2>
        {audit.rows.length === 0 ? <p className="text-muted">No recorded activity.</p> : (
          <ul className="divide-list overflow-hidden rounded-card border border-line bg-surface">
            {audit.rows.slice(0, 20).map((r) => <li key={r.id} className="row flex flex-wrap justify-between gap-2"><span><span className="font-semibold">{r.actor_label.replace(/ <.*>$/, '')}</span> <span className="text-muted">· {r.action}</span></span><span className="text-sm text-muted">{fmtDateTime(r.created_at)}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
