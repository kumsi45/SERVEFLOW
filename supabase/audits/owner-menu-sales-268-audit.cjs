// Rollback-only candidate verification. Reuses the immutable R3 canonical fixture
// setup (including waiter/cashier cancellation), without invoking its main/deploy.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(__dirname, 'owner-reports-r3-audit.cjs'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/268_owner_menu_sales_report.sql'), 'utf8');
const original = fs.readFileSync(path.join(root, 'supabase/migrations/267_owner_reports_v1_authoritative_read_model.sql'));
assert.equal(crypto.createHash('sha256').update(original).digest('hex'), '974b6dedf3dbd3e05133d01563f4c29b920fe5484bbb5e12993e40c4c8076dbe');
const helperStart = source.indexOf('async function asUser(');
const helperEnd = source.indexOf('async function preflight(');
const fixtureStart = source.indexOf('  const migration =', source.indexOf('async function hostileTests('));
const fixtureEnd = source.indexOf('    const refundFixture=', fixtureStart);
assert(helperStart > 0 && helperEnd > helperStart && fixtureEnd > fixtureStart);
const helpers = source.slice(helperStart, helperEnd);
const setup = source.slice(fixtureStart, fixtureEnd);
const pass = (label) => console.log(`PASS ${label}`);
const checks = `
    await db.query(candidate);
    const call = (user=x.owner, restaurant=x.restaurant, period='today', start=null, end=null) => asUser(db,user,
      'select public.get_owner_menu_sales_report($1,$2,$3,$4) result',[restaurant,period,start,end]).then(r=>r.rows[0].result);
    const baseline = await call();
    assert.equal(baseline.soldItems.find(r=>r.name==='Cake Renamed').quantity,1);
    assert.equal(baseline.soldItems.find(r=>r.name==='Cake Renamed').itemLineSalesValue,200);
    assert.equal(baseline.totalItemLineSalesValue,750);
    assert.equal(baseline.legacyUnattributedItemCount,1);
    assert(baseline.noSalesItems.some(r=>r.name==='Recently Added Zero'));
    pass('R3 invoice batches, canonical cancellation, value, legacy and active zero semantics');
    for(let n=0;n<14;n++) {
      const menu=uuid();
      await db.query('insert into public.menu_items(id,restaurant_id,category_id,kitchen_station_id,name,price,available) values($1,$2,$3,$4,$5,10,true)',[menu,x.restaurant,x.category,x.station,'Extra '+n]);
      await db.query("insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_station_id,kitchen_status) values($1,$2,$3,$4,$5,$6,10,$7,'held')",[uuid(),x.restaurant,x.order,x.invoiceB,menu,n+2,x.station]);
    }
    const result=await call();
    assert.equal(result.soldItems.length,18);
    result.soldItems.forEach((r,i)=>{assert.equal(r.rank,i+1); if(i) assert(result.soldItems[i-1].quantity>=r.quantity); assert.equal(r.salesSharePercent,Math.round(r.itemLineSalesValue/result.totalItemLineSalesValue*10000)/100);});
    assert.equal(result.soldItems.reduce((s,r)=>s+r.itemLineSalesValue,0),result.totalItemLineSalesValue);
    assert(!('unitPrice' in result.soldItems[0]));
    pass('All 18 items, deterministic ranks, full-population denominator and no inferred unit price');
    await db.query("insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_station_id,kitchen_status) values($1,$2,$3,$4,$5,2,150,$6,'held')",[uuid(),x.restaurant,x.order,x.invoiceB,x.coffee,x.station]);
    const mixed=(await call()).soldItems.find(r=>r.menuItemKey===x.coffee);
    assert.equal(mixed.quantity,3); assert.equal(mixed.itemLineSalesValue,400); assert(!('unitPrice' in mixed));
    pass('Different stored prices aggregate without inventing a single unit price');
    await db.query('update public.menu_items set archived_at=now(),available=false where id=$1',[x.coffee]);
    assert((await call()).soldItems.find(r=>r.menuItemKey===x.coffee).archived);
    assert(!(await call()).noSalesItems.some(r=>r.menuItemKey===x.coffee));
    pass('Archived sold history retained');
    const empty=await call(x.owner,x.restaurant,'custom','2000-01-01','2000-01-01');
    assert.equal(empty.totalItemLineSalesValue,0); assert.equal(empty.soldItems.length,0);
    assert.equal(empty.period.currentStart,'1999-12-31T21:00:00+00:00');
    pass('Custom half-open Nairobi period and empty denominator');
    const freeInvoice=uuid();
    await db.query("insert into public.order_invoices(id,restaurant_id,order_id,invoice_number,status,payment_status,total_price,grand_total,subtotal,vat_rate,vat_amount,service_charge_rate,service_charge_amount,discount_amount,payment_method,paid_at,verified_at,verified_by,cashier_shift_id,financial_snapshot_version,invoice_source,created_by_staff_id) select $1,restaurant_id,order_id,99,status,payment_status,0,0,0,0,0,0,0,0,payment_method,'2001-01-01 09:00:00+00','2001-01-01 09:00:00+00',verified_by,cashier_shift_id,financial_snapshot_version,invoice_source,created_by_staff_id from public.order_invoices where id=$2",[freeInvoice,x.invoiceA]);
    await db.query("insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_station_id,kitchen_status) values($1,$2,$3,$4,$5,2,0,$6,'held')",[uuid(),x.restaurant,x.order,freeInvoice,x.zeroItem,x.station]);
    const free=await call(x.owner,x.restaurant,'custom','2001-01-01','2001-01-01');
    assert.equal(free.soldItems.length,1); assert.equal(free.soldItems[0].quantity,2); assert.equal(free.soldItems[0].salesSharePercent,null); assert.equal(free.totalItemLineSalesValue,0);
    pass('Sold zero-price units remain sold; zero-denominator share is null');
    for(const period of ['today','yesterday','week','month']) {
      const detail=await call(x.owner,x.restaurant,period);
      const expected=(await asUser(db,x.owner,'select public.get_owner_reports_read_model($1,$2) result',[x.restaurant,period])).rows[0].result;
      assert.equal(detail.period.currentStart,expected.period.currentStart);
      assert.equal(detail.period.timezone,expected.period.timezone);
      assert.deepEqual(detail.soldItems.slice(0,10).map(r=>[r.menuItemKey,r.quantity,r.itemLineSalesValue]),expected.menu.topSelling.map(r=>[r.menuItemKey,r.quantity,r.itemLineSalesValue]));
    }
    pass('All preset boundaries and ranking/value parity with R3');
    await db.query("update public.restaurants set profile=jsonb_build_object('timezone','America/New_York') where id=$1",[x.restaurant]);
    const dst=await call(x.owner,x.restaurant,'custom','2026-03-08','2026-03-08');
    assert.equal(Date.parse(dst.period.currentEnd)-Date.parse(dst.period.currentStart),23*3600000);
    pass('DST custom day follows authoritative 23-hour period');
    await db.query("update public.restaurants set profile=jsonb_build_object('timezone','Africa/Nairobi') where id=$1",[x.otherRestaurant]);
    const other=await call(x.otherOwner,x.otherRestaurant);
    assert.equal(other.soldItems.length,0); assert.equal(other.legacyUnattributedItemCount,0);
    pass('Other tenant report contains none of fixture tenant activity');
    await rejected('Cross-tenant owner denied',()=>call(x.otherOwner),/access is required/);
    await rejected('Manager denied',()=>call(x.manager),/access is required/);
    await rejected('Inactive owner denied',()=>call(x.inactiveOwner),/access is required/);
    await rejected('Anonymous denied',()=>asAnonymous(db,'select public.get_owner_menu_sales_report($1,\\'today\\')',[x.restaurant]),/permission denied/);
    await rejected('Invalid period rejected',()=>call(x.owner,x.restaurant,'invalid'),/Unsupported/);
    await rejected('Reversed custom dates rejected',()=>call(x.owner,x.restaurant,'custom','2000-01-02','2000-01-01'),/before/);
    const security=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid='public.get_owner_menu_sales_report(uuid,text,date,date)'::regprocedure")).rows[0];
    assert(security.prosecdef); assert(security.proconfig.includes('search_path=pg_catalog, public')); assert(!security.anon);
    pass('Fixed search_path and restricted execution');
  } finally { await db.query('rollback'); }
`;
async function main() {
  const env=fs.readFileSync(path.join(root,'supabase/connection.env'),'utf8');
  const line=env.split(/\r?\n/).find(s=>/^\s*SUPABASE_DB_URL\s*=/.test(s));
  assert(line,'Missing DB connection');
  const url=line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/,'').trim().replace(/^["']|["']$/g,'');
  const db=new Client({connectionString:url,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000});
  await db.connect();
  try {
    await db.query("set statement_timeout='45s'; set lock_timeout='5s'");
    const run=new (Object.getPrototypeOf(async function(){}).constructor)('db','fs','path','root','assert','crypto','uuid','pass','candidate','applyMigration',helpers+setup+checks);
    await run(db,fs,path,root,assert,crypto,crypto.randomUUID,pass,migration,false);
    pass('Candidate DDL and fixtures rolled back; no deployment');
  } finally { await db.end(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
