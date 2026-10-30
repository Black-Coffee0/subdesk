import Link from 'next/link';
import type { Metadata } from 'next';
import { Empty, PageTitle, Pagination, RedditLink, StatusPill, VerificationPill, fmtDate, fmtNum, one, pageNum } from '@/components/ui';
import { accountAgeMonths } from '@/lib/eligibility';
import { adminListApplications } from '@/services/submissions';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Applications' };
const STATUSES = ['Pending Verification', 'Pending Admin Review', 'Needs More Information', 'Approved', 'Rejected', 'Suspended'];

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage('review_applications');
  const sp = await searchParams;
  const status = one(sp.status), state = one(sp.state), q = one(sp.q), page = pageNum(sp.page);
  const r = await adminListApplications(admin.id, { status, state, q, page });
  const age = (d: Date | null) => (d ? `${accountAgeMonths(new Date(d))} mo` : '—');
  return (
    <div className="space-y-5">
      <PageTitle title="Applications">Review queue. Pending applications are listed first.</PageTitle>
      <form method="get" className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_1fr_auto]" role="search">
        <div><label htmlFor="q" className="sr-only">Search</label><input id="q" name="q" defaultValue={q} className="input" placeholder="Search username, email, Reddit name" /></div>
        <div><label htmlFor="status" className="sr-only">Status</label>
          <select id="status" name="status" defaultValue={status} className="input"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label htmlFor="state" className="sr-only">Verification</label>
          <select id="state" name="state" defaultValue={state} className="input"><option value="">Any verification</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="manual_review_required">Manual Review Required</option></select></div>
        <div className="flex gap-2"><button className="btn btn-primary" type="submit">Filter</button>{(q || status || state) && <Link className="btn btn-quiet" href="/admin/applications">Clear</Link>}</div>
      </form>

      {r.rows.length === 0 ? <Empty title="No applications match">Nothing here yet.</Empty> : (
        <>
          {/* phones: stacked cards */}
          <ul className="space-y-3 md:hidden">
            {r.rows.map((a) => (
              <li key={a.id} className="rounded-card border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2"><p className="font-semibold">{a.platform_username}{a.is_test_data && <span className="pill pill-neutral ml-2">Test data</span>}</p><StatusPill status={a.status} /></div>
                <p className="text-sm text-muted">{a.email}</p>
                <p className="mt-2"><RedditLink url={a.profile_url}>u/{a.reddit_username}</RedditLink></p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm"><VerificationPill state={a.verification_state} /><span className="text-muted">{age(a.account_created_at)} · {fmtNum(a.comment_karma)} comment · {fmtNum(a.post_karma)} post</span></div>
                <div className="mt-3 flex items-center justify-between"><span className="text-sm text-muted">{fmtDate(a.submitted_at)}{a.attempts > 1 ? ` · attempt ${a.attempts}` : ''}</span><Link href={`/admin/applications/${a.id}`} className="btn btn-primary btn-sm">Review</Link></div>
              </li>
            ))}
          </ul>
          {/* larger screens: table */}
          <div className="hidden overflow-hidden rounded-card border border-line bg-surface md:block">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>User</th><th>Reddit account</th><th>Status</th><th>Verification</th><th>Age</th><th>Comment</th><th>Post</th><th>Submitted</th><th><span className="sr-only">Review</span></th></tr></thead>
                <tbody>
                  {r.rows.map((a) => (
                    <tr key={a.id}>
                      <td><p className="font-semibold">{a.platform_username}</p><p className="text-sm text-muted">{a.email}</p>{a.is_test_data && <span className="pill pill-neutral">Test data</span>}</td>
                      <td><RedditLink url={a.profile_url}>u/{a.reddit_username}</RedditLink>{a.attempts > 1 && <p className="text-xs text-muted">attempt {a.attempts}</p>}</td>
                      <td><StatusPill status={a.status} /></td>
                      <td><VerificationPill state={a.verification_state} /></td>
                      <td>{age(a.account_created_at)}</td><td>{fmtNum(a.comment_karma)}</td><td>{fmtNum(a.post_karma)}</td>
                      <td className="whitespace-nowrap">{fmtDate(a.submitted_at)}</td>
                      <td><Link href={`/admin/applications/${a.id}`} className="btn btn-primary btn-sm">Review</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={page} total={r.total} pageSize={r.pageSize} path="/admin/applications" params={{ q, status, state }} />
        </>
      )}
    </div>
  );
}
