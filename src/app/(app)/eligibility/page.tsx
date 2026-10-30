import Link from 'next/link';
import type { Metadata } from 'next';
import { SubredditCard } from '@/components/eligibility-ui';
import { Banner, Empty, PageTitle, SOURCE_LABEL, Stat, StatusPill, fmtNum, monthsLabel } from '@/components/ui';
import { getUserEligibility } from '@/services/eligibility';
import { getCurrentSubmission } from '@/services/submissions';
import { listMarketplace } from '@/services/tasks';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Your eligibility' };

export default async function EligibilityPage() {
  const user = await requireUser();
  const [el, sub] = await Promise.all([getUserEligibility(user.id), getCurrentSubmission(user.id)]);

  if (!el.approved) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle title="Your eligibility" />
        <Banner tone={el.restricted ? 'bad' : 'info'} title={el.restricted ? 'Your task access is suspended' : 'Available after approval'}>
          {el.restricted
            ? 'Subreddit eligibility is hidden while your access is suspended.'
            : 'Subreddit eligibility and tasks unlock once an administrator approves your Reddit account. Submitting your profile is not enough on its own.'}
        </Banner>
        <div className="mt-5 flex gap-2">
          <Link href={sub ? '/application' : '/application/submit'} className="btn btn-primary">{sub ? 'View application status' : 'Submit Reddit account'}</Link>
        </div>
      </div>
    );
  }

  const tasks = await listMarketplace(user.id);
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.subreddit_id, (counts.get(t.subreddit_id) ?? 0) + 1);
  const available = el.subreddits.filter((x) => x.eligibility.state !== 'unavailable');
  const unavailable = el.subreddits.filter((x) => x.eligibility.state === 'unavailable');
  const a = el.account;

  return (
    <div className="space-y-8">
      <PageTitle title="Your eligibility">Calculated live from your verified account values and the rules the administrator has configured.</PageTitle>

      <section className="card card-lift" aria-labelledby="acct">
        <h2 id="acct" className="sr-only">Account summary</h2>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
          <Stat label="Account status" value={<StatusPill status="Approved" />} />
          <Stat label="Account age" value={a ? monthsLabel(a.ageMonths) : '—'} />
          <Stat label="Comment karma" value={fmtNum(a?.commentKarma)} />
          <Stat label="Post karma" value={fmtNum(a?.postKarma)} />
          <Stat label="Eligible subreddits" value={el.eligibleCount} />
        </div>
        {a && <p className="mt-4 text-sm text-muted">u/{a.redditUsername} · {SOURCE_LABEL[a.source]}</p>}
      </section>

      {el.subreddits.length === 0 ? (
        <Empty title="No subreddits are configured yet">The administrator hasn&apos;t added any subreddits. Check back later; nothing is hidden from you.</Empty>
      ) : (
        <>
          <section aria-labelledby="elig">
            <h2 id="elig" className="mb-3 text-xl">Subreddits you qualify for ({available.length})</h2>
            {available.length === 0 ? (
              <Empty title="None right now">Your verified account doesn&apos;t meet any subreddit&apos;s requirements yet. See what&apos;s missing below.</Empty>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">{available.map((x) => <SubredditCard key={x.subreddit.id} s={x.subreddit} e={x.eligibility} taskCount={counts.get(x.subreddit.id) ?? 0} />)}</div>
            )}
          </section>
          {unavailable.length > 0 && (
            <section aria-labelledby="unav">
              <h2 id="unav" className="mb-3 text-xl">Currently unavailable ({unavailable.length})</h2>
              <div className="grid gap-4 md:grid-cols-2">{unavailable.map((x) => <SubredditCard key={x.subreddit.id} s={x.subreddit} e={x.eligibility} />)}</div>
            </section>
          )}
          <p className="text-sm text-muted">Meeting a subreddit&apos;s numbers doesn&apos;t guarantee its moderators will accept you. Those are separate decisions.</p>
        </>
      )}
    </div>
  );
}
