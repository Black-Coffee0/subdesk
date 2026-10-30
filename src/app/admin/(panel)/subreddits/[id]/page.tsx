import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SubredditForm } from '@/components/admin-forms';
import { PageTitle } from '@/components/ui';
import { isAppError } from '@/lib/errors';
import { getBaseThresholds } from '@/services/eligibility';
import { adminGetSubreddit, listCategories } from '@/services/tasks';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Edit subreddit' };

export default async function EditSubreddit({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage('manage_tasks');
  const { id } = await params;
  const [sub, categories, base] = await Promise.all([
    adminGetSubreddit(admin.id, id).catch((e) => { if (isAppError(e) && e.code === 'not_found') return null; throw e; }),
    listCategories(), getBaseThresholds(),
  ]);
  if (!sub) notFound();
  return (
    <div className="max-w-2xl">
      <Link href="/admin/subreddits" className="text-sm font-semibold">← Subreddits</Link>
      <div className="mt-2"><PageTitle title={`Edit r/${sub.name}`} /></div>
      <div className="card"><SubredditForm categories={categories} initial={sub} platform={{ age: base.minAccountAgeMonths, comment: base.minCommentKarma, post: base.minPostKarma }} /></div>
    </div>
  );
}
