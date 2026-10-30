import Link from 'next/link';
import type { Metadata } from 'next';
import { Banner, PageTitle, fmtDateTime, one } from '@/components/ui';
import { getAdminOverview } from '@/services/dashboard';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Overview' };

export default async function AdminOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const o = await getAdminOverview(admin.id);
  const tiles: { label: string; value: number; href?: string; tone?: 'warn' }[] = [
    { label: 'Pending applications', value: o.pendingApplications, href: '/admin/applications?status=Pending+Admin+Review', tone: o.pendingApplications ? 'warn' : undefined },
    { label: 'Need manual verification', value: o.manualVerification, href: '/admin/applications?state=manual_review_required', tone: o.manualVerification ? 'warn' : undefined },
    { label: 'Total registered users', value: o.totalUsers, href: '/admin/users' },
    { label: 'Approved users', value: o.approvedUsers, href: '/admin/applications?status=Approved' },
    { label: 'Rejected applications', value: o.rejectedApplications, href: '/admin/applications?status=Rejected' },
    { label: 'Active tasks', value: o.activeTasks, href: '/admin/tasks' },
    { label: 'Active subreddits', value: o.activeSubreddits, href: '/admin/subreddits' },
    { label: 'Open task applications', value: o.openTaskApplications, href: '/admin/task-applications', tone: o.openTaskApplications ? 'warn' : undefined },
  ];
  return (
    <div className="space-y-6">
      <PageTitle title="Overview">Signed in as {admin.username}.</PageTitle>
      {one(sp.denied) && <Banner tone="warn" title="Permission needed">Your administrator account does not include the “{one(sp.denied)}” permission.</Banner>}
      {o.stuckVerification > 0 && <Banner tone="warn" title={`${o.stuckVerification} application${o.stuckVerification === 1 ? '' : 's'} stuck in “Pending Verification”`}>The automatic Reddit check did not finish. Open them from the <Link href="/admin/applications?status=Pending+Verification">queue</Link> and run the check again, or enter the values manually.</Banner>}
      {o.deletionRequests > 0 && <Banner tone="info" title={`${o.deletionRequests} account deletion request${o.deletionRequests === 1 ? '' : 's'}`}><Link href="/admin/users?filter=deletion">Review them</Link></Banner>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const body = (
            <>
              <p className="text-sm text-muted">{t.label}</p>
              <p className={`font-display text-[2rem] font-bold leading-tight ${t.tone === 'warn' ? 'text-warn' : ''}`}>{t.value}</p>
            </>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="rounded-card border border-line bg-surface p-4 text-ink no-underline hover:border-line-strong hover:text-ink">{body}</Link>
          ) : (
            <div key={t.label} className="rounded-card border border-line bg-surface p-4">{body}</div>
          );
        })}
      </div>

      <section aria-labelledby="recent-h">
        <div className="mb-3 flex items-center justify-between"><h2 id="recent-h" className="text-xl">Recent activity</h2><Link href="/admin/audit" className="text-sm font-semibold">Full audit log</Link></div>
        {o.recent.length === 0 ? <p className="text-muted">Nothing recorded yet.</p> : (
          <ul className="divide-list overflow-hidden rounded-card border border-line bg-surface">
            {o.recent.map((r) => (
              <li key={r.id} className="row flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="min-w-0"><span className="font-semibold">{r.actor_label.replace(/ <.*>$/, '')}</span> <span className="text-muted">· {r.action}</span></p>
                <p className="text-sm text-muted">{fmtDateTime(r.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
