import type { Metadata } from 'next';
import Link from 'next/link';
import { SubredditForm } from '@/components/admin-forms';
import { PageTitle } from '@/components/ui';
import { getBaseThresholds } from '@/services/eligibility';
import { listCategories } from '@/services/tasks';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Add subreddit' };

export default async function NewSubreddit() {
  await requireAdminPage('manage_tasks');
  const [categories, base] = await Promise.all([listCategories(), getBaseThresholds()]);
  return (
    <div className="max-w-2xl">
      <Link href="/admin/subreddits" className="text-sm font-semibold">← Subreddits</Link>
      <div className="mt-2"><PageTitle title="Add subreddit" /></div>
      <div className="card"><SubredditForm categories={categories} platform={{ age: base.minAccountAgeMonths, comment: base.minCommentKarma, post: base.minPostKarma }} /></div>
    </div>
  );
}
