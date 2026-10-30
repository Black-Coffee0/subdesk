/**
 * OPTIONAL development data. Never run this against a live site.
 *
 * Creates clearly labelled TEST data in the embedded dev database so you can click through the
 * admin and user screens: a test administrator (random password, printed once), test subreddits
 * and tasks whose names start with "Test", and test users whose Reddit values are marked as
 * test_fixture, never as verified Reddit data.
 */
import { getDb } from '../src/lib/db';
import { hashPassword, newOwnershipCode } from '../src/lib/security';
import { ADMIN_PERMISSIONS } from '../src/services/types';
import crypto from 'node:crypto';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed test data in production.');
  if (process.env.DATABASE_URL && process.env.SEED_ALLOW_REMOTE !== 'yes') {
    throw new Error('DATABASE_URL is set. This script is only for the embedded development database. (Set SEED_ALLOW_REMOTE=yes to override.)');
  }
  const db = await getDb();
  if ((await db.query(`select 1 from users where is_test_data`)).rowCount) { console.log('Test data already exists. Nothing to do.'); await db.close(); return; }

  const adminPassword = crypto.randomBytes(12).toString('base64url');
  const userPassword = crypto.randomBytes(12).toString('base64url');
  const day = 86400_000;
  await db.tx(async (t) => {
    const mk = async (email: string, username: string, password: string, role: 'admin' | 'user') =>
      (await t.query<{ id: string }>(
        `insert into users (email, username, password_hash, role, permissions, email_verified_at, verification_code, is_test_data)
         values ($1,$2,$3,$4,$5,now(),$6,true) returning id`,
        [email, username, await hashPassword(password), role, role === 'admin' ? [...ADMIN_PERMISSIONS] : [], newOwnershipCode()],
      )).rows[0].id;
    const admin = await mk('test-admin@example.test', 'test_admin', adminPassword, 'admin');
    const approved = await mk('test-approved@example.test', 'test_approved', userPassword, 'user');
    const pending = await mk('test-pending@example.test', 'test_pending', userPassword, 'user');
    for (const u of [admin, approved, pending]) await t.query('insert into wallets (user_id) values ($1)', [u]);

    const cat = (await t.query<{ id: string }>('select id from task_categories order by created_at limit 1')).rows[0].id;
    const sub = async (name: string, age: number, comment: number, post: number, manual = false) =>
      (await t.query<{ id: string }>(
        `insert into subreddits (name, category_id, description, active, min_account_age_months, min_comment_karma, min_post_karma, requires_manual_review)
         values ($1,$2,'TEST DATA: not a real subreddit configuration.',true,$3,$4,$5,$6) returning id`, [name, cat, age, comment, post, manual],
      )).rows[0].id;
    const a = await sub('TestSubA', 3, 100, 100);
    const b = await sub('TestSubB', 6, 500, 300);
    const c = await sub('TestSubC', 12, 2000, 1000, true);
    for (const [s, title] of [[a, 'Test task A'], [b, 'Test task B'], [c, 'Test task C']] as const) {
      await t.query(`insert into tasks (subreddit_id, category_id, title, description, instructions, active) values ($1,$2,$3,'TEST DATA','These are test instructions.',true)`, [s, cat, title]);
    }

    const submit = async (user: string, reddit: string, status: string, state: string) => {
      const s = (await t.query<{ id: string }>(
        `insert into reddit_submissions (user_id, profile_url, reddit_username, status, verification_state, ownership_state, values_source,
                                          account_created_at, comment_karma, post_karma, verified_at, decided_at, decided_by)
         values ($1,$2,$3,$4,$5,'not_checked','test_fixture',$6,$7,$8,now(),$9,$10) returning id`,
        [user, `https://www.reddit.com/user/${reddit}/`, reddit, status, state, new Date(Date.now() - 400 * day), 650, 240, status === 'Approved' ? new Date() : null, status === 'Approved' ? admin : null],
      )).rows[0].id;
      await t.query(
        `insert into verification_records (submission_id, method, outcome, detail, reddit_username, account_created_at, comment_karma, post_karma, evidence)
         values ($1,'test_fixture','verified','TEST DATA: values were seeded, not retrieved from Reddit.',$2,$3,650,240,'{"source":"test_fixture"}')`,
        [s, reddit, new Date(Date.now() - 400 * day)],
      );
    };
    await submit(approved, 'test_approved_acct', 'Approved', 'verified');
    await submit(pending, 'test_pending_acct', 'Pending Admin Review', 'verified');
  });
  console.log(`Test data created (all marked as test data).

  Administrator   test-admin@example.test    password: ${adminPassword}
  Approved user   test-approved@example.test password: ${userPassword}
  Pending user    test-pending@example.test  password: ${userPassword}

These credentials exist only in your local development database.`);
  await db.close();
}

main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
