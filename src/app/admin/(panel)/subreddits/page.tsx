import Link from 'next/link';
import type { Metadata } from 'next';
import { Banner, Empty, PageTitle, one } from '@/components/ui';
import { adminListSubreddits } from '@/services/tasks';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Subreddits' };

export default async function SubredditsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage('manage_tasks');
  const rows = await adminListSubreddits(admin.id);
  const sp = await searchParams;
  return (
    <div className="space-y-5">
      <PageTitle title="Subreddits" actions={<Link href="/admin/subreddits/new" className="btn btn-primary">Add subreddit</Link>}>
        Each subreddit has its own requirements. Changing a rule updates who qualifies straight away and notifies users who gain access.
      </PageTitle>
      {one(sp.saved) && <Banner tone="ok">Saved. Eligibility is recalculated automatically.</Banner>}
      {rows.length === 0 ? <Empty title="No subreddits yet" action={<Link href="/admin/subreddits/new" className="btn btn-primary">Add the first subreddit</Link>}>Users see nothing in the task marketplace until you add subreddits and tasks.</Empty> : (
        <div className="overflow-hidden rounded-card border border-line bg-surface"><div className="table-wrap">
          <table className="table">
            <thead><tr><th>Subreddit</th><th>Category</th><th>Age</th><th>Comment</th><th>Post</th><th>Review</th><th>Tasks</th><th>Status</th><th><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="font-semibold">r/{s.name}</td><td>{s.category_name}</td>
                  <td>{s.min_account_age_months} mo</td><td>{s.min_comment_karma}</td><td>{s.min_post_karma}</td>
                  <td>{s.requires_manual_review ? 'Manual' : 'Automatic'}</td><td>{s.task_count}</td>
                  <td>{s.active ? <span className="pill pill-ok">Active</span> : <span className="pill pill-neutral">Inactive</span>}</td>
                  <td><Link href={`/admin/subreddits/${s.id}`} className="btn btn-outline btn-sm">Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}
