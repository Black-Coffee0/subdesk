import { describe, it, expect, beforeAll } from 'vitest';
import { resetDbForTests, query, tx } from '@/lib/db';

describe('database layer', () => {
  beforeAll(async () => { await resetDbForTests(); });

  it('migrates and returns numbers for bigint', async () => {
    const r = await query<{ n: number }>('select count(*)::bigint as n from platform_settings');
    expect(typeof r.rows[0].n).toBe('number');
    expect(r.rows[0].n).toBeGreaterThan(5);
  });

  it('accepts text[] params and jsonb', async () => {
    const r = await query('insert into users (email, username, verification_code, permissions) values ($1,$2,$3,$4) returning permissions', ['a@b.co', 'abc', 'x', ['wallet_adjust', 'manage_tasks']]);
    expect(r.rows[0].permissions).toEqual(['wallet_adjust', 'manage_tasks']);
    const j = await query("select $1::jsonb as j", [JSON.stringify({ a: 1 })]);
    expect(j.rows[0].j).toEqual({ a: 1 });
  });

  it('ledger trigger maintains balance and is append-only', async () => {
    const u = (await query<{ id: string }>("select id from users where username='abc'")).rows[0].id;
    await query("insert into wallet_ledger (user_id, direction, amount_paise, kind, description) values ($1,'credit',5000,'admin_adjustment','test credit')", [u]);
    const w = (await query<{ available_paise: number }>('select available_paise from wallets where user_id=$1', [u])).rows[0];
    expect(w.available_paise).toBe(5000);
    await expect(query("insert into wallet_ledger (user_id, direction, amount_paise, kind, description) values ($1,'debit',9000,'admin_adjustment','too much')", [u])).rejects.toThrow(/insufficient_balance/);
    await expect(query('update wallets set available_paise = 999999 where user_id=$1', [u])).rejects.toThrow(/only change through wallet_ledger/);
    await expect(query('update wallet_ledger set amount_paise = 1')).rejects.toThrow(/append-only/);
    await expect(query('delete from audit_logs')).resolves.toBeTruthy(); // no rows yet -> row trigger not fired
    await query("insert into audit_logs (action) values ('x')");
    await expect(query('delete from audit_logs')).rejects.toThrow(/append-only/);
    await expect(query('truncate wallet_ledger')).rejects.toThrow(/append-only/);
  });

  it('tx rolls back on error', async () => {
    await expect(tx(async (t) => {
      await t.query("insert into task_categories (name) values ('RollbackMe')");
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const r = await query("select 1 from task_categories where name='RollbackMe'");
    expect(r.rowCount).toBe(0);
  });
});
