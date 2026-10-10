// Disposable Docker PostgreSQL only. Never accepts a caller-supplied URL.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const db = new Client({ connectionString:
  'postgresql://postgres:p321isolated@127.0.0.1:54397/postgres',
  connectionTimeoutMillis: 10000 });
const dir = path.join(__dirname, '..', 'migrations');

async function run() {
  await db.connect();
  try {
    const state = await db.query("select to_regclass('public.restaurants') as restaurants");
    const resume = process.argv[2] === '--resume-015';
    if (Boolean(state.rows[0].restaurants) !== resume) {
      throw new Error('Unexpected disposable database replay state.');
    }
    const files = fs.readdirSync(dir).filter((name) => /^\d{3}_.+\.sql$/.test(name))
      .sort().filter((name) => Number(name.slice(0, 3)) <= 274 &&
        (!resume || Number(name.slice(0, 3)) >= 15));
    for (const file of files) {
      await db.query('begin');
      try {
        let sql = fs.readFileSync(path.join(dir, file), 'utf8');
        if (file.startsWith('015_')) {
          // The base image has no legacy rls_auto_enable helper. This isolated
          // compatibility shim removes only the orphan REVOKE from replay.
          const orphan = 'revoke all on function public.rls_auto_enable() from public;';
          if (!sql.includes(orphan)) throw new Error('Expected legacy REVOKE absent.');
          sql = sql.replace(orphan, '');
          console.log('ISOLATED SHIM 015 orphan rls_auto_enable REVOKE omitted');
        }
        await db.query(sql);
        await db.query('commit');
        console.log(`APPLIED ${file}`);
      } catch (error) {
        await db.query('rollback');
        throw new Error(`${file}: ${error.code ?? 'UNKNOWN'} ${error.message}`, { cause: error });
      }
    }
  } finally { await db.end(); }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
