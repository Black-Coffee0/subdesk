import type { Metadata } from 'next';
import Link from 'next/link';
import { TaskForm } from '@/components/admin-forms';
import { Banner, PageTitle } from '@/components/ui';
import { adminListSubreddits, listCategories } from '@/services/tasks';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Add task' };

export default async function NewTask() {
  const admin = await requireAdminPage('manage_tasks');
  const [categories, subs] = await Promise.all([listCategories(), adminListSubreddits(admin.id)]);
  return (
    <div className="max-w-2xl">
      <Link href="/admin/tasks" className="text-sm font-semibold">← Tasks</Link>
      <div className="mt-2"><PageTitle title="Add task" /></div>
      {subs.length === 0 ? <Banner tone="warn" title="Add a subreddit first">Tasks belong to a subreddit. <Link href="/admin/subreddits/new">Add one</Link>.</Banner> : <div className="card"><TaskForm categories={categories} subreddits={subs} /></div>}
    </div>
  );
}
