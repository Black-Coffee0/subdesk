import Link from 'next/link';
import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { ActionForm, CheckField, Field, SubmitButton, TextArea } from '@/components/forms';
import { CheckList } from '@/components/eligibility-ui';
import { Banner, DefList, RedditLink, SOURCE_LABEL, StatusPill, VerificationPill, checkMethodLabel, fmtDate, fmtDateTime, fmtNum, monthsLabel } from '@/components/ui';
import { accountAgeMonths } from '@/lib/eligibility';
import { adminGetApplication } from '@/services/submissions';
import { valuesOf } from '@/services/eligibility';
import { decideApplicationAction, manualValuesAction, reverifyAction, saveNotesAction } from '@/app/actions/admin';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Review application' };

const OWNERSHIP: Record<string, string> = { confirmed: 'Confirmed (code found in the Reddit bio)', not_confirmed: 'Not confirmed (code not found in the bio)', not_checked: 'Not checked automatically' };

export default async function ApplicationReview({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage('review_applications');
  const { id } = await params;
  const d = await adminGetApplication(admin.id, id);
  const s = d.submission;
  const values = valuesOf(s);
  const latest = d.records[0];
  const can = {
    approve: ['Pending Admin Review', 'Needs More Information', 'Rejected'].includes(s.status),
    reject: ['Pending Verification', 'Pending Admin Review', 'Needs More Information'].includes(s.status),
    request_info: s.status === 'Pending Admin Review',
    mark_manual: ['Pending Verification', 'Pending Admin Review', 'Needs More Information'].includes(s.status),
    suspend: s.status === 'Approved',
    reinstate: s.status === 'Suspended',
  };
  const noActions = !Object.values(can).some(Boolean);
  const superseded = Boolean(s.superseded_at);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/applications" className="text-sm font-semibold">← Applications</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.65rem] sm:text-[2rem]">u/{s.reddit_username}</h1>
            <p className="mt-1 text-muted">Submitted by <Link href={`/admin/users/${d.user.id}`}>{d.user.username}</Link> on {fmtDateTime(s.submitted_at)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={s.status} /><VerificationPill state={s.verification_state} />
            {d.user.is_test_data && <span className="pill pill-neutral">Test data</span>}
          </div>
        </div>
        <a href={s.profile_url} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-outline mt-4">Open Reddit profile in a new tab <ExternalLink className="size-4" aria-hidden /></a>
      </div>

      {superseded && <Banner tone="warn" title="Replaced by a newer submission">This user submitted again. This record is read-only history.</Banner>}
      {d.sameRedditName.length > 0 && (
        <Banner tone="warn" title="Same Reddit username on other accounts">
          {d.sameRedditName.map((o) => <span key={o.id} className="mr-3 inline-block"><Link href={`/admin/applications/${o.id}`}>{o.username}</Link> ({o.status})</span>)}
        </Banner>
      )}
      {s.verification_state !== 'verified' && !superseded && (
        <Banner tone="info" title={s.verification_state === 'manual_review_required' ? 'Manual verification needed' : 'Not verified'}>
          Open the Reddit profile, check the creation date and karma yourself, then enter them under “Enter verified values”. Approval is blocked until verified values exist.
        </Banner>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="space-y-6 lg:col-start-1 lg:row-start-1">
          <section className="card" aria-labelledby="ver-h">
            <h2 id="ver-h" className="text-xl">Verification</h2>
            <div className="mt-2">
              <DefList items={[
                { label: 'Result', value: <VerificationPill state={s.verification_state} /> },
                { label: 'Method and time', value: latest ? <>{checkMethodLabel(latest, 'admin')}<span className="block text-sm font-normal text-muted">{fmtDateTime(latest.created_at)}</span></> : 'No check recorded yet' },
                { label: 'Account created', value: values ? `${fmtDate(values.accountCreatedAt)} (${monthsLabel(accountAgeMonths(values.accountCreatedAt))})` : 'Not verified' },
                { label: 'Comment karma', value: values ? fmtNum(values.commentKarma) : 'Not verified' },
                { label: 'Post karma', value: values ? fmtNum(values.postKarma) : 'Not verified' },
                { label: 'Values source', value: values ? SOURCE_LABEL[values.source] : '—' },
                { label: 'Ownership code', value: <>{OWNERSHIP[s.ownership_state]}<span className="block text-sm font-normal text-muted">Look for: <code className="rounded bg-paper px-1.5 py-0.5 font-mono font-semibold">{d.user.verification_code}</code>{d.requireOwnership ? '' : ' (not required by current settings)'}</span></> },
                ...(s.user_note ? [{ label: 'Note from user', value: s.user_note }] : []),
              ]} />
            </div>
            {latest?.detail && <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm">{latest.detail}</p>}
            {latest && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold">Raw evidence from the last check</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-paper p-3 text-xs">{JSON.stringify({ outcome: latest.outcome, failure_code: latest.failure_code, checks: latest.checks, evidence: latest.evidence }, null, 2)}</pre>
              </details>
            )}
          </section>

          <section className="card" aria-labelledby="auto-h">
            <h2 id="auto-h" className="text-xl">Automated eligibility result</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Against the platform minimums currently configured. These are all required.</p>
            <CheckList checks={d.baseCheck.checks} />
            <p className="mt-4 font-semibold">{!d.baseCheck.determinable ? 'Cannot be determined until values are verified.' : d.baseCheck.allPassed ? 'All minimums are met.' : 'One or more minimums are not met.'}</p>
          </section>
        </div>

        <aside className="space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {!superseded && (
            <section className="card card-lift" aria-labelledby="dec-h">
              <h2 id="dec-h" className="text-xl">Decision</h2>
              {noActions ? <p className="mt-2 text-muted">No decision actions apply to “{s.status}”.</p> : (
                <div className="mt-3">
                  <ActionForm action={decideApplicationAction}>
                    <input type="hidden" name="submissionId" value={s.id} />
                    <TextArea name="reason" label="Reason or message" rows={3} maxLength={1000} hint="Required to reject, request information or suspend. The user sees it." />
                    {can.reject && <CheckField name="allowResubmit" label="Allow the user to resubmit if rejected" defaultChecked />}
                    <div className="flex flex-col gap-2">
                      {can.approve && <SubmitButton className="btn btn-primary btn-block" pendingLabel="Working…" name="intent" value="approve">{s.status === 'Rejected' ? 'Approve instead' : 'Approve'}</SubmitButton>}
                      {can.reinstate && <SubmitButton className="btn btn-primary btn-block" pendingLabel="Working…" name="intent" value="reinstate">Reinstate</SubmitButton>}
                      {can.request_info && <SubmitButton className="btn btn-outline btn-block" pendingLabel="Working…" name="intent" value="request_info">Request more information</SubmitButton>}
                      {can.mark_manual && <SubmitButton className="btn btn-outline btn-block" pendingLabel="Working…" name="intent" value="mark_manual">Mark for manual verification</SubmitButton>}
                      {can.reject && <SubmitButton className="btn btn-danger-outline btn-block" pendingLabel="Working…" name="intent" value="reject" confirm="Reject this application?">Reject</SubmitButton>}
                      {can.suspend && <SubmitButton className="btn btn-danger-outline btn-block" pendingLabel="Working…" name="intent" value="suspend" confirm="Suspend this user's task access?">Suspend</SubmitButton>}
                    </div>
                  </ActionForm>
                </div>
              )}
            </section>
          )}

          {!superseded && (
            <section className="card" aria-labelledby="manual-h">
              <h2 id="manual-h" className="text-xl">Enter verified values</h2>
              <p className="mb-3 mt-1 text-sm text-muted">After reviewing the profile yourself. Recorded with your name, the time and your evidence note.</p>
              <ActionForm action={manualValuesAction}>
                <input type="hidden" name="submissionId" value={s.id} />
                <Field name="accountCreatedAt" label="Account created on" type="date" required defaultValue={values ? values.accountCreatedAt.toISOString().slice(0, 10) : ''} />
                <div className="grid grid-cols-2 gap-3">
                  <Field name="commentKarma" label="Comment karma" type="number" inputMode="numeric" min={0} required defaultValue={values?.commentKarma ?? ''} />
                  <Field name="postKarma" label="Post karma" type="number" inputMode="numeric" min={0} required defaultValue={values?.postKarma ?? ''} />
                </div>
                <CheckField name="ownershipConfirmed" label="I found the user's code in the Reddit bio" defaultChecked={s.ownership_state === 'confirmed'} />
                <TextArea name="evidenceNote" label="Evidence note" rows={2} maxLength={500} required hint="What you checked, for example “Read from the profile on the date above”." />
                <SubmitButton className="btn btn-outline btn-block" pendingLabel="Saving…">Save verified values</SubmitButton>
              </ActionForm>
              <div className="mt-4 border-t border-line pt-4">
                <ActionForm action={reverifyAction} className="">
                  <input type="hidden" name="submissionId" value={s.id} />
                  <SubmitButton className="btn btn-quiet btn-sm" pendingLabel="Checking Reddit…">Run the automatic check again</SubmitButton>
                </ActionForm>
              </div>
            </section>
          )}

          <section className="card" aria-labelledby="notes-h">
            <h2 id="notes-h" className="text-xl">Administrator notes</h2>
            <p className="mb-3 mt-1 text-sm text-muted">Private. Users never see these.</p>
            <ActionForm action={saveNotesAction}>
              <input type="hidden" name="submissionId" value={s.id} />
              <TextArea name="notes" label="Notes" rows={4} maxLength={2000} defaultValue={s.admin_notes ?? ''} />
              <SubmitButton className="btn btn-outline btn-block" pendingLabel="Saving…">Save notes</SubmitButton>
            </ActionForm>
          </section>
        </aside>

        <div className="space-y-6 lg:col-start-1 lg:row-start-2">
          <section className="card" aria-labelledby="user-h">
            <h2 id="user-h" className="text-xl">Platform user</h2>
            <div className="mt-2"><DefList items={[
              { label: 'Username', value: <Link href={`/admin/users/${d.user.id}`}>{d.user.username}</Link> },
              { label: 'Email', value: <>{d.user.email} {d.user.email_verified_at ? <span className="pill pill-ok">Verified</span> : <span className="pill pill-warn">Not verified</span>}</> },
              { label: 'Joined', value: fmtDate(d.user.created_at) },
              { label: 'Reddit profile', value: <RedditLink url={s.profile_url}>{s.profile_url}</RedditLink> },
            ]} /></div>
          </section>

          <section className="card" aria-labelledby="rec-h">
            <h2 id="rec-h" className="text-xl">Verification history</h2>
            {d.records.length === 0 ? <p className="mt-2 text-muted">No checks recorded.</p> : (
              <ul className="divide-list mt-2">
                {d.records.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{checkMethodLabel(r, 'admin')}</span><span className="text-sm text-muted">{fmtDateTime(r.created_at)}</span></div>
                    <div className="mt-1 flex flex-wrap items-center gap-2"><VerificationPill state={r.outcome} />{r.comment_karma !== null && <span className="text-sm text-muted">{fmtNum(r.comment_karma)} comment · {fmtNum(r.post_karma)} post</span>}</div>
                    {r.detail && <p className="mt-1 text-sm text-muted">{r.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="dh-h">
            <h2 id="dh-h" className="text-xl">Decisions</h2>
            {d.decisions.length === 0 ? <p className="mt-2 text-muted">No decisions yet.</p> : (
              <ul className="divide-list mt-2">
                {d.decisions.map((x) => (
                  <li key={x.id} className="py-3">
                    <p><span className="font-semibold">{x.admin_label ?? 'Unknown'}</span> <span className="text-muted">· {x.action.replace(/_/g, ' ')}{x.from_status && x.to_status ? ` (${x.from_status} → ${x.to_status})` : ''}</span></p>
                    {x.reason && <p className="text-sm">{x.reason}</p>}
                    <p className="text-xs text-muted">{fmtDateTime(x.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {d.previous.length > 0 && (
            <section className="card" aria-labelledby="prev-h">
              <h2 id="prev-h" className="text-xl">Previous submissions by this user</h2>
              <ul className="divide-list mt-2">
                {d.previous.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div><Link href={`/admin/applications/${p.id}`} className="font-medium">u/{p.reddit_username}</Link><p className="text-sm text-muted">{fmtDate(p.submitted_at)}{p.rejection_reason ? ` · ${p.rejection_reason}` : ''}</p></div>
                    <StatusPill status={p.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
