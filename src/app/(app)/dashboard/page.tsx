import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Bell, CircleHelp, Wallet } from 'lucide-react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { ApplicationTracker, statusHeadline } from '@/components/tracker';
import { Banner, Empty, RedditLink, SectionTitle, SOURCE_LABEL, Stat, StatusPill, VerificationPill, fmtDate, fmtDateTime, fmtNum, monthsLabel, one } from '@/components/ui';
import { emailVerificationRequired } from '@/lib/config';
import { accountAgeMonths } from '@/lib/eligibility';
import { formatINR } from '@/lib/money';
import { getUserDashboard } from '@/services/dashboard';
import { valuesOf } from '@/services/eligibility';
import { canSubmit } from '@/services/submissions';
import { resendVerificationAction } from '@/app/actions/auth';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [d, gate] = await Promise.all([getUserDashboard(user.id), canSubmit(user.id)]);
  const sub = d.submission;
  const status = sub?.status ?? 'Not Submitted';
  const values = valuesOf(sub);
  const needsVerify = emailVerificationRequired() && !user.email_verified_at;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.65rem] sm:text-[2rem]">Hi, {user.username}</h1>
        <p className="text-muted">Here&apos;s where your account stands.</p>
      </div>

      {one(sp.verified) && <Banner tone="ok">Email verified. You can now submit your Reddit account.</Banner>}
      {user.deletion_requested_at && <Banner tone="warn" title="Account deletion requested">An administrator will process it. You can cancel from <Link href="/profile">Profile</Link>.</Banner>}
      {needsVerify && (
        <Banner tone="warn" title="Verify your email to continue">
          We sent a link to {user.email}. You need it before submitting your Reddit account or applying for tasks.
          <div className="mt-3">
            <ActionForm action={resendVerificationAction} className="space-y-3" >
              <SubmitButton className="btn btn-outline btn-sm" pendingLabel="Sending…">Send the link again</SubmitButton>
            </ActionForm>
          </div>
        </Banner>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {/* ---------------------------------------------------- status */}
          <section className="card card-lift" aria-labelledby="status-h">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="status-h" className="text-xl">Application status</h2>
              <StatusPill status={status} />
            </div>
            <p className="mt-3 font-display text-[1.35rem] font-semibold leading-snug">{statusHeadline(status)}</p>

            {!sub && (
              <>
                <p className="mt-2 text-muted">Submit your Reddit profile and an administrator will review it. Once approved, you can see and apply for tasks your account qualifies for.</p>
                <div className="mt-5">
                  {gate.allowed ? <Link href="/application/submit" className="btn btn-primary btn-lg">Submit Reddit account</Link> : <Banner tone="warn">{gate.reason}</Banner>}
                </div>
              </>
            )}

            {sub && (status === 'Pending Verification' || status === 'Pending Admin Review') && (
              <>
                <p className="mt-2 text-muted">Administrator review is required before tasks unlock. You&apos;ll get a notification when something changes.</p>
                <div className="mt-6"><ApplicationTracker s={sub} /></div>
                <div className="mt-5"><Link href="/application" className="btn btn-outline btn-sm">See details</Link></div>
              </>
            )}

            {sub && status === 'Needs More Information' && (
              <>
                <blockquote className="mt-3 rounded-lg border-l-4 border-warn bg-warn-soft px-4 py-3 text-warn">{sub.info_request || 'The administrator asked for more details.'}</blockquote>
                <div className="mt-5 flex flex-wrap gap-2">
                  {gate.allowed && <Link href="/application/submit" className="btn btn-primary">Update and resubmit</Link>}
                  <Link href="/application" className="btn btn-outline">See details</Link>
                </div>
              </>
            )}

            {sub && status === 'Rejected' && (
              <>
                <blockquote className="mt-3 rounded-lg border-l-4 border-bad bg-bad-soft px-4 py-3 text-bad">
                  <p className="text-sm font-semibold">Reason from the administrator</p>
                  <p>{sub.rejection_reason || 'No reason was recorded.'}</p>
                </blockquote>
                <div className="mt-5 flex flex-wrap gap-2">
                  {sub.allow_resubmit && gate.allowed ? <Link href="/application/submit" className="btn btn-primary">Resubmit a Reddit account</Link> : <p className="text-sm text-muted">Resubmission isn&apos;t available for this application. Contact support if you think this is a mistake.</p>}
                  <Link href="/application" className="btn btn-outline">See details</Link>
                </div>
              </>
            )}

            {sub && status === 'Suspended' && (
              <>
                <Banner tone="bad" title="Restricted actions are blocked">
                  {sub.suspension_reason || 'The administrator suspended your access.'} You can&apos;t view or apply for tasks until this is lifted. Contact support if you have questions.
                </Banner>
              </>
            )}

            {sub && status === 'Approved' && (
              <>
                <p className="mt-2 text-muted">
                  You currently qualify for <strong className="text-ink">{d.eligibility.eligibleCount}</strong> {d.eligibility.eligibleCount === 1 ? 'subreddit' : 'subreddits'}.
                </p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <Link href="/tasks" className="btn btn-primary btn-lg">Apply for More Tasks <ArrowRight className="size-5" aria-hidden /></Link>
                  <Link href="/eligibility" className="btn btn-outline btn-lg">See my eligibility</Link>
                </div>
              </>
            )}
          </section>

          {/* ---------------------------------------------------- reddit account */}
          {sub && (
            <section className="card" aria-labelledby="acct-h">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="acct-h" className="text-xl">Reddit account</h2>
                <VerificationPill state={sub.verification_state} />
              </div>
              <p className="mt-2"><RedditLink url={sub.profile_url}>u/{sub.reddit_username}</RedditLink></p>
              {values ? (
                <>
                  <div className="mt-4 grid grid-cols-3 gap-4">
                    <Stat label="Account age" value={monthsLabel(accountAgeMonths(values.accountCreatedAt))} hint={`Since ${fmtDate(values.accountCreatedAt)}`} />
                    <Stat label="Comment karma" value={fmtNum(values.commentKarma)} />
                    <Stat label="Post karma" value={fmtNum(values.postKarma)} />
                  </div>
                  <p className="mt-4 text-sm text-muted">{SOURCE_LABEL[values.source]}{values.verifiedAt ? ` · ${fmtDateTime(values.verifiedAt)}` : ''}</p>
                </>
              ) : (
                <p className="mt-3 text-muted">Account age and karma appear here once they&apos;ve been verified. We never show values we haven&apos;t actually retrieved.</p>
              )}
            </section>
          )}

          {/* ---------------------------------------------------- applications */}
          <section aria-labelledby="apps-h">
            <SectionTitle action={d.applications.length > 0 ? <Link href="/tasks/mine" className="text-sm font-semibold">All task history</Link> : undefined}>
              <span id="apps-h">Recent task applications</span>
            </SectionTitle>
            {d.applications.length === 0 ? (
              <Empty title="No task applications yet">{status === 'Approved' ? 'Browse the tasks you qualify for and apply.' : 'Task applications open after your account is approved.'}</Empty>
            ) : (
              <ul className="divide-list overflow-hidden rounded-card border border-line bg-surface">
                {d.applications.map((a) => (
                  <li key={a.id} className="row flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{a.task_title}</p>
                      <p className="text-sm text-muted">r/{a.subreddit_name} · {fmtDate(a.created_at)}</p>
                    </div>
                    <StatusPill status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ------------------------------------------------------ side column */}
        <div className="space-y-6">
          <section className="card" aria-labelledby="wallet-h">
            <div className="flex items-center justify-between">
              <h2 id="wallet-h" className="text-xl">Wallet</h2>
              <Wallet className="size-5 text-muted" aria-hidden />
            </div>
            <p className="mt-2 font-display text-[2.2rem] font-bold leading-none">{formatINR(d.wallet.availablePaise)}</p>
            <p className="mt-1 text-sm text-muted">Available balance</p>
            {d.wallet.pendingRewardsPaise > 0 && <p className="mt-2 text-sm">Pending on accepted tasks: <strong>{formatINR(d.wallet.pendingRewardsPaise)}</strong></p>}
            <p className="mt-3 text-sm text-muted">Withdrawals and payments aren&apos;t available yet.</p>
            <Link href="/wallet" className="btn btn-outline btn-sm mt-4">View transactions</Link>
          </section>

          <section className="card" aria-labelledby="notif-h">
            <div className="flex items-center justify-between">
              <h2 id="notif-h" className="text-xl">Notifications{d.unread > 0 && <span className="ml-2 align-middle pill pill-info">{d.unread} new</span>}</h2>
              <Bell className="size-5 text-muted" aria-hidden />
            </div>
            {d.notifications.length === 0 ? (
              <p className="mt-3 text-muted">Nothing yet. Updates about your application and tasks show up here.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {d.notifications.map((n) => (
                  <li key={n.id} className="flex gap-2.5">
                    <span className={`mt-2 size-2 flex-none rounded-full ${n.read_at ? 'bg-transparent' : 'bg-accent'}`} aria-label={n.read_at ? undefined : 'Unread'} />
                    <div className="min-w-0">
                      <p className="text-[0.95rem] font-semibold leading-snug">{n.link ? <Link href={n.link} className="text-ink no-underline hover:underline">{n.title}</Link> : n.title}</p>
                      {n.body && <p className="text-sm text-muted">{n.body}</p>}
                      <p className="text-xs text-muted">{fmtDateTime(n.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/notifications" className="mt-4 inline-block text-sm font-semibold">See all notifications</Link>
          </section>

          <Link href="/help" className="flex items-center gap-3 rounded-card border border-line bg-surface px-5 py-4 font-semibold text-ink no-underline hover:border-line-strong hover:text-ink">
            <CircleHelp className="size-5 text-accent" aria-hidden /> Help and support
          </Link>
        </div>
      </div>
    </div>
  );
}
