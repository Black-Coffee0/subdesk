import type { Metadata } from 'next';
import { Banner, Empty, PageTitle, Pagination, Stat, fmtDateTime, pageNum } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { getWalletSummary, listLedger } from '@/services/wallet';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Wallet' };

export default async function WalletPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const page = pageNum((await searchParams).page);
  const [w, ledger] = await Promise.all([getWalletSummary(user.id), listLedger(user.id, { page })]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle title="Wallet" />
      <Banner tone="info" title="This wallet is a record, not a bank">
        Withdrawals, deposits and payment features aren&apos;t available yet. Balances here are internal and can&apos;t be transferred as real money.
      </Banner>

      <section className="card card-lift" aria-label="Balances">
        <p className="text-sm text-muted">Available balance</p>
        <p className="font-display text-[2.8rem] font-bold leading-none">{formatINR(w.availablePaise)}</p>
        <div className="mt-6 grid grid-cols-2 gap-5 border-t border-line pt-5">
          <Stat label="Pending" value={formatINR(w.pendingRewardsPaise)} hint="Rewards on tasks you were accepted for. Not credited until the administrator completes them." />
          <Stat label="Total earned" value={formatINR(w.totalEarnedPaise)} hint="All credits posted to your ledger." />
        </div>
      </section>

      <section aria-labelledby="tx-h">
        <h2 id="tx-h" className="mb-3 text-xl">Transaction history</h2>
        {ledger.rows.length === 0 ? (
          <Empty title="No transactions yet">Credits and adjustments will appear here. Your balance starts at {formatINR(0)}.</Empty>
        ) : (
          <>
            <ul className="divide-list overflow-hidden rounded-card border border-line bg-surface">
              {ledger.rows.map((t) => (
                <li key={t.id} className="row flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{t.description}</p>
                    <p className="text-sm text-muted">{fmtDateTime(t.created_at)} · {t.kind === 'task_reward' ? 'Task reward' : 'Adjustment'} · Posted</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-display text-lg font-bold ${t.direction === 'credit' ? 'text-ok' : 'text-bad'}`}>{t.direction === 'credit' ? '+' : '−'}{formatINR(t.amount_paise)}</p>
                    <p className="text-xs text-muted">Balance {formatINR(t.balance_after_paise)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={page} total={ledger.total} pageSize={ledger.pageSize} path="/wallet" />
          </>
        )}
      </section>
    </div>
  );
}
