import Link from 'next/link';
import type { Metadata } from 'next';
import { Banner, Empty, PageTitle, Pagination, StatusPill, fmtDate, one, pageNum } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { adminListUsers } from '@/services/users';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Users' };
const FILTERS = [['', 'All users'], ['unverified', 'Email not verified'], ['blocked', 'Blocked'], ['deletion', 'Deletion requested'], ['admins', 'Administrators']];

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage('manage_users');
  const sp = await searchParams;
  const q = one(sp.q), filter = one(sp.filter), page = pageNum(sp.page);
  const r = await adminListUsers(admin.id, { q, filter, page });
  return (
    <div className="space-y-5">
      <PageTitle title="Users" />
      {one(sp.deleted) && <Banner tone="ok">Account deleted. Wallet and audit records were kept without identifying details.</Banner>}
      <form method="get" className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1.5fr_1fr_auto]" role="search">
        <div><label htmlFor="q" className="sr-only">Search</label><input id="q" name="q" defaultValue={q} className="input" placeholder="Search username, email or Reddit name" /></div>
        <div><label htmlFor="filter" className="sr-only">Filter</label><select id="filter" name="filter" defaultValue={filter} className="input">{FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="flex gap-2"><button className="btn btn-primary" type="submit">Search</button>{(q || filter) && <Link href="/admin/users" className="btn btn-quiet">Clear</Link>}</div>
      </form>
      {r.rows.length === 0 ? <Empty title="No users match" /> : (
        <>
          <div className="overflow-hidden rounded-card border border-line bg-surface"><div className="table-wrap">
            <table className="table">
              <thead><tr><th>User</th><th>Reddit</th><th>Application</th><th>Wallet</th><th>Joined</th><th>Account</th></tr></thead>
              <tbody>
                {r.rows.map((u) => (
                  <tr key={u.id}>
                    <td className="min-w-52"><Link href={`/admin/users/${u.id}`} className="font-semibold">{u.username}</Link>{u.role === 'admin' && <span className="pill pill-info ml-2">Admin</span>}{u.is_test_data && <span className="pill pill-neutral ml-2">Test</span>}<p className="text-sm text-muted">{u.email}{!u.email_verified_at && ' · not verified'}</p></td>
                    <td>{u.reddit_username ? `u/${u.reddit_username}` : '—'}</td>
                    <td>{u.application_status ? <StatusPill status={u.application_status} /> : <StatusPill status="Not Submitted" />}</td>
                    <td>{formatINR(u.available_paise)}</td>
                    <td className="whitespace-nowrap">{fmtDate(u.created_at)}</td>
                    <td>{u.deletion_requested_at ? <span className="pill pill-warn">Deletion requested</span> : <StatusPill status={u.status === 'active' ? 'active' : 'blocked'} label={u.status === 'active' ? 'Active' : 'Blocked'} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
          <Pagination page={page} total={r.total} pageSize={r.pageSize} path="/admin/users" params={{ q, filter }} />
        </>
      )}
    </div>
  );
}
