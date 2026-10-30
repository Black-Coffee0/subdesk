import { getDb, runMigrations } from '../src/lib/db';

async function main() {
  const db = await getDb();
  const applied = await runMigrations(db, (m) => console.log(m));
  console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
  await db.close();
}

main().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
