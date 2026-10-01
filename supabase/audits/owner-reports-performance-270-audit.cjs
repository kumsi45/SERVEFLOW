// Rollback-only hosted validation for pending Migrations 269 and 270.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(__dirname, "owner-reports-r3-audit.cjs"), "utf8");
const migration269 = fs.readFileSync(path.join(root, "supabase/migrations/269_owner_reports_inventory_cashier_details.sql"), "utf8");
const migration270 = fs.readFileSync(path.join(root, "supabase/migrations/270_owner_reports_performance.sql"), "utf8");
const helperStart = source.indexOf("async function asUser(");
const helperEnd = source.indexOf("async function preflight(");
const fixtureStart = source.indexOf("  const migration =", source.indexOf("async function hostileTests("));
const fixtureEnd = source.indexOf("    const refundFixture=", fixtureStart);
assert(helperStart > 0 && helperEnd > helperStart && fixtureEnd > fixtureStart);
const helpers = "function pass(label, detail=''){process.stdout.write(`PASS ${label}${detail ? ` - ${detail}` : ''}\\n`);}\n" + source.slice(helperStart, helperEnd);
const setup = source.slice(fixtureStart, fixtureEnd);

const checks = `
    await db.query(candidate269);
    await db.query(candidate270);
    const fixtureStarted=performance.now();
    const inventoryCategory=uuid(),storage=uuid(),unit=uuid(),item=uuid();
    await db.query("insert into public.inventory_categories(id,restaurant_id,name,created_by_staff_id) values($1,$2,'Performance Ingredients',$3)",[inventoryCategory,x.restaurant,x.ownerStaff]);
    await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,created_by_staff_id) values($1,$2,'Performance Store',$3)",[storage,x.restaurant,x.ownerStaff]);
    await db.query("insert into public.inventory_units(id,restaurant_id,name,created_by_staff_id) values($1,$2,'kg',$3)",[unit,x.restaurant,x.ownerStaff]);
    await db.query("insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,category_id,unit_id,storage_location_id,created_by_staff_id) values($1,$2,'Performance Stock','kg',10000,1,$3,$4,$5,$6)",[item,x.restaurant,inventoryCategory,unit,storage,x.ownerStaff]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[x.owner]);
    await db.query("insert into public.inventory_movements(id,restaurant_id,inventory_item_id,storage_location_id,unit_id,unit_name,movement_type,quantity,quantity_effect,reason,movement_date,created_by_staff_id) values(gen_random_uuid(),$1,$2,$3,$4,'kg','stock_in',1000,'in','Performance opening balance',now()-interval '2 days',$5)",[x.restaurant,item,storage,unit,x.ownerStaff]);
    await db.query(\`insert into public.inventory_movements(id,restaurant_id,inventory_item_id,storage_location_id,unit_id,unit_name,movement_type,quantity,quantity_effect,reason,movement_date,created_by_staff_id)
      select gen_random_uuid(),$1,$2,$3,$4,'kg',case when n%3=0 then 'waste'::public.inventory_movement_type when n%2=0 then 'stock_out'::public.inventory_movement_type else 'stock_in'::public.inventory_movement_type end,
        1,case when n%2=1 and n%3<>0 then 'in' else 'out' end,'Performance fixture',now()-(n||' seconds')::interval,$5
      from generate_series(1,130) n\`,[x.restaurant,item,storage,unit,x.ownerStaff]);
    await db.query(\`insert into public.kitchen_inventory_requests(id,restaurant_id,inventory_item_id,requested_by_staff_id,item_name,quantity,unit,urgency,status,requested_at)
      select gen_random_uuid(),$1,$2,$3,'Performance Stock',1,'kg','normal','pending',now()-(n||' seconds')::interval from generate_series(1,120) n\`,[x.restaurant,item,x.kitchenStaff]);
    await db.query('create temporary table perf_shifts(seq int primary key,id uuid not null) on commit drop');
    await db.query('insert into perf_shifts select n,gen_random_uuid() from generate_series(1,120) n');
    await db.query(\`insert into public.cashier_shifts(id,restaurant_id,opened_by,closed_by,opened_at,closed_at,opening_cash,expected_cash,actual_cash,variance)
      select id,$1,$2,$2,(date_trunc('day',now())+interval '12 hours')-(seq||' minutes')::interval,(date_trunc('day',now())+interval '12 hours')-(seq||' minutes')::interval+interval '30 seconds',100,100,100,0 from perf_shifts\`,[x.restaurant,x.cashierStaff]);
    await db.query(\`insert into public.cash_reconciliations(id,restaurant_id,shift_id,closed_by,opening_cash,cash_payments,cash_refunds,expected_cash,actual_cash,variance,closed_at)
      select gen_random_uuid(),$1,id,$2,100,0,0,100,100,0,(date_trunc('day',now())+interval '12 hours')-(seq||' minutes')::interval+interval '30 seconds' from perf_shifts\`,[x.restaurant,x.cashierStaff]);
    await db.query(\`insert into public.cashier_cash_handovers(id,restaurant_id,outgoing_shift_id,outgoing_cashier_id,incoming_cashier_id,expected_amount,declared_amount,received_amount,difference,status,initiated_at,confirmed_at)
      select gen_random_uuid(),$1,p.id,$2,$3,100,100,100,0,'confirmed',(date_trunc('day',now())+interval '12 hours')-(p.seq||' minutes')::interval,(date_trunc('day',now())+interval '12 hours')-(p.seq||' minutes')::interval+interval '10 seconds' from perf_shifts p\`,[x.restaurant,x.cashierStaff,x.secondCashierStaff]);
    console.log(JSON.stringify({kind:'fixtureSetup',milliseconds:+(performance.now()-fixtureStarted).toFixed(2),inventoryMovements:130,inventoryRequests:120,cashierShifts:120,reconciliations:120,handovers:120}));

    const call=(name,args)=>asUser(db,x.owner,\`select public.\${name}($1,$2,$3,$4) result\`,args).then(r=>r.rows[0].result);
    const measure=async(label,name,args)=>{const samples=[];let result;for(let n=0;n<21;n++){const start=performance.now();result=await call(name,args);const elapsed=performance.now()-start;if(n)samples.push(elapsed);}samples.sort((a,b)=>a-b);const median=(samples[9]+samples[10])/2;return{label,result,payloadBytes:Buffer.byteLength(JSON.stringify(result),'utf8'),timingMs:{samples:samples.length,min:+samples[0].toFixed(2),median:+median.toFixed(2),p95:+samples[18].toFixed(2),max:+samples[19].toFixed(2)}};};
    const args=[x.restaurant,'today',null,null];
    const inventoryBefore=await measure('inventory-v1','get_owner_report_inventory',args);
    const inventoryAfter=await measure('inventory-v2','get_owner_report_inventory_v2',args);
    assert.equal(inventoryBefore.result.movements.length,130);
    assert.equal(inventoryBefore.result.waste.length,43);
    assert.equal(inventoryAfter.result.movements.items.length,50);
    assert.equal(inventoryAfter.result.requests.items.length,50);
    assert.equal(inventoryAfter.result.waste.items.length,43);
    assert(inventoryAfter.result.movements.nextCursor&&inventoryAfter.result.requests.nextCursor);
    const generalIds=new Set(inventoryAfter.result.movements.items.map(row=>row.id));
    assert(inventoryAfter.result.waste.items.every(row=>!generalIds.has(row.id)));
    const movementCursor=inventoryAfter.result.movements.nextCursor;
    const movementPage=(await asUser(db,x.owner,"select public.get_owner_report_inventory_v2($1,'today',null,null,'movements',$2,$3,50) result",[x.restaurant,movementCursor.at,movementCursor.id])).rows[0].result;
    assert(movementPage.movements.items.length>0&&movementPage.movements.items.every(row=>!generalIds.has(row.id)));
    assert.equal(movementPage.summary.movementCount,130);
    console.log(JSON.stringify({kind:'measurement',area:'inventory',before:{payloadBytes:inventoryBefore.payloadBytes,movements:130,requests:120,waste:43,timingMs:inventoryBefore.timingMs},after:{payloadBytes:inventoryAfter.payloadBytes,movements:50,requests:50,waste:43,timingMs:inventoryAfter.timingMs}}));

    const cashierBefore=await measure('cashier-v1','get_owner_report_cashier_shifts',args);
    const cashierAfter=await measure('cashier-v2','get_owner_report_cashier_shifts_v2',args);
    console.log(JSON.stringify({kind:'cashierFixtureWindow',beforeShifts:cashierBefore.result.shifts.length,beforeHandovers:cashierBefore.result.handovers.length,afterShifts:cashierAfter.result.shifts.items.length,afterHandovers:cashierAfter.result.handovers.items.length,afterPeriod:cashierAfter.result.period}));
    assert(cashierBefore.result.shifts.length>=120&&cashierBefore.result.handovers.length>=120);
    assert.equal(cashierAfter.result.shifts.items.length,50);
    assert.equal(cashierAfter.result.handovers.items.length,50);
    assert(cashierAfter.result.shifts.nextCursor&&cashierAfter.result.handovers.nextCursor);
    const shiftIds=new Set(cashierAfter.result.shifts.items.map(row=>row.id));
    const shiftCursor=cashierAfter.result.shifts.nextCursor;
    const shiftPage=(await asUser(db,x.owner,"select public.get_owner_report_cashier_shifts_v2($1,'today',null,null,'shifts',$2,$3,50) result",[x.restaurant,shiftCursor.at,shiftCursor.id])).rows[0].result;
    assert(shiftPage.shifts.items.length>0&&shiftPage.shifts.items.every(row=>!shiftIds.has(row.id)));
    assert.equal(shiftPage.summary.handoverCount,cashierAfter.result.summary.handoverCount);
    console.log(JSON.stringify({kind:'measurement',area:'cashier',before:{payloadBytes:cashierBefore.payloadBytes,shifts:cashierBefore.result.shifts.length,handovers:cashierBefore.result.handovers.length,timingMs:cashierBefore.timingMs},after:{payloadBytes:cashierAfter.payloadBytes,shifts:50,handovers:50,timingMs:cashierAfter.timingMs}}));

    await rejected('Cross-tenant owner denied',()=>asUser(db,x.otherOwner,"select public.get_owner_report_inventory_v2($1,'today')",[x.restaurant]),/access is required/);
    await rejected('Manager denied',()=>asUser(db,x.manager,"select public.get_owner_report_cashier_shifts_v2($1,'today')",[x.restaurant]),/access is required/);
    await rejected('Inactive owner denied',()=>asUser(db,x.inactiveOwner,"select public.get_owner_report_inventory_v2($1,'today')",[x.restaurant]),/access is required/);
    await rejected('Anonymous denied',()=>asAnonymous(db,"select public.get_owner_report_cashier_shifts_v2($1,'today')",[x.restaurant]),/permission denied/);
    const security=(await db.query("select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid in ('public.get_owner_report_inventory_v2(uuid,text,date,date,text,timestamptz,uuid,integer)'::regprocedure,'public.get_owner_report_cashier_shifts_v2(uuid,text,date,date,text,timestamptz,uuid,integer)'::regprocedure) order by proname")).rows;
    assert.equal(security.length,2);assert(security.every(row=>row.prosecdef&&row.proconfig.includes('search_path=pg_catalog, public')&&!row.anon));
    console.log('PASS Owner-only authorization, tenant isolation, fixed search_path and anonymous denial');
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
    await db.query("set statement_timeout='120s'; set lock_timeout='5s'; set application_name='serveflow-owner-reports-performance-270'");
    const run = new (Object.getPrototypeOf(async function () {}).constructor)("db","fs","path","root","assert","crypto","uuid","performance","candidate269","candidate270","applyMigration",helpers+setup+checks);
    await run(db,fs,path,root,assert,crypto,crypto.randomUUID,performance,migration269,migration270,false);
    console.log("PASS candidate DDL and scale fixtures rolled back; no deployment");
  } finally { await db.end(); }
}

main().catch((error) => { console.error(`FAIL ${error.stack ?? error.message}`); process.exitCode = 1; });
