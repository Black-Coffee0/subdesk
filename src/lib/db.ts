import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Database access.
 *
 * - If DATABASE_URL is set → node-postgres pool (any Postgres, incl. Supabase).
 * - Otherwise → embedded Postgres (PGlite): persisted in ./.data/pglite for local dev,
 *   in-memory when PGLITE_MEMORY=1 (used by the automated tests).
 *
 * Both drivers expose the same tiny interface so services never care which one is active.
 * bigint (int8) values are parsed to JS numbers (safe far beyond any realistic balance).
 */

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Run a multi-statement SQL script and record it in schema_migrations, atomically. */
  applyScript(name: string, sql: string): Promise<void>;
  kind: 'pg' | 'pglite';
  close(): Promise<void>;
}

const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

function listMigrations(): { name: string; sql: string }[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }));
}

const SCHEMA_MIGRATIONS_SQL = `create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`;

async function createPgDb(url: string): Promise<Db> {
  const pg = await import('pg');
  const Pool = pg.default?.Pool ?? pg.Pool;
  const types = pg.default?.types ?? pg.types;
  types.setTypeParser(20, (v: string) => Number(v));
  const ssl =
    process.env.DATABASE_SSL === 'false' || /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10), ssl });

  const wrap = (c: { query: (sql: string, params?: unknown[]) => Promise<any> }): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
  });

  return {
    kind: 'pg',
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (e) {
        try {
          await client.query('rollback');
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        client.release();
      }
    },
    async applyScript(name, sql) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [name]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPgliteDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const memory = process.env.PGLITE_MEMORY === '1';
  let dir: string | undefined;
  if (!memory) {
    dir = path.join(process.cwd(), '.data', 'pglite');
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new PGlite(dir, { parsers: { 20: (v: string) => Number(v) } });
  await db.waitReady;

  const wrap = (c: { query: (sql: string, params?: unknown[]) => Promise<any> }): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      // PGlite reports affectedRows = 0 for SELECT; node-postgres reports the row count. Match pg.
      return { rows: r.rows, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) };
    },
  });

  // PGlite is single-connection: serialise transactions so concurrent requests queue up.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  return {
    kind: 'pglite',
    query: (sql, params) => serial(() => wrap(db).query(sql, params)),
    tx: (fn) => serial(() => db.transaction(async (t) => fn(wrap(t)))),
    applyScript: (name, sql) =>
      serial(() =>
        db.transaction(async (t) => {
          await t.exec(sql);
          await t.query('insert into schema_migrations (name) values ($1)', [name]);
        }),
      ),
    async close() {
      await db.close();
    },
  };
}

export async function runMigrations(db: Db, log: (m: string) => void = () => {}): Promise<string[]> {
  await db.query(SCHEMA_MIGRATIONS_SQL);
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const m of listMigrations()) {
    if (done.has(m.name)) continue;
    log(`applying ${m.name}`);
    await db.applyScript(m.name, m.sql);
    applied.push(m.name);
  }
  return applied;
}

declare global {
  // eslint-disable-next-line no-var
  var __subdeskDb: Promise<Db> | undefined;
}

/**
 * Which connection string to use. Under tests, DATABASE_URL is ignored on purpose so that running
 * the test suite can never touch a real database; a real server is used only when TEST_DATABASE_URL
 * is set explicitly (see resetDbForTests for the extra safety check).
 */
function configuredUrl(): string | undefined {
  if (process.env.NODE_ENV === 'test') return process.env.TEST_DATABASE_URL?.trim() || undefined;
  return process.env.DATABASE_URL?.trim() || undefined;
}

async function connect(): Promise<Db> {
  const url = configuredUrl();
  if (url) return createPgDb(url);
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_EMBEDDED_DB !== 'true') {
    throw new Error(
      'DATABASE_URL is not set. Production needs a real PostgreSQL database (e.g. Supabase). ' +
        'Set ALLOW_EMBEDDED_DB=true only for a single long-lived server with a persistent disk.',
    );
  }
  return createPgliteDb();
}

/** Returns the shared database handle (created once per process, survives hot reload). */
export function getDb(): Promise<Db> {
  if (!globalThis.__subdeskDb) {
    globalThis.__subdeskDb = connect().then(async (db) => {
      // Embedded DB: keep dev/test zero-setup by migrating automatically.
      // Real Postgres: run `npm run db:migrate` (or set AUTO_MIGRATE=true).
      if (db.kind === 'pglite' || process.env.AUTO_MIGRATE === 'true') {
        await runMigrations(db);
      }
      return db;
    });
    globalThis.__subdeskDb.catch(() => {
      globalThis.__subdeskDb = undefined;
    });
  }
  return globalThis.__subdeskDb;
}

/** Test helper: throw away the current database and start a fresh one. */
export async function resetDbForTests(): Promise<Db> {
  if (process.env.NODE_ENV !== 'test') throw new Error('resetDbForTests is test-only');
  if (globalThis.__subdeskDb) {
    const old = await globalThis.__subdeskDb.catch(() => undefined);
    await old?.close().catch(() => undefined);
    globalThis.__subdeskDb = undefined;
  }
  const db = await getDb();
  if (db.kind === 'pg') {
    // Real server: start from an empty schema. Refuse unless the database is clearly a test database,
    // because this drops everything in it.
    const name = decodeURIComponent(new URL(configuredUrl()!).pathname.replace(/^\//, ''));
    if (!/test/i.test(name)) {
      throw new Error(`Refusing to reset database "${name}": TEST_DATABASE_URL must point at a database whose name contains "test".`);
    }
    await db.query('drop schema public cascade');
    await db.query('create schema public');
    await runMigrations(db);
  }
  return db;
}

export async function query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
  return (await getDb()).query<T>(sql, params);
}

export async function tx<T>(fn: (t: Queryable) => Promise<T>): Promise<T> {
  return (await getDb()).tx(fn);
}
