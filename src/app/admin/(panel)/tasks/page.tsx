import Link from 'next/link';
import type { Metadata } from 'next';
import { Banner, Empty, PageTitle, one } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { adminListTasks } from '@/services/tasks';
import { setTaskActiveAction } from '@/app/actions/admin';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Tasks' };

export default async function AdminTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage('manage_tasks');
  const rows = await adminListTasks(admin.id);
  const sp = await searchParams;
  return (
    <div className="space-y-5">
      <PageTitle title="Tasks" actions={<Link href="/admin/tasks/new" className="btn btn-primary">Add task</Link>}>Users only see tasks in subreddits they qualify for. Nothing is listed until you add it.</PageTitle>
      {one(sp.saved) && <Banner tone="ok">Task saved.</Banner>}
      {rows.length === 0 ? <Empty title="No tasks yet" action={<Link href="/admin/tasks/new" className="btn btn-primary">Add the first task</Link>}>Add a subreddit first if you haven&apos;t, then create a task for it.</Empty> : (
        <div className="overflow-hidden rounded-card border border-line bg-surface"><div className="table-wrap">
          <table className="table">
            <thead><tr><th>Task</th><th>Subreddit</th><th>Category</th><th>Reward</th><th>Open applications</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="min-w-48 font-semibold">{t.title}</td><td>r/{t.subreddit_name}</td><td>{t.category_name}</td>
                  <td>{t.reward_paise === null ? '—' : formatINR(t.reward_paise)}</td>
                  <td>{t.open_applications > 0 ? <Link href={`/admin/task-applications?task=${t.id}`}>{t.open_applications}</Link> : 0}</td>
                  <td>{t.active ? <span className="pill pill-ok">Active</span> : <span className="pill pill-neutral">Inactive</span>}</td>
                  <td>
                    <div className="flex gap-2">
                      <Link href={`/admin/tasks/${t.id}`} className="btn btn-outline btn-sm">Edit</Link>
                      <form action={setTaskActiveAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="active" value={String(!t.active)} /><button type="submit" className="btn btn-quiet btn-sm">{t.active ? 'Deactivate' : 'Activate'}</button></form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}
