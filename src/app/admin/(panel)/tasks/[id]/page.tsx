import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaskForm } from '@/components/admin-forms';
import { PageTitle } from '@/components/ui';
import { isAppError } from '@/lib/errors';
import { adminGetTask, adminListSubreddits, listCategories } from '@/services/tasks';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Edit task' };

export default async function EditTask({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage('manage_tasks');
  const { id } = await params;
  const [task, categories, subs] = await Promise.all([
    adminGetTask(admin.id, id).catch((e) => { if (isAppError(e) && e.code === 'not_found') return null; throw e; }),
    listCategories(), adminListSubreddits(admin.id),
  ]);
  if (!task) notFound();
  return (
    <div className="max-w-2xl">
      <Link href="/admin/tasks" className="text-sm font-semibold">← Tasks</Link>
      <div className="mt-2"><PageTitle title="Edit task" /></div>
      <div className="card"><TaskForm categories={categories} subreddits={subs} initial={task} /></div>
    </div>
  );
}
