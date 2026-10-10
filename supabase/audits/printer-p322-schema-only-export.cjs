// Read-only production public-schema export to a private temp directory.
// No table data, Auth identities, or tenant rows are exported.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const line = fs.readFileSync(path.join(__dirname, '..', 'connection.env'), 'utf8')
  .split(/\r?\n/).find((item) => /^\s*SUPABASE_DB_URL\s*=/.test(item));
if (!line) throw new Error('SUPABASE_DB_URL unavailable');
const raw = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '')
  .trim().replace(/^['"]|['"]$/g, '');
const url = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database scheme');
const out = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\user\\AppData\\Local',
  'Temp', 'serveflow-p322-schema-only');
if (!path.isAbsolute(out)) throw new Error('Private schema archive path is not absolute');
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const dump = path.join(out, 'public-schema.dump');
const env = { ...process.env,
  PGHOST: url.hostname, PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  PGSSLMODE: 'require',
  PGOPTIONS: '-c default_transaction_read_only=on',
};
const image = 'public.ecr.aws/supabase/postgres:17.6.1.141';
const args = ['run','--rm','--network','host','-v',`${out}:/out`,
  ...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGOPTIONS']
    .flatMap((name)=>['-e',name]),image,
  'pg_dump','--schema-only','--schema=public','--format=custom','--no-owner',
  '--no-comments','--lock-wait-timeout=5000','--file=/out/public-schema.dump'];
const result=spawnSync('docker',args,{env,encoding:'utf8',timeout:120000});
if (result.status!==0) {
  console.error(`SCHEMA_EXPORT_FAILED ${result.status} ${String(result.stderr).slice(-500)}`);
  process.exitCode=1;
} else {
  const list=spawnSync('docker',['run','--rm','-v',`${out}:/out`,image,
    'pg_restore','--list','/out/public-schema.dump'],{encoding:'utf8',timeout:30000});
  if (list.status!==0) throw new Error('Archive listing failed');
  const entries=list.stdout.split(/\r?\n/).filter((item)=>/^\d+;/.test(item));
  if(entries.some((item)=>/; .* TABLE DATA /.test(item)))
    throw new Error('Schema-only archive unexpectedly contains table data');
  console.log(`SCHEMA_EXPORT_OK objects=${entries.length} bytes=${fs.statSync(dump).size} table_data=0`);
  console.log('SCHEMA_EXPORT_PATH '+dump);
}
