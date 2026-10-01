// Rollback-only scale measurement for the immutable Migration 268 contract.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(__dirname, "owner-reports-r3-audit.cjs"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/268_owner_menu_sales_report.sql"), "utf8");
const helperStart = source.indexOf("async function asUser(");
const helperEnd = source.indexOf("async function preflight(");
const fixtureStart = source.indexOf("  const migration =", source.indexOf("async function hostileTests("));
const fixtureEnd = source.indexOf("    const refundFixture=", fixtureStart);
assert(helperStart > 0 && helperEnd > helperStart && fixtureEnd > fixtureStart);
const helpers = source.slice(helperStart, helperEnd);
const setup = source.slice(fixtureStart, fixtureEnd);

const checks = `
    await db.query(candidate);
    await db.query('create temporary table perf_menu_items(seq int primary key,id uuid not null) on commit drop');
    await db.query("insert into perf_menu_items select n,gen_random_uuid() from generate_series(1,500) n");
    await db.query('grant select on perf_menu_items to authenticated');
    const addRange=async(from,to)=>{
      await asUser(db,x.owner,\`insert into public.menu_items(id,restaurant_id,category_id,kitchen_station_id,name,price,available,created_at)
        select p.id,$1,$2,$3,'Scale item '||lpad(p.seq::text,3,'0'),10+(p.seq%25),true,now()-interval '30 days'
        from perf_menu_items p where p.seq between $4 and $5\`,[x.restaurant,x.category,x.station,from,to]);
      await db.query(\`insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_station_id,kitchen_status)
        select gen_random_uuid(),$1,$2,$3,p.id,1+(p.seq%3),10+(p.seq%25),$4,'held'
        from perf_menu_items p where p.seq between $5 and $6\`,[x.restaurant,x.order,x.invoiceB,x.station,from,to]);
    };
    const measure=async(label,period='today',start=null,end=null)=>{
      const report=(await asUser(db,x.owner,'select public.get_owner_menu_sales_report($1,$2,$3,$4) result',[x.restaurant,period,start,end])).rows[0].result;
      const timings=[];
      for(let run=0;run<3;run++){
        const explained=(await asUser(db,x.owner,'explain (analyze,buffers,format json) select public.get_owner_menu_sales_report($1,$2,$3,$4)',[x.restaurant,period,start,end])).rows[0]['QUERY PLAN'][0];
        timings.push(explained['Execution Time']);
      }
      timings.sort((a,b)=>a-b);
      console.log(JSON.stringify({label,executionMs:{min:timings[0],median:timings[1],max:timings[2]},payloadBytes:Buffer.byteLength(JSON.stringify(report),'utf8'),soldRows:report.soldItems.length,noSalesRows:report.noSalesItems.length,totalValue:report.totalItemLineSalesValue}));
    };
    await addRange(1,100);
    await measure('100-menu-items-100-lines-today');
    await addRange(101,500);
    await measure('500-menu-items-500-lines-today');
    await measure('500-menu-items-500-lines-week','week');
    await measure('500-menu-items-500-lines-month','month');
    const start=new Date(Date.now()-180*86400000).toISOString().slice(0,10),end=new Date().toISOString().slice(0,10);
    await measure('500-menu-items-500-lines-custom-181-days','custom',start,end);
  } finally { await db.query('rollback'); }
`;

async function main() {
  const env = fs.readFileSync(path.join(root, "supabase/connection.env"), "utf8");
  const line = env.split(/\r?\n/).find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  assert(line, "SUPABASE_DB_URL is required");
  const url = line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
  db.on("error", (error) => console.error(`DATABASE ${error.message}`));
  await db.connect();
  try {
    await db.query("set statement_timeout='120s'; set lock_timeout='5s'; set application_name='serveflow-owner-menu-performance-scale'");
    const run = new (Object.getPrototypeOf(async function () {}).constructor)("db", "fs", "path", "root", "assert", "crypto", "uuid", "candidate", "applyMigration", helpers + setup + checks);
    await run(db, fs, path, root, assert, crypto, crypto.randomUUID, migration, false);
    console.log("PASS rollback-only menu scale fixtures left no residue");
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(`FAIL ${error.stack ?? error.message}`); process.exitCode = 1; });
