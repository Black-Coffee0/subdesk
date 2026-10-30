import Link from 'next/link';
import type { Metadata } from 'next';
import { CheckList } from '@/components/eligibility-ui';
import { ApplicationTracker, statusHeadline } from '@/components/tracker';
import { Banner, DefList, Empty, PageTitle, RedditLink, SOURCE_LABEL, StatusPill, VerificationPill, checkMethodLabel, fmtDate, fmtDateTime, fmtNum, one } from '@/components/ui';
import { CopyButton } from '@/components/copy-button';
import { checkBase } from '@/lib/eligibility';
import { getBaseThresholds, valuesOf } from '@/services/eligibility';
import { getSettings } from '@/services/settings';
import { canSubmit, getCurrentSubmission, listSubmissionHistory, listVerificationRecords } from '@/services/submissions';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Application status' };

export default async function ApplicationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const sub = await getCurrentSubmission(user.id);
  if (!sub) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle title="Application status" />
        <Empty title="You haven't submitted a Reddit account yet" action={<Link href="/application/submit" className="btn btn-primary">Submit Reddit account</Link>}>
          Submit your profile to start the review.
        </Empty>
      </div>
    );
  }
  const [records, base, s, gate, history] = await Promise.all([
    listVerificationRecords(sub.id), getBaseThresholds(), getSettings(), canSubmit(user.id), listSubmissionHistory(user.id),
  ]);
  const latest = records[0];
  const values = valuesOf(sub);
  const check = checkBase(values, base);
  const older = history.filter((h) => h.id !== sub.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle title="Application status" actions={gate.allowed ? <Link href="/application/submit" className="btn btn-outline">Update or resubmit</Link> : undefined} />
      {one(sp.submitted) && <Banner tone="ok" title="Submitted">We received u/{sub.reddit_username}. The check ran right away; see the result below.</Banner>}

      <section className="card card-lift">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-[1.35rem] font-semibold leading-snug">{statusHeadline(sub.status)}</p>
          <StatusPill status={sub.status} />
        </div>
        {sub.status === 'Needs More Information' && <blockquote className="mt-4 rounded-lg border-l-4 border-warn bg-warn-soft px-4 py-3 text-warn"><p className="text-sm font-semibold">Message from the administrator</p><p>{sub.info_request}</p></blockquote>}
        {sub.status === 'Rejected' && <blockquote className="mt-4 rounded-lg border-l-4 border-bad bg-bad-soft px-4 py-3 text-bad"><p className="text-sm font-semibold">Reason from the administrator</p><p>{sub.rejection_reason || 'No reason was recorded.'}</p>{!sub.allow_resubmit && <p className="mt-2 text-sm">Resubmission isn&apos;t available for this application.</p>}</blockquote>}
        {sub.status === 'Suspended' && <blockquote className="mt-4 rounded-lg border-l-4 border-bad bg-bad-soft px-4 py-3 text-bad"><p className="text-sm font-semibold">Why your access is suspended</p><p>{sub.suspension_reason || 'No reason was recorded.'}</p><p className="mt-2 text-sm">Tasks and task applications are blocked until the suspension is lifted.</p></blockquote>}
        <div className="mt-6"><ApplicationTracker s={sub} /></div>
      </section>

      <section className="card" aria-labelledby="det-h">
        <h2 id="det-h" className="text-xl">What we recorded</h2>
        <div className="mt-2">
          <DefList items={[
            { label: 'Reddit account', value: <RedditLink url={sub.profile_url}>u/{sub.reddit_username}</RedditLink> },
            { label: 'Submitted', value: fmtDateTime(sub.submitted_at) },
            { label: 'Verification result', value: <VerificationPill state={sub.verification_state} /> },
            ...(latest ? [{ label: 'Method and time', value: <>{checkMethodLabel(latest, 'user')}<span className="block text-sm font-normal text-muted">{fmtDateTime(latest.created_at)}</span></> }, { label: 'What happened', value: latest.detail ?? '—' }] : []),
            ...(values ? [
              { label: 'Account created', value: fmtDate(values.accountCreatedAt) },
              { label: 'Comment karma', value: fmtNum(values.commentKarma) },
              { label: 'Post karma', value: fmtNum(values.postKarma) },
              { label: 'Where these came from', value: SOURCE_LABEL[values.source] },
            ] : []),
            ...(sub.user_note ? [{ label: 'Your note', value: sub.user_note }] : []),
          ]} />
        </div>
      </section>

      {s.requireOwnershipCode && sub.ownership_state !== 'confirmed' && (
        <section className="card">
          <h2 className="text-xl">Confirm the account is yours</h2>
          <p className="mt-1 text-muted">
            {sub.ownership_state === 'not_confirmed' ? 'We did not find your code in your Reddit bio. ' : 'An administrator will look for your code in your Reddit bio. '}
            Add it to the &ldquo;About&rdquo; section of your profile, then update your submission.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3"><code className="rounded-lg border border-line-strong bg-paper px-4 py-2 font-mono text-lg font-semibold">{user.verification_code}</code><CopyButton text={user.verification_code} label="Copy code" /></div>
        </section>
      )}

      <section className="card" aria-labelledby="min-h">
        <h2 id="min-h" className="text-xl">Minimum requirements</h2>
        <p className="mb-4 mt-1 text-sm text-muted">{values ? 'Based on the values recorded above.' : 'These can be checked once your account details are verified.'}</p>
        <CheckList checks={check.checks} />
        {values && <p className="mt-4 text-sm text-muted">{check.allPassed ? 'All three minimums are met. The administrator still decides.' : 'Not all minimums are met.'}</p>}
      </section>

      {older.length > 0 && (
        <section className="card" aria-labelledby="hist-h">
          <h2 id="hist-h" className="text-xl">Earlier submissions</h2>
          <ul className="divide-list mt-2">
            {older.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0"><p className="font-medium">u/{h.reddit_username}</p><p className="text-sm text-muted">{fmtDate(h.submitted_at)}</p></div>
                <StatusPill status={h.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
