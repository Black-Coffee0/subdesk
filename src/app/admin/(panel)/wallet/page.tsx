import Link from 'next/link';
import type { Metadata } from 'next';
import { ActionForm, Field, SelectField, SubmitButton, TextArea } from '@/components/forms';
import { Banner, Empty, PageTitle, Pagination, Stat, fmtDateTime, one, pageNum } from '@/components/ui';
import { isAppError } from '@/lib/errors';
import { formatINR } from '@/lib/money';
import { randomUuid } from '@/lib/security';
import { getSettings } from '@/services/settings';
import { adminGetUser, adminListUsers } from '@/services/users';
import { adminListTransactions, adminWalletTotals, getWalletSummary } from '@/services/wallet';
import { adjustWalletAction } from '@/app/actions/admin';
import { requireAdminPage } from '@/server/session';

export const metadata: Metadata = { title: 'Wallet' };

export default async function AdminWalletPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const userId = one(sp.user), find = one(sp.find), kind = one(sp.kind), page = pageNum(sp.page);
  const canAdjust = admin.permissions.includes('wallet_adjust');
  const settings = await getSettings();

  const [totals, tx] = await Promise.all([adminWalletTotals(admin.id), adminListTransactions(admin.id, { userId: userId || undefined, kind: kind || undefined, page })]);

  // Choosing a user needs the "manage users" permission; without it, link in from the Users page instead.
  let target: Awaited<ReturnType<typeof adminGetUser>> | null = null;
  let summary: Awaited<ReturnType<typeof getWalletSummary>> | null = null;
  let matches: Awaited<ReturnType<typeof adminListUsers>>['rows'] = [];
  let lookupNote = '';
  if (userId) {
    try { target = await adminGetUser(admin.id, userId); summary = await getWalletSummary(userId); }
    catch (e) { if (!isAppError(e)) throw e; lookupNote = e.message; }
  }
  if (find) {
    try { matches = (await adminListUsers(admin.id, { q: find })).rows.slice(0, 8); }
    catch (e) { if (!isAppError(e)) throw e; lookupNote = e.message; }
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Wallet and transactions">An internal ledger. No payment method is connected, and nothing here moves real money.</PageTitle>
      <div className="grid grid-cols-3 gap-4 rounded-card border border-line bg-surface p-5">
        <Stat label="Users with a balance" value={totals.users} />
        <Stat label="Total held in ledger" value={formatINR(totals.totalHeldPaise)} />
        <Stat label="Ledger entries" value={totals.entries} />
      </div>

      <section className="card" aria-labelledby="find-h">
        <h2 id="find-h" className="text-xl">{target ? `Adjust ${target.username}’s wallet` : 'Find a user to adjust'}</h2>
        {!target && (
          <form method="get" className="mt-3 flex flex-wrap gap-2" role="search">
            <label htmlFor="find" className="sr-only">Search users</label>
            <input id="find" name="find" defaultValue={find} className="input max-w-sm" placeholder="Username, email or Reddit name" />
            <button className="btn btn-primary" type="submit">Search</button>
          </form>
        )}
        {lookupNote && <div className="mt-3"><Banner tone="warn">{lookupNote}</Banner></div>}
        {!target && matches.length > 0 && (
          <ul className="divide-list mt-3 overflow-hidden rounded-lg border border-line">
            {matches.map((m) => <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5"><span><span className="font-semibold">{m.username}</span> <span className="text-sm text-muted">{m.email} · {formatINR(m.available_paise)}</span></span><Link className="btn btn-outline btn-sm" href={`/admin/wallet?user=${m.id}`}>Select</Link></li>)}
          </ul>
        )}
        {find && !matches.length && !lookupNote && !target && <p className="mt-3 text-muted">No users match.</p>}

        {target && summary && (
          <div className="mt-3">
            <p className="text-muted">Current balance <strong className="text-ink">{formatINR(summary.availablePaise)}</strong> · <Link href="/admin/wallet">Choose another user</Link></p>
            {!settings.walletAdjustmentsEnabled && <div className="mt-3"><Banner tone="warn">Wallet adjustments are switched off in Settings.</Banner></div>}
            {!canAdjust ? <div className="mt-3"><Banner tone="warn">Your administrator account does not include the wallet adjustment permission. You can view the ledger only.</Banner></div> : (
              <div className="mt-4 max-w-md">
                <ActionForm action={adjustWalletAction}>
                  <input type="hidden" name="userId" value={target.id} />
                  <input type="hidden" name="idempotencyKey" value={randomUuid()} />
                  <SelectField name="direction" label="Type" defaultValue="credit" options={[{ value: 'credit', label: 'Credit (add to balance)' }, { value: 'debit', label: 'Debit (subtract from balance)' }]} />
                  <Field name="amount" label="Amount in ₹" inputMode="decimal" required placeholder="250.00" />
                  <TextArea name="reason" label="Reason (required)" rows={2} maxLength={300} required hint="Shown to the user and stored with your name in the ledger." />
                  <SubmitButton className="btn btn-primary" pendingLabel="Recording…" confirm="Record this adjustment? It cannot be edited afterwards.">Record adjustment</SubmitButton>
                </ActionForm>
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="tx-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="tx-h" className="text-xl">{target ? `Ledger for ${target.username}` : 'All transactions'}</h2>
          <form method="get" className="flex gap-2">
            {userId && <input type="hidden" name="user" value={userId} />}
            <label htmlFor="kind" className="sr-only">Filter by type</label>
            <select id="kind" name="kind" defaultValue={kind} className="input"><option value="">All types</option><option value="task_reward">Task rewards</option><option value="admin_adjustment">Adjustments</option></select>
            <button className="btn btn-outline" type="submit">Filter</button>
          </form>
        </div>
        {tx.rows.length === 0 ? <Empty title="No transactions yet">Credits and adjustments will be listed here with who made them and when.</Empty> : (
          <>
            <div className="overflow-hidden rounded-card border border-line bg-surface"><div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>User</th><th>Type</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">Balance after</th><th>Made by</th></tr></thead>
                <tbody>
                  {tx.rows.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(t.created_at)}</td>
                      <td><Link href={`/admin/wallet?user=${t.user_id}`}>{t.username}</Link></td>
                      <td>{t.kind === 'task_reward' ? 'Task reward' : 'Adjustment'}</td>
                      <td className="min-w-56">{t.description}</td>
                      <td className={`whitespace-nowrap text-right font-semibold ${t.direction === 'credit' ? 'text-ok' : 'text-bad'}`}>{t.direction === 'credit' ? '+' : '−'}{formatINR(t.amount_paise)}</td>
                      <td className="whitespace-nowrap text-right">{formatINR(t.balance_after_paise)}</td>
                      <td>{t.created_by_name ?? 'System'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
            <Pagination page={page} total={tx.total} pageSize={tx.pageSize} path="/admin/wallet" params={{ user: userId, kind }} />
          </>
        )}
      </section>
    </div>
  );
}
