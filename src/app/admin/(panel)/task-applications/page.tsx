import Link from 'next/link';
import type { Metadata } from 'next';
import { ActionForm, CheckField, SubmitButton, TextArea } from '@/components/forms';
import { Empty, PageTitle, Pagination, StatusPill, fmtDate, fmtDateTime, fmtNum, one, pageNum } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { adminListTaskApplications } from '@/services/tasks';
import type { TaskAppStatus } from '@/services/types';
import { decideTaskApplicationAction } from '@/app/actions/admin';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Task applicants' };

const NEXT: Record<TaskAppStatus, { to: TaskAppStatus; label: string; cls: string }[]> = {
  Applied: [{ to: 'Under Review', label: 'Mark under review', cls: 'btn-outline' }, { to: 'Accepted', label: 'Accept', cls: 'btn-primary' }, { to: 'Rejected', label: 'Reject', cls: 'btn-danger-outline' }, { to: 'Cancelled', label: 'Cancel', cls: 'btn-quiet' }],
  'Under Review': [{ to: 'Accepted', label: 'Accept', cls: 'btn-primary' }, { to: 'Rejected', label: 'Reject', cls: 'btn-danger-outline' }, { to: 'Cancelled', label: 'Cancel', cls: 'btn-quiet' }],
  Accepted: [{ to: 'Completed', label: 'Mark completed', cls: 'btn-primary' }, { to: 'Rejected', label: 'Reject', cls: 'btn-danger-outline' }, { to: 'Cancelled', label: 'Cancel', cls: 'btn-quiet' }],
  Rejected: [], Completed: [], Cancelled: [],
};
const STATUSES: TaskAppStatus[] = ['Applied', 'Under Review', 'Accepted', 'Completed', 'Rejected', 'Cancelled'];

export default async function TaskApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage('manage_tasks');
  const sp = await searchParams;
  const status = one(sp.status), taskId = one(sp.task), page = pageNum(sp.page);
  const r = await adminListTaskApplications(admin.id, { status, taskId, page });
  const canPay = admin.permissions.includes('wallet_adjust');
  return (
    <div className="space-y-5">
      <PageTitle title="Task applicants">Review applications for tasks. Rewards are only credited when you mark a task completed and choose to credit it.</PageTitle>
      <form method="get" className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4">
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={status} className="input max-w-56"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        {taskId && <input type="hidden" name="task" value={taskId} />}
        <button className="btn btn-primary" type="submit">Filter</button>
        {(status || taskId) && <Link href="/admin/task-applications" className="btn btn-quiet">Clear</Link>}
        {taskId && <span className="text-sm text-muted">Showing one task only.</span>}
      </form>

      {r.rows.length === 0 ? <Empty title="No task applications">Nothing matches.</Empty> : (
        <>
          <ul className="space-y-3">
            {r.rows.map((a) => {
              const snap = a.eligibility_snapshot?.values as { account_created_at?: string; comment_karma?: number; post_karma?: number } | undefined;
              const next = NEXT[a.status];
              return (
                <li key={a.id} className="rounded-card border border-line bg-surface p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{a.task_title} <span className="font-normal text-muted">· r/{a.subreddit_name}</span></p>
                      <p className="text-sm text-muted"><Link href={`/admin/users/${a.user_id}`}>{a.username}</Link>{a.reddit_username ? ` · u/${a.reddit_username}` : ''} · applied {fmtDateTime(a.created_at)}</p>
                    </div>
                    <StatusPill status={a.status} />
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    {snap ? `At application: created ${fmtDate(snap.account_created_at)}, ${fmtNum(snap.comment_karma)} comment, ${fmtNum(snap.post_karma)} post karma.` : 'No eligibility snapshot.'}
                    {a.reward_paise ? ` Configured reward: ${formatINR(a.reward_paise)}${a.reward_credited_paise ? ` (credited ${formatINR(a.reward_credited_paise)})` : ''}.` : ''}
                  </p>
                  {a.user_note && <p className="mt-2 text-sm"><span className="font-semibold">User note: </span>{a.user_note}</p>}
                  {a.admin_note && <p className="mt-1 text-sm"><span className="font-semibold">Your note: </span>{a.admin_note}</p>}
                  {/* The form stays mounted even after the application reaches a final status, so the
                      confirmation message ("reward was credited") is still shown once the controls are gone. */}
                  <ActionForm action={decideTaskApplicationAction} className="mt-3 max-w-lg space-y-3">
                    <input type="hidden" name="applicationId" value={a.id} />
                    {next.length > 0 && (
                      <details>
                        <summary className="btn btn-outline btn-sm cursor-pointer">Update status</summary>
                        <div className="mt-3 space-y-4">
                          <TextArea name="note" label="Note to the user" rows={2} maxLength={500} hint="Required when rejecting." />
                          {a.status === 'Accepted' && a.reward_paise ? (canPay
                            ? <CheckField name="creditReward" label={`When marking completed, credit ${formatINR(a.reward_paise)} to the user’s wallet`} />
                            : <p className="text-sm text-muted">Crediting the reward needs the wallet permission.</p>) : null}
                          <div className="flex flex-wrap gap-2">
                            {next.map((n) => <SubmitButton key={n.to} className={`btn btn-sm ${n.cls}`} name="intent" value={n.to} pendingLabel="Working…" confirm={n.to === 'Rejected' || n.to === 'Cancelled' ? `${n.label} this application?` : undefined}>{n.label}</SubmitButton>)}
                          </div>
                        </div>
                      </details>
                    )}
                  </ActionForm>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} total={r.total} pageSize={r.pageSize} path="/admin/task-applications" params={{ status, task: taskId }} />
        </>
      )}
    </div>
  );
}
