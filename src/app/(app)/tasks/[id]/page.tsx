import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ActionForm, SubmitButton, TextArea } from '@/components/forms';
import { CheckList } from '@/components/eligibility-ui';
import { Banner, PageTitle, StatusPill, fmtDateTime } from '@/components/ui';
import { emailVerificationRequired } from '@/lib/config';
import { isAppError } from '@/lib/errors';
import { formatINR } from '@/lib/money';
import { getSettings } from '@/services/settings';
import { getTaskForUser } from '@/services/tasks';
import { applyTaskAction, cancelApplicationAction } from '@/app/actions/user';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Task details' };
const OPEN = ['Applied', 'Under Review', 'Accepted'];

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let task;
  try {
    task = await getTaskForUser(user.id, id);
  } catch (e) {
    if (isAppError(e) && e.code === 'not_found') notFound();
    if (isAppError(e)) {
      return (
        <div className="mx-auto max-w-2xl">
          <PageTitle title="Task details" />
          <Banner tone="warn" title="You can’t view this task">{e.message}</Banner>
          <div className="mt-5"><Link href="/tasks" className="btn btn-outline">Back to tasks</Link></div>
        </div>
      );
    }
    throw e;
  }
  const settings = await getSettings();
  const open = task.applications.find((a) => OPEN.includes(a.status));
  const blockedRepeat = !task.allow_repeat && task.applications.some((a) => a.status !== 'Cancelled');
  const needsVerify = emailVerificationRequired() && !user.email_verified_at;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/tasks" className="inline-block text-sm font-semibold">← All tasks</Link>
      <div>
        <p className="font-semibold text-muted">r/{task.subreddit_name} · {task.category_name}</p>
        <h1 className="mt-1 text-[1.75rem] sm:text-[2.2rem]">{task.title}</h1>
        {task.description && <p className="mt-2 max-w-prose text-muted">{task.description}</p>}
      </div>

      {task.reward_paise !== null && (
        <section className="card">
          <p className="text-sm text-muted">Reward set by the administrator</p>
          <p className="font-display text-[1.8rem] font-bold">{formatINR(task.reward_paise)}</p>
          <p className="text-sm text-muted">Applying doesn&apos;t earn anything. A reward is added to your wallet only if the administrator marks your work completed and credits it.</p>
        </section>
      )}

      <section className="card" aria-labelledby="ins-h">
        <h2 id="ins-h" className="text-xl">Instructions</h2>
        {task.instructions ? <p className="mt-2 max-w-prose whitespace-pre-wrap">{task.instructions}</p> : <p className="mt-2 text-muted">The administrator hasn&apos;t added instructions for this task.</p>}
      </section>

      <section className="card" aria-labelledby="req-h">
        <h2 id="req-h" className="text-xl">Requirements and your result</h2>
        <div className="mt-3"><CheckList checks={task.eligibility.checks} /></div>
        {task.subreddit.extra_requirements && <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm"><span className="font-semibold">Also required: </span>{task.subreddit.extra_requirements}</p>}
        {task.subreddit.restrictions && <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-sm"><span className="font-semibold">Restrictions: </span>{task.subreddit.restrictions}</p>}
        {task.eligibility.state === 'eligible_review' && <p className="mt-3 text-sm text-warn">This subreddit needs a manual review, so your application will start as &ldquo;Under Review&rdquo;.</p>}
      </section>

      <section className="card" aria-labelledby="app-h">
        <h2 id="app-h" className="text-xl">Your application</h2>
        {task.applications.length > 0 && (
          <ul className="divide-list mt-2">
            {task.applications.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><StatusPill status={a.status} /><span className="text-sm text-muted">{fmtDateTime(a.created_at)}</span></div>
                {a.admin_note && <p className="mt-2 text-sm"><span className="font-semibold">Administrator note: </span>{a.admin_note}</p>}
                {OPEN.includes(a.status) && a.status !== 'Accepted' && (
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
        <div className="mt-4">
          {!settings.taskApplicationsOpen ? (
            <Banner tone="warn">Task applications are temporarily closed.</Banner>
          ) : needsVerify ? (
            <Banner tone="warn" title="Verify your email first">You need a verified email to apply. Request a new link from your <Link href="/dashboard">dashboard</Link>.</Banner>
          ) : open ? (
            <p className="text-muted">You have an open application for this task. It&apos;s tracked under <Link href="/tasks/mine">My tasks</Link>.</p>
          ) : blockedRepeat ? (
            <p className="text-muted">You&apos;ve already applied for this task, and it can&apos;t be applied for again.</p>
          ) : (
            <ActionForm action={applyTaskAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <TextArea name="note" label="Note for the administrator (optional)" rows={3} maxLength={500} />
              <SubmitButton className="btn btn-primary btn-lg btn-block sm:w-auto" pendingLabel="Applying…">Apply for this task</SubmitButton>
            </ActionForm>
          )}
        </div>
      </section>
    </div>
  );
}
