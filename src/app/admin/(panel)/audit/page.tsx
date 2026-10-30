import Link from 'next/link';
import type { Metadata } from 'next';
import { Empty, PageTitle, Pagination, fmtDateTime, one, pageNum } from '@/components/ui';
import { listAudit } from '@/services/audit';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Audit log' };
const GROUPS = [['', 'Everything'], ['submission', 'Applications'], ['task_application', 'Task applications'], ['wallet', 'Wallet'], ['settings', 'Settings'], ['subreddit', 'Subreddits'], ['user', 'Users'], ['auth', 'Admin sign-ins']];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const action = one(sp.action), page = pageNum(sp.page);
  const r = await listAudit(admin.id, { action: action || undefined, page });
  return (
    <div className="space-y-5">
      <PageTitle title="Audit log">A permanent record of sensitive actions: who did what, and when. Entries can&apos;t be edited or deleted.</PageTitle>
      <form method="get" className="flex flex-wrap gap-3 rounded-card border border-line bg-surface p-4">
        <label htmlFor="action" className="sr-only">Show</label>
        <select id="action" name="action" defaultValue={action} className="input max-w-64">{GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button className="btn btn-primary" type="submit">Filter</button>
        {action && <Link href="/admin/audit" className="btn btn-quiet">Clear</Link>}
      </form>
      {r.rows.length === 0 ? <Empty title="Nothing recorded for this filter" /> : (
        <>
          <div className="overflow-hidden rounded-card border border-line bg-surface"><div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
              <tbody>
                {r.rows.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(a.created_at)}</td>
                    <td className="min-w-40">{a.actor_label}{a.ip && <p className="text-xs text-muted">{a.ip}</p>}</td>
                    <td className="font-medium">{a.action}</td>
                    <td className="text-sm text-muted">{a.target_type ?? '—'}{a.target_id ? <span className="block break-all">{a.target_id.slice(0, 13)}{a.target_id.length > 13 ? '…' : ''}</span> : null}</td>
                    <td className="min-w-48">{Object.keys(a.details ?? {}).length ? <details><summary className="cursor-pointer text-sm font-semibold text-accent">View</summary><pre className="mt-1 max-h-48 max-w-md overflow-auto rounded bg-paper p-2 text-xs">{JSON.stringify(a.details, null, 2)}</pre></details> : <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
          <Pagination page={page} total={r.total} pageSize={r.pageSize} path="/admin/audit" params={{ action }} />
        </>
      )}
    </div>
  );
}
