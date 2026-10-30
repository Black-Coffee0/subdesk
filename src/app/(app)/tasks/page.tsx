import Link from 'next/link';
import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import { Banner, Empty, PageTitle, StatusPill, one } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { isAppError } from '@/lib/errors';
import { getUserEligibility } from '@/services/eligibility';
import { getCurrentSubmission } from '@/services/submissions';
import { listCategories, listMarketplace, type MarketplaceTask } from '@/services/tasks';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Tasks' };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = one(sp.q), subreddit = one(sp.subreddit), category = one(sp.category);

  const el = await getUserEligibility(user.id);
  if (!el.approved) {
    const sub = await getCurrentSubmission(user.id);
    return (
      <div className="mx-auto max-w-2xl">
        <PageTitle title="Tasks" />
        <Banner tone={el.restricted ? 'bad' : 'info'} title={el.restricted ? 'Your task access is suspended' : 'Tasks unlock after approval'}>
          {el.restricted ? 'You can’t view or apply for tasks while suspended.' : 'Only approved users can see tasks. Submit your Reddit account and wait for the administrator’s review.'}
        </Banner>
        <div className="mt-5"><Link href={sub ? '/application' : '/application/submit'} className="btn btn-primary">{sub ? 'View application status' : 'Submit Reddit account'}</Link></div>
      </div>
    );
  }

  let tasks: MarketplaceTask[] = [];
  let error = '';
  try {
    tasks = await listMarketplace(user.id, { q, subreddit, category });
  } catch (e) {
    if (isAppError(e)) error = e.message; else throw e;
  }
  const categories = await listCategories(true);
  const subs = el.subreddits.filter((x) => x.eligibility.state !== 'unavailable').map((x) => x.subreddit);
  const filtered = Boolean(q || subreddit || category);

  return (
    <div className="space-y-6">
      <PageTitle title="Tasks for you" actions={<Link href="/eligibility" className="btn btn-outline btn-sm">My eligibility</Link>}>
        Only tasks your verified account currently qualifies for are shown. Eligibility is checked again when you apply.
      </PageTitle>
      {error && <Banner tone="bad">{error}</Banner>}

      <form method="get" className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1.4fr_1fr_1fr_auto]" role="search">
        <div className="relative">
          <label htmlFor="q" className="sr-only">Search tasks</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id="q" name="q" defaultValue={q} className="input pl-9" placeholder="Search tasks" />
        </div>
        <div>
          <label htmlFor="subreddit" className="sr-only">Subreddit</label>
          <select id="subreddit" name="subreddit" defaultValue={subreddit} className="input">
            <option value="">All subreddits</option>
            {subs.map((s) => <option key={s.id} value={s.id}>r/{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="category" className="sr-only">Category</label>
          <select id="category" name="category" defaultValue={category} className="input">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit">Filter</button>
          {filtered && <Link href="/tasks" className="btn btn-quiet">Clear</Link>}
        </div>
      </form>

      {tasks.length === 0 ? (
        filtered ? (
          <Empty title="No tasks match those filters" action={<Link href="/tasks" className="btn btn-outline">Clear filters</Link>}>Try a different search.</Empty>
        ) : (
          <Empty title="No tasks are available right now">The administrator hasn&apos;t added tasks you qualify for yet. You&apos;ll get a notification when new ones appear.</Empty>
        )
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-col rounded-card border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-muted">r/{t.subreddit_name} · {t.category_name}</p>
                <StatusPill status={t.my_status ?? 'Available'} />
              </div>
              <h2 className="mt-2 text-[1.2rem]">{t.title}</h2>
              {t.description && <p className="mt-1.5 line-clamp-3 text-[0.95rem] text-muted">{t.description}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted">Requirements</dt><dd className="font-medium">{t.subreddit.min_account_age_months}+ months · {t.subreddit.min_comment_karma}+ comment · {t.subreddit.min_post_karma}+ post</dd></div>
                {t.reward_paise !== null && <div><dt className="text-muted">Reward</dt><dd className="font-medium">{formatINR(t.reward_paise)}</dd></div>}
              </dl>
              {t.eligibility.state === 'eligible_review' && <p className="mt-3 text-sm text-warn">This subreddit needs a manual review after you apply.</p>}
              <div className="mt-auto pt-5"><Link href={`/tasks/${t.id}`} className="btn btn-primary btn-block sm:w-auto">{t.my_status ? 'View details' : 'View and apply'}</Link></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
