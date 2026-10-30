/**
 * Create the first administrator (or an additional one).
 *
 *   npm run admin:create -- --email you@example.com --username owner
 *
 * The password is read from a hidden prompt, or from the ADMIN_PASSWORD environment variable for
 * hosts without an interactive terminal. It is never stored in code or logged.
 * Public sign-up can never create an administrator; this script is the only way.
 */
import { getDb } from '../src/lib/db';
import { isAppError } from '../src/lib/errors';
import { hashPassword, newOwnershipCode } from '../src/lib/security';
import { emailField, parseInput, passwordField, usernameField } from '../src/lib/validation';
import { writeAudit } from '../src/services/audit';
import { ADMIN_PERMISSIONS } from '../src/services/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function promptHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(label);
    let buf = '';
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = arg('email') ?? process.env.ADMIN_EMAIL;
  const username = arg('username') ?? process.env.ADMIN_USERNAME;
  if (!email || !username) {
    console.error('Usage: npm run admin:create -- --email you@example.com --username owner');
    process.exit(1);
  }
  let password = process.env.ADMIN_PASSWORD ?? '';
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error('No terminal available. Set ADMIN_PASSWORD for this one command, for example:\n  ADMIN_PASSWORD="..." npm run admin:create -- --email ... --username ...');
      process.exit(1);
    }
    password = await promptHidden('Password (min 10 characters, hidden): ');
    const again = await promptHidden('Repeat password: ');
    if (password !== again) { console.error('Passwords did not match.'); process.exit(1); }
  }

  let clean: { email: string; username: string; password: string };
  try {
    clean = { email: parseInput(emailField, email), username: parseInput(usernameField, username), password: parseInput(passwordField, password) };
  } catch (e) {
    if (isAppError(e)) { console.error(Object.values(e.fieldErrors ?? { _: e.message }).join('\n')); process.exit(1); }
    throw e;
  }
  if (clean.password.toLowerCase().includes(clean.username.toLowerCase())) { console.error('The password should not contain the username.'); process.exit(1); }

  const db = await getDb();
  const dup = await db.query('select 1 from users where lower(email) = $1 or lower(username) = $2', [clean.email, clean.username.toLowerCase()]);
  if (dup.rowCount) { console.error('A user with that email or username already exists.'); process.exit(1); }

  const hash = await hashPassword(clean.password);
  const id = await db.tx(async (t) => {
    const r = await t.query<{ id: string }>(
      `insert into users (email, username, password_hash, role, permissions, email_verified_at, verification_code)
       values ($1, $2, $3, 'admin', $4, now(), $5) returning id`,
      [clean.email, clean.username, hash, [...ADMIN_PERMISSIONS], newOwnershipCode()],
    );
    await t.query('insert into wallets (user_id) values ($1)', [r.rows[0].id]);
    await writeAudit(t, { actorId: null, action: 'admin.created', targetType: 'user', targetId: r.rows[0].id, details: { via: 'cli', email: clean.email } });
    return r.rows[0].id;
  });
  console.log(`\nAdministrator created: ${clean.username} <${clean.email}> (${id})\nSign in at /admin/login`);
  await db.close();
}

main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
