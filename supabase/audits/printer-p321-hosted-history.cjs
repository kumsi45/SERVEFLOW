// Read-only migration-history check. No tenant tables or fixture writes.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const line = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((item) => /^\s*SUPABASE_DB_URL\s*=/.test(item));
if (!line) throw new Error('SUPABASE_DB_URL unavailable');
const connectionString = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');
const db = new Client({ connectionString, ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000, query_timeout: 15000 });
async function run() {
  await db.connect();
  try {
    await db.query('begin read only');
    const rows = (await db.query(`select version from supabase_migrations.schema_migrations
      where version in ('271','272','273','274') order by version`)).rows;
    console.log(`HOSTED_HISTORY ${rows.map((row) => row.version).join(',')}`);
    console.log(`MIGRATION_274_DEPLOYED ${rows.some((row) => row.version === '274')}`);
    await db.query('rollback');
  } finally { await db.end(); }
}
run().catch((error) => { console.error(`HOSTED_HISTORY_UNAVAILABLE ${error.code ?? ''}`);
  process.exitCode = 1; });
