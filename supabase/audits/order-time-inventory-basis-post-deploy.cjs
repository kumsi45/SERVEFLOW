// Scoped deployed-263 proof. Creation/deduction use canonical role-checked RPCs.
// Committed fixtures are removed by exact IDs with FK-enforced cascade cleanup.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { prologue, cases, migration } = require('./order-time-inventory-basis-server-batch.cjs');
const line = fs.readFileSync('supabase/connection.env', 'utf8').split(/\r?\n/).find(v => v.startsWith('SUPABASE_DB_URL='));
const connectionString = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
function client() { return new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000, keepAlive: true }); }
const historySQL = `select (select count(*)::int from public.order_items) items,
 (select count(*)::int from public.inventory_movements) movements,
 (select md5(coalesce(string_agg(to_jsonb(m)::text,'|' order by id),'')) from public.inventory_movements m) movement_hash,
 (select md5(coalesce(string_agg(to_jsonb(d)::text,'|' order by order_item_id),'')) from public.inventory_order_item_deductions d) receipt_hash`;
async function main() {
 const db=client(); await db.connect(); let f; let baseline; const results=[];
 const check=(label,ok)=>{assert.ok(ok,label);results.push(label);console.log('PASS',label);};
 try {
  check('remote head 263',(await db.query('select max(version) head from supabase_migrations.schema_migrations')).rows[0].head==='263');
  baseline=(await db.query(historySQL)).rows[0];
  check('pre-fixture historical history unchanged',baseline.items===522&&baseline.movements===63&&baseline.movement_hash==='fa0f1b606c7225bf1b5dcd1d231138c5'&&baseline.receipt_hash==='d41d8cd98f00b204e9800998ecf8427e');
  check('522 explicit legacy review rows, no guessed plan',(await db.query(`select count(*)::int n from public.order_item_inventory_basis where tracking_mode='legacy_review' and snapshot_version=0 and captured_at is null and deduction_plan='[]'::jsonb`)).rows[0].n===522);
  const surface=(await db.query(`select p.proname,p.prosrc,p.prosecdef,p.proconfig,pg_get_function_identity_arguments(p.oid) signature
   from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
   ('build_order_time_inventory_plan','capture_order_item_inventory_basis','reject_inventory_basis_mutation','protect_order_item_inventory_identity',
    'build_inventory_deduction_plan','prepare_split_inventory_basis','split_waiter_bill_quantities','deduct_inventory_for_order_item','inventory_food_consumption_audit_row','inventory_movement_validate_row')`)).rows;
  for(const p of surface){
   const expression=new RegExp('create\\s+or\\s+replace\\s+function\\s+public\\.'+p.proname+'\\s*\\([\\s\\S]*?\\bas\\s+(\\$[a-z_0-9]*\\$)([\\s\\S]*?)\\1','i');
   const match=migration.match(expression);check('deployed body '+p.proname,Boolean(match)&&match[2].trim()===p.prosrc.trim());
  }
  check('ten intended functions, no stale overload',surface.length===10&&new Set(surface.map(p=>p.proname)).size===10);
  check('all function search paths pinned',surface.every(p=>p.proconfig?.includes('search_path=public')));
  check('definer and invoker attributes correct',surface.every(p=>p.prosecdef===!['reject_inventory_basis_mutation','protect_order_item_inventory_identity','inventory_food_consumption_audit_row','inventory_movement_validate_row'].includes(p.proname)));
  check('four enabled basis triggers',(await db.query(`select count(*)::int n from pg_trigger where not tgisinternal and tgname in
   ('order_items_capture_inventory_basis','inventory_basis_immutable','inventory_basis_lines_immutable','order_items_protect_inventory_identity') and tgenabled='O'`)).rows[0].n===4);
  const started=Date.now();
  await db.query('begin; set local statement_timeout=45000; '+prologue);
  f=(await db.query('select f from pg_temp.basis_audit_context')).rows[0].f;
  await db.query('commit');console.log('FIXTURE setup ms',Date.now()-started);
  // These newly created fixtures are post-263, not historical legacy markers.
  const deployedCases=cases.slice(0,cases.indexOf("  perform pg_temp.basis_check('legacy is explicit review'"))+
   cases.slice(cases.indexOf("  perform pg_temp.basis_check('existing receipt retry'"));
  const caseStarted=Date.now();
  const batches=await db.query('begin; set local statement_timeout=45000; '+deployedCases+' commit;');
  for(const row of (Array.isArray(batches)?batches:[batches]).flatMap(v=>v.rows).filter(v=>v.label))check('deployed '+row.label,true);
  console.log('COMMITTED deployed case batch ms',Date.now()-caseStarted);
  // QR Direct and No Tracking, in addition to Recipe covered by the cases.
  for(const [mode,table] of [['direct',20],['no_tracking',21]]){
   await db.query('begin');
   await db.query('select pg_temp.basis_mode($1,null,$2)',[f,mode==='direct'?f.item_a:null]);
   const t=Date.now();const order=(await db.query("select pg_temp.basis_order($1,'QR',$2,1) payload",[f,table])).rows[0].payload;
   console.log('QR '+mode+' creation ms',Date.now()-t);
   const basis=(await db.query('select tracking_mode,(select count(*)::int from public.order_item_inventory_basis_lines l where l.order_item_id=b.order_item_id) lines from public.order_item_inventory_basis b where order_item_id=$1',[order.item])).rows[0];
   check('QR '+mode+' captures exact server mode and line count',basis.tracking_mode===mode&&basis.lines===(mode==='direct'?1:0));await db.query('commit');
  }
  await db.query('begin');await db.query('select pg_temp.basis_mode($1,$2,null)',[f,f.recipe]);
  const order=(await db.query("select pg_temp.basis_order($1,'Cashier',22,2) payload",[f])).rows[0].payload;
  await db.query('select pg_temp.basis_complete($1,$2)',[f,order]);await db.query('commit');
  const plan=(await db.query('select public.build_inventory_deduction_plan($1) plan',[order.item])).rows[0].plan;
  const before=(await db.query('select pg_temp.basis_stock($1,$2) qty',[f,f.item_a])).rows[0].qty;
  const a=client(),b=client(); await a.connect();await b.connect();
  try{
   for(const c of [a,b]){
    await c.query('begin; set local statement_timeout=15000; set local lock_timeout=10000');
    await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",[f.owner]);
    await c.query('set local role authenticated');
   }
   // A is inside the canonical deduction and holds item+stock locks until COMMIT.
   const first=(await a.query('select public.deduct_inventory_for_order_item($1) result',[order.item])).rows[0].result;
   const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
   const t=Date.now();const pending=b.query('select public.deduct_inventory_for_order_item($1) result',[order.item]);
   let blocked=false;
   for(let i=0;i<30&&!blocked;i++){
    blocked=(await db.query('select cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked;
    if(!blocked)await new Promise(resolve=>setTimeout(resolve,100));
   }
   await a.query('commit');const second=(await pending).rows[0].result;await b.query('commit');
   check('two independent sessions genuinely overlap on canonical lock',blocked);
   check('one committed deduction wins; waiting caller returns already_deducted',first.deducted===true&&second.status==='already_deducted');
   console.log('RACE deduction and lock-observation ms',Date.now()-t);
  }finally{for(const c of [a,b]){await c.query('rollback').catch(()=>{});await c.end();}}
  const counts=(await db.query('select (select count(*)::int from public.inventory_order_item_deductions where order_item_id=$1) receipts,(select count(*)::int from public.inventory_movements where order_item_id=$1) movements',[order.item])).rows[0];
  check('race leaves one receipt and exactly K unique movements',counts.receipts===1&&counts.movements===plan.length);
  const after=(await db.query('select pg_temp.basis_stock($1,$2) qty',[f,f.item_a])).rows[0].qty;
  check('race consumes stock exactly once',Number(before)-Number(after)===Number(plan.find(v=>v.inventory_item_id===f.item_a).required_quantity));
 }finally{
  await db.query('rollback').catch(()=>{});
  if(f){
   const tenants=[f.restaurant,f.other],users=['owner','waiter','cashier','manager','kitchen','outsider'].map(k=>f[k]);
   const approved=(await db.query("select count(*)::int n from public.restaurants where id=any($1::uuid[]) and (slug=$2 or slug=$3)",[tenants,f.slug,'basis-other-'+f.other])).rows[0].n;
   assert.equal(approved,2,'exact fixture cleanup roots confirmed');
   await cleanupFixtures(db,tenants,users);
   const residue=(await db.query('select (select count(*)::int from public.restaurants where id=any($1::uuid[])) tenants,(select count(*)::int from auth.users where id=any($2::uuid[])) users',[tenants,users])).rows[0];
   check('exact committed fixture roots removed',residue.tenants===0&&residue.users===0);
   const remaining=(await db.query(`select sum(n)::int n from (
    select count(*) n from public.order_items where restaurant_id=any($1::uuid[]) union all select count(*) from public.order_item_inventory_basis where restaurant_id=any($1::uuid[])
    union all select count(*) from public.order_item_inventory_basis_lines where restaurant_id=any($1::uuid[]) union all select count(*) from public.inventory_movements where restaurant_id=any($1::uuid[])
    union all select count(*) from public.inventory_order_item_deductions where restaurant_id=any($1::uuid[])) t`,[tenants])).rows[0].n;
   check('zero fixture item, basis, line, movement or receipt residue',remaining===0);
  }
  if(baseline)check('live item count and immutable movement/receipt history restored',JSON.stringify((await db.query(historySQL)).rows[0])===JSON.stringify(baseline));
  await db.end();
 }
 console.log('RESULT',results.length,'deployed checks PASS; committed fixtures cleaned');
}
async function cleanupFixtures(db,tenants,users){
 const triggers=[['order_item_inventory_basis_lines','inventory_basis_lines_immutable'],['order_item_inventory_basis','inventory_basis_immutable'],
  ['inventory_movements','inventory_movements_block_delete'],['inventory_units','inventory_units_prevent_delete_in_use'],
  ['order_items','reconcile_order_status_from_item_change']];
 try{
  await db.query("begin; set local lock_timeout='5s'; set local statement_timeout='15s'; lock table public.order_item_inventory_basis_lines,public.order_item_inventory_basis,public.inventory_movements,public.inventory_units,public.order_items in access exclusive mode");
  // Transactional DDL is hidden from other sessions by exclusive table locks.
  // Foreign-key triggers remain enabled. Restore every user guard before COMMIT.
  for(const [table,trigger] of triggers)await db.query(`alter table public.${table} disable trigger ${trigger}`);
  for(const table of ['order_item_inventory_basis_lines','order_item_inventory_basis','inventory_movements','inventory_order_item_deductions'])
   await db.query(`delete from public.${table} where restaurant_id=any($1::uuid[])`,[tenants]);
  await db.query('delete from public.restaurants where id=any($1::uuid[])',[tenants]);
  await db.query('delete from auth.users where id=any($1::uuid[])',[users]);
  await db.query('set constraints all immediate');
  for(const [table,trigger] of triggers)await db.query(`alter table public.${table} enable trigger ${trigger}`);
  await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
}
async function recoverCleanup(){
 const db=client();await db.connect();try{
  const tenants=(await db.query("select id,slug from public.restaurants where slug like 'basis-validation-%' or slug like 'basis-other-%'")).rows;
  assert.equal(tenants.length,2);assert.ok(tenants.every(t=>t.slug==='basis-validation-'+t.id||t.slug==='basis-other-'+t.id));
  const users=(await db.query('select user_id from public.restaurant_staff where restaurant_id=any($1::uuid[])',[tenants.map(t=>t.id)])).rows.map(t=>t.user_id);
  assert.equal(users.length,6);await cleanupFixtures(db,tenants.map(t=>t.id),users);
  console.log('RECOVERY cleanup committed; guards restored');console.log(JSON.stringify((await db.query(historySQL)).rows[0]));
 }finally{await db.end();}
}
(process.argv.includes('--cleanup-existing')?recoverCleanup():main()).catch(error=>{console.error('FAIL',error.message);if(error.where)console.error(error.where.split('\n').filter(v=>v.startsWith('PL/pgSQL function')).join('\n'));process.exitCode=1;});
