import Link from 'next/link';
import type { Metadata } from 'next';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Banner, Empty, PageTitle, StatusPill, fmtDateTime, one } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { listUserApplications } from '@/services/tasks';
import { cancelApplicationAction } from '@/app/actions/user';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'My tasks' };

export default async function MyTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const apps = await listUserApplications(user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle title="My tasks" actions={<Link href="/tasks" className="btn btn-primary btn-sm">Browse tasks</Link>}>Every task you&apos;ve applied for and where it stands.</PageTitle>
      {one(sp.applied) && <Banner tone="ok" title="Application submitted">The administrator will review it. You&apos;ll be notified when its status changes.</Banner>}
      {apps.length === 0 ? (
        <Empty title="You haven't applied for any tasks yet" action={<Link href="/tasks" className="btn btn-primary">See available tasks</Link>}>Applications you submit appear here.</Empty>
      ) : (
        <ul className="divide-list overflow-hidden rounded-card border border-line bg-surface">
          {apps.map((a) => (
            <li key={a.id} className="row">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/tasks/${a.task_id}`} className="font-semibold text-ink no-underline hover:underline">{a.task_title}</Link>
                  <p className="text-sm text-muted">r/{a.subreddit_name} · {a.category_name} · applied {fmtDateTime(a.created_at)}</p>
                </div>
                <StatusPill status={a.status} />
              </div>
              {a.user_note && <p className="mt-2 text-sm"><span className="font-semibold">Your note: </span>{a.user_note}</p>}
              {a.admin_note && <p className="mt-1 text-sm"><span className="font-semibold">Administrator: </span>{a.admin_note}</p>}
              {a.reward_credited_paise ? <p className="mt-1 text-sm text-ok">Reward credited: {formatINR(a.reward_credited_paise)}</p> : a.status === 'Accepted' && a.reward_paise ? <p className="mt-1 text-sm text-muted">Reward if completed: {formatINR(a.reward_paise)}</p> : null}
              {(a.status === 'Applied' || a.status === 'Under Review') && (
                <div className="mt-3">
                  <ActionForm action={cancelApplicationAction} className="">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <SubmitButton className="btn btn-danger-outline btn-sm" pendingLabel="Cancelling…" confirm="Cancel this application?">Cancel application</SubmitButton>
                  </ActionForm>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
