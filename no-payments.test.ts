import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { query, resetDbForTests } from '@/lib/db';

/**
 * The wallet is an internal ledger only. These tests make it hard to add a payment rail by accident:
 * no payment-related columns, no ledger kinds other than the two internal ones, no payment provider
 * named anywhere in the code, and no payment SDK among the dependencies.
 *
 * Sentences that tell users withdrawals/deposits are NOT available are fine and are not scanned for.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

const PAYMENT_TOKENS = new Set([
  'upi', 'vpa', 'ifsc', 'bank', 'card', 'payout', 'payment', 'gateway', 'withdraw', 'withdrawal', 'deposit',
  'crypto', 'bitcoin', 'ethereum', 'razorpay', 'stripe', 'paypal', 'paytm', 'phonepe', 'iban',
]);
const PROVIDER_NAMES = /\b(upi|vpa|ifsc|razorpay|stripe|paypal|paytm|phonepe|cashfree|braintree|bitcoin|ethereum|usdt)\b/i;
const PAYMENT_SDK = /stripe|razorpay|paypal|braintree|paytm|phonepe|cashfree|payu|web3|ethers|bitcoinjs/i;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|sql)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no payment methods anywhere', () => {
  beforeAll(async () => { await resetDbForTests(); });

  it('the database has no payment-related tables or columns', async () => {
    const r = await query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    expect(r.rows.length).toBeGreaterThan(50); // make sure the query really saw the schema
    const names = new Set<string>();
    for (const c of r.rows) { names.add(c.table_name); names.add(c.column_name); }
    const offenders = [...names].filter((n) => n.toLowerCase().split('_').some((t) => PAYMENT_TOKENS.has(t)));
    expect(offenders).toEqual([]);
  });

  it('ledger entries can only be internal reward or adjustment entries', async () => {
    const defs = await query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'wallet_ledger'::regclass and contype = 'c'`,
    );
    const all = defs.rows.map((d) => d.def).join('\n');
    expect(all).toContain('task_reward');
    expect(all).toContain('admin_adjustment');
    expect(all).not.toMatch(/withdraw|deposit|payout|payment|transfer|refund/i);
  });

  it('no payment provider or payment method is named in the source or the schema', () => {
    const roots = ['src', 'scripts', 'migrations'].map((d) => path.join(ROOT, d));
    const hits: string[] = [];
    for (const f of roots.flatMap((d) => sourceFiles(d))) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => { if (PROVIDER_NAMES.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`); });
    }
    expect(hits).toEqual([]);
  });

  it('no payment or crypto SDK is installed', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => PAYMENT_SDK.test(d))).toEqual([]);
  });
});
