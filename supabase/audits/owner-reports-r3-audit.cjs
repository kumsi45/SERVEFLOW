const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");

function connectionUrl() {
  const source = fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8");
  const line = source.split(/\r?\n/).find((value) => /^\s*SUPABASE_DB_URL\s*=/.test(value));
  assert(line, "SUPABASE_DB_URL is required in supabase/connection.env");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^[\"']|[\"']$/g, "");
}

function projectRef(url) {
  const parsed = new URL(url);
  const match = `${parsed.username}.${parsed.hostname}`.match(/(?:postgres\.)?([a-z]{20})/);
  return match?.[1] ?? null;
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function planIndexes(value, found = new Set()) {
  if (Array.isArray(value)) for (const item of value) planIndexes(item, found);
  else if (value && typeof value === "object") {
    if (value["Index Name"]) found.add(value["Index Name"]);
    for (const item of Object.values(value)) planIndexes(item, found);
  }
  return [...found];
}

function pass(label, detail = "") {
  process.stdout.write(`PASS ${label}${detail ? ` — ${detail}` : ""}\n`);
}

const uuid = () => crypto.randomUUID();

async function asUser(db, userId, sql, args = []) {
  await db.query("savepoint owner_reports_rpc");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub',$1,true)", [userId]);
    const result = await db.query(sql, args);
    await db.query("reset role");
    await db.query("release savepoint owner_reports_rpc");
    return result;
  } catch (error) {
    await db.query("rollback to savepoint owner_reports_rpc");
    await db.query("reset role");
    await db.query("release savepoint owner_reports_rpc");
    throw error;
  }
}

async function asAnonymous(db, sql, args = []) {
  await db.query("savepoint owner_reports_anon");
  try {
    await db.query("set local role anon");
    const result = await db.query(sql, args);
    await db.query("reset role");
    await db.query("release savepoint owner_reports_anon");
    return result;
  } catch (error) {
    await db.query("rollback to savepoint owner_reports_anon");
    await db.query("reset role");
    await db.query("release savepoint owner_reports_anon");
    throw error;
  }
}

async function rejected(label, action, pattern) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  assert(failure, `${label} must reject`);
  if (pattern) assert(pattern.test(failure.message), `${label} rejected with unexpected error: ${failure.message}`);
  pass(label);
}

async function preflight(db, url) {
  const expectedProject = "dbdhuuanfsniqvcyuscd";
  assert.equal(projectRef(url), expectedProject, "Hosted project reference must match the approved project");
  pass("Approved hosted project verified", expectedProject);

  const migration = await db.query(`
    select version, name
    from supabase_migrations.schema_migrations
    order by version desc
    limit 1
  `);
  assert.equal(migration.rows[0]?.version, "266", "Remote migration head must be 266 before R3 deployment");
  pass("Remote migration head is 266", migration.rows[0]?.name ?? "");
  const migrationColumns = await db.query(`select column_name,data_type
    from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations'
    order by ordinal_position`);
  pass("Migration history schema", migrationColumns.rows.map((row)=>`${row.column_name}:${row.data_type}`).join(", "));

  const reportNames = [
    "get_owner_reports_read_model",
    "get_owner_report_feedback_page",
    "get_owner_report_staff_operations_page",
  ];
  const conflicts = await db.query(`
    select p.oid::regprocedure::text signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])
  `, [reportNames]);
  assert.equal(conflicts.rowCount, 0, "R3 RPC names must be unused before migration 267");
  pass("R3 RPC names are available");

  const functions = [
    "get_owner_finance_read_model", "normalize_payment_method", "create_public_qr_order",
    "submit_waiter_order_batch", "create_cashier_order", "append_items_to_order",
    "merge_open_session_invoice", "split_waiter_bill_quantities", "verify_dining_session_payment",
    "initiate_cashier_handover", "confirm_cashier_handover", "cashier_shift_drawer_totals",
    "close_cashier_shift", "submit_public_order_feedback",
  ];
  const definitions = await db.query(`
    select p.proname, p.oid::regprocedure::text signature, p.prosecdef,
      coalesce(array_to_string(p.proconfig, ','), '') settings,
      pg_get_functiondef(p.oid) definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])
    order by p.proname, p.oid::regprocedure::text
  `, [functions]);
  for (const name of functions) {
    const rows = definitions.rows.filter((row) => row.proname === name);
    assert(rows.length > 0, `Hosted function ${name} must exist`);
    pass(`Hosted function ${name}`, rows.map((row) => `${row.signature} sha256:${digest(row.definition)}`).join("; "));
  }

  const required = {
    restaurants: ["id", "profile", "currency_code"],
    order_invoices: ["id", "restaurant_id", "order_id", "payment_status", "paid_at", "refunded_at", "grand_total", "total_price", "payment_method", "verified_by", "cashier_shift_id"],
    orders: ["id", "restaurant_id", "created_at", "order_source", "table_id", "table_number", "created_by_waiter_id"],
    order_items: ["id", "restaurant_id", "order_id", "invoice_id", "menu_item_id", "quantity", "price", "kitchen_status", "kitchen_preparation_started_at", "kitchen_completed_at", "kitchen_completed_by", "kitchen_station_id"],
    menu_items: ["id", "restaurant_id", "category_id", "name", "available", "archived_at", "created_at"],
    categories: ["id", "restaurant_id", "name"],
    restaurant_tables: ["id", "restaurant_id", "table_number"],
    kitchen_stations: ["id", "restaurant_id", "name", "archived_at"],
    restaurant_staff: ["id", "restaurant_id", "user_id", "role", "display_name", "employee_id", "active"],
    cashier_shifts: ["id", "restaurant_id", "opened_by", "opened_at", "closed_at"],
    cash_reconciliations: ["id", "restaurant_id", "shift_id", "closed_by", "expected_cash", "actual_cash", "variance", "closed_at"],
    cashier_shift_expenses: ["id", "restaurant_id", "cashier_staff_id", "amount", "status", "created_at", "reviewed_at"],
    cashier_cash_handovers: ["id", "restaurant_id", "outgoing_cashier_id", "incoming_cashier_id", "declared_amount", "received_amount", "difference", "status", "initiated_at", "confirmed_at"],
    public_order_feedback: ["id", "restaurant_id", "order_id", "rating", "reactions", "comment", "photo_url", "created_at"],
    business_payment_methods: ["id", "restaurant_id", "immutable_key", "method_code", "display_name", "enabled"],
  };
  const columns = await db.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = any($1::text[])
  `, [Object.keys(required)]);
  for (const [table, names] of Object.entries(required)) {
    const actual = new Set(columns.rows.filter((row) => row.table_name === table).map((row) => row.column_name));
    const missing = names.filter((name) => !actual.has(name));
    assert.deepEqual(missing, [], `${table} is missing required columns`);
    pass(`Hosted schema ${table}`, `${names.length} required columns present`);
  }

  const legacy = await db.query(`
    select count(*)::integer total,
      count(*) filter (where appended_at is not null)::integer appended
    from public.order_items
    where invoice_id is null
  `);
  pass("Hosted legacy invoice-less item scope", `total=${legacy.rows[0].total}, appended=${legacy.rows[0].appended}`);
}

async function validateMigration(db) {
  const migration = fs.readFileSync(
    path.join(root, "supabase", "migrations", "267_owner_reports_v1_authoritative_read_model.sql"),
    "utf8",
  );
  await db.query("begin");
  try {
    await db.query(migration);
    const functions = await db.query(`
      select proname, prosecdef, coalesce(array_to_string(proconfig, ','), '') settings
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and proname = any($1::text[])
      order by proname
    `, [["get_owner_reports_read_model","get_owner_report_feedback_page","get_owner_report_staff_operations_page"]]);
    assert.equal(functions.rowCount, 3, "Migration must create exactly the three public R3 RPCs");
    assert(functions.rows.every((row) => row.prosecdef), "Every public R3 RPC must be SECURITY DEFINER");
    assert(functions.rows.every((row) => row.settings.includes("search_path=pg_catalog, public")), "Every public R3 RPC must fix search_path");
    pass("Migration 267 parses against hosted schema");
    pass("Three public R3 RPCs are SECURITY DEFINER with fixed search_path");
  } finally {
    await db.query("rollback");
  }
}

async function hostileTests(db, applyMigration = true) {
  const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "267_owner_reports_v1_authoritative_read_model.sql"), "utf8");
  const x = {
    restaurant: uuid(), otherRestaurant: uuid(), category: uuid(), station: uuid(), table: uuid(),
    owner: uuid(), otherOwner: uuid(), inactiveOwner: uuid(), manager: uuid(), cashier: uuid(), secondCashier: uuid(),
    waiter: uuid(), waiter2: uuid(), kitchen: uuid(), inventory: uuid(), outsider: uuid(),
    ownerStaff: uuid(), otherOwnerStaff: uuid(), inactiveOwnerStaff: uuid(), managerStaff: uuid(), cashierStaff: uuid(),
    secondCashierStaff: uuid(), waiterStaff: uuid(), waiter2Staff: uuid(), kitchenStaff: uuid(), inventoryStaff: uuid(),
    shift: uuid(), closedShift: uuid(), reconciliation: uuid(), handover: uuid(),
    coffee: uuid(), burger: uuid(), cake: uuid(), zeroItem: uuid(), retainedMenuItem: uuid(),
    order: uuid(), feedbackOrder: uuid(), legacyOrder: uuid(), cancellationOrder: uuid(), refundOrder: uuid(),
    invoiceA: uuid(), invoiceB: uuid(), feedbackInvoice: uuid(), cancellationInvoice: uuid(), refundInvoice: uuid(),
    cancelledItem: uuid(), retainedItem: uuid(),
  };
  const suffix = crypto.randomBytes(6).toString("hex");
  const allUsers = [x.owner,x.otherOwner,x.inactiveOwner,x.manager,x.cashier,x.secondCashier,x.waiter,x.waiter2,x.kitchen,x.inventory,x.outsider];
  await db.query("begin");
  try {
    if (applyMigration) await db.query(migration);
    for (const user of allUsers) {
      await db.query(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
        values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now())`,
      [user,`owner-reports-${user}@example.test`]);
    }
    await db.query(`insert into public.restaurants(id,name,slug,active,profile,currency_code)
      values($1,'Owner Reports R3 Fixture',$2,true,'{"timezone":"Africa/Nairobi"}'::jsonb,'ETB'),
            ($3,'Owner Reports R3 Other',$4,true,'{"timezone":"Invalid/Timezone"}'::jsonb,'ETB')`,
      [x.restaurant,`owner-reports-r3-${suffix}`,x.otherRestaurant,`owner-reports-r3-other-${suffix}`]);
    const staffRows = [
      [x.ownerStaff,x.restaurant,x.owner,"owner","R3 Owner",true],
      [x.otherOwnerStaff,x.otherRestaurant,x.otherOwner,"owner","R3 Other Owner",true],
      [x.inactiveOwnerStaff,x.restaurant,x.inactiveOwner,"owner","R3 Inactive Owner",false],
      [x.managerStaff,x.restaurant,x.manager,"manager","R3 Manager",true],
      [x.cashierStaff,x.restaurant,x.cashier,"cashier","R3 Cashier",true],
      [x.secondCashierStaff,x.restaurant,x.secondCashier,"cashier","R3 Cashier Two",true],
      [x.waiterStaff,x.restaurant,x.waiter,"waiter","Duplicate Waiter",false],
      [x.waiter2Staff,x.restaurant,x.waiter2,"waiter","Duplicate Waiter",true],
      [x.kitchenStaff,x.restaurant,x.kitchen,"kitchen","R3 Kitchen",true],
      [x.inventoryStaff,x.restaurant,x.inventory,"inventory_officer","R3 Inventory",true],
    ];
    for (const row of staffRows) {
      await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active)
        values($1,$2,$3,$4,$5,$6)`, row);
    }
    await db.query("insert into public.cashier_shifts(id,restaurant_id,opened_by,opening_cash,opened_at) values($1,$2,$3,100,now()-interval '4 hours')",[x.shift,x.restaurant,x.cashierStaff]);
    await db.query("insert into public.cashier_shifts(id,restaurant_id,opened_by,opening_cash,opened_at,closed_at,closed_by,expected_cash,actual_cash,variance) values($1,$2,$3,50,now()-interval '2 days',now()-interval '1 hour',$3,700,690,-10)",[x.closedShift,x.restaurant,x.cashierStaff]);
    await db.query("insert into public.cash_reconciliations(id,restaurant_id,shift_id,closed_by,opening_cash,cash_payments,cash_refunds,expected_cash,actual_cash,variance,closed_at) values($1,$2,$3,$4,50,650,0,700,690,-10,now()-interval '1 hour')",[x.reconciliation,x.restaurant,x.closedShift,x.cashierStaff]);
    await db.query("insert into public.cashier_cash_handovers(id,restaurant_id,outgoing_shift_id,incoming_shift_id,outgoing_cashier_id,incoming_cashier_id,expected_amount,declared_amount,received_amount,difference,status,initiated_at,confirmed_at) values($1,$2,$3,null,$4,$5,700,700,700,0,'confirmed',now()-interval '30 minutes',now()-interval '20 minutes')",[x.handover,x.restaurant,x.shift,x.cashierStaff,x.secondCashierStaff]);
    await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'R3 Menu')",[x.category,x.restaurant]);
    const existingStation = (await db.query("select id from public.kitchen_stations where restaurant_id=$1 order by created_at limit 1",[x.restaurant])).rows[0];
    if (existingStation) x.station=existingStation.id;
    else await db.query("insert into public.kitchen_stations(id,restaurant_id,name,active,is_default) values($1,$2,'R3 Kitchen',true,true)",[x.station,x.restaurant]);
    const existingTable = (await db.query("select id,table_number from public.restaurant_tables where restaurant_id=$1 order by table_number limit 1",[x.restaurant])).rows[0];
    if (existingTable) { x.table=existingTable.id; x.tableNumber=String(existingTable.table_number); }
    else {
      x.tableNumber="1";
      await db.query("insert into public.restaurant_tables(id,restaurant_id,table_number,label,qr_token,active) values($1,$2,1,'R3 Table',$3,true)",[x.table,x.restaurant,uuid()]);
    }
    await db.query(`insert into public.menu_items(id,restaurant_id,category_id,kitchen_station_id,name,price,available,created_at)
      values($1,$5,$6,$7,'Coffee',100,true,now()-interval '10 days'),
        ($2,$5,$6,$7,'Burger',400,true,now()-interval '10 days'),
        ($3,$5,$6,$7,'Cake Renamed',200,true,now()-interval '10 days'),
        ($4,$5,$6,$7,'Recently Added Zero',50,true,now()),
        ($8,$5,$6,$7,'Cancellation Surviving Line',50,true,now()-interval '10 days')`,[x.coffee,x.burger,x.cake,x.zeroItem,x.restaurant,x.category,x.station,x.retainedMenuItem]);
    await db.query(`insert into public.orders(id,restaurant_id,table_id,table_number,status,total_price,customer_name,order_source,created_by_waiter_id,dining_session_status,created_at)
      values($1,$2,$3,$4,'paid',700,'R3 A/B','waiter',$5,'closed',now()-interval '2 hours'),
        ($6,$2,$3,$4,'cancelled',0,'R3 Feedback','public_qr',null,'closed',now()-interval '1 hour'),
        ($7,$2,$3,$4,'cancelled',10,'R3 Legacy','public_qr',null,'closed',now()-interval '30 minutes'),
        ($8,$2,$3,$4,'paid',25,'R3 Later Refund','cashier',null,'closed',now()-interval '3 days')`,
      [x.order,x.restaurant,x.table,x.tableNumber,x.waiterStaff,x.feedbackOrder,x.legacyOrder,x.refundOrder]);
    await db.query(`insert into public.order_invoices(id,restaurant_id,order_id,invoice_number,status,payment_status,total_price,grand_total,subtotal,vat_rate,vat_amount,service_charge_rate,service_charge_amount,discount_amount,payment_method,paid_at,verified_at,verified_by,cashier_shift_id,financial_snapshot_version,invoice_source,created_by_staff_id)
      values($1,$4,$5,1,'verified','paid',500,500,500,0,0,0,0,0,'Cash',now()-interval '2 hours',now()-interval '2 hours',$6,$7,'frozen_v1','waiter',$9),
        ($2,$4,$5,2,'verified','paid',200,200,200,0,0,0,0,0,'Cash',now()-interval '1 hour',now()-interval '1 hour',$6,$7,'frozen_v1','waiter',$9),
        ($3,$4,$8,1,'verified','paid',10,10,10,0,0,0,0,0,'Legacy Method',now()-interval '1 hour',now()-interval '1 hour',$6,$7,'frozen_v1','public_qr',null)`,
      [x.invoiceA,x.invoiceB,x.feedbackInvoice,x.restaurant,x.order,x.cashierStaff,x.shift,x.feedbackOrder,x.waiterStaff]);
    await db.query(`insert into public.order_invoices(id,restaurant_id,order_id,invoice_number,status,payment_status,total_price,grand_total,subtotal,vat_rate,vat_amount,service_charge_rate,service_charge_amount,discount_amount,payment_method,paid_at,refunded_at,verified_at,verified_by,cashier_shift_id,financial_snapshot_version,invoice_source,created_by_staff_id)
      values($1,$2,$3,1,'refunded','refunded',25,25,25,0,0,0,0,0,'Cash',now()-interval '3 days',now()-interval '1 second',now()-interval '3 days',$4,$5,'frozen_v1','cashier',$4)`,
      [x.refundInvoice,x.restaurant,x.refundOrder,x.cashierStaff,x.shift]);
    await db.query(`insert into public.business_payment_methods(restaurant_id,method_code,display_name,enabled,display_order)
      values($1,'cash','Cash',false,1)
      on conflict (restaurant_id,method_code) do update set is_default=false,enabled=false`,[x.restaurant]);
    await db.query(`insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_station_id,kitchen_status,kitchen_preparation_started_at,kitchen_completed_at,kitchen_completed_by)
      values($1,$5,$6,$7,$8,1,100,$9,'completed',now()-interval '130 minutes',now()-interval '120 minutes',$10),
        ($2,$5,$6,$7,$11,1,400,$9,'held',null,null,null),
        ($3,$5,$6,$12,$13,1,200,$9,'held',null,null,null),
        ($4,$5,$14,null,$8,1,10,$9,'held',null,null,null)`,
      [uuid(),uuid(),uuid(),uuid(),x.restaurant,x.order,x.invoiceA,x.coffee,x.station,x.kitchenStaff,x.burger,x.invoiceB,x.cake,x.legacyOrder]);
    await db.query(`insert into public.orders(id,restaurant_id,table_id,table_number,status,total_price,customer_name,order_source,created_by_waiter_id,dining_session_status,created_at)
      values($1,$2,$3,$4,'pending',950,'R3 Canonical Cancellation','waiter',$5,'open',now()-interval '45 minutes')`,
      [x.cancellationOrder,x.restaurant,x.table,x.tableNumber,x.waiter2Staff]);
    await db.query(`insert into public.order_invoices(id,restaurant_id,order_id,invoice_number,status,payment_status,total_price,grand_total,subtotal,vat_rate,vat_amount,service_charge_rate,service_charge_amount,discount_amount,payment_method,financial_snapshot_version,invoice_source,created_by_staff_id)
      values($1,$2,$3,1,'pending','pending',950,950,950,0,0,0,0,0,'Cash','frozen_v1','waiter',$4)`,
      [x.cancellationInvoice,x.restaurant,x.cancellationOrder,x.waiter2Staff]);
    await db.query(`insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_station_id,kitchen_status)
      values($1,$3,$4,$5,$6,9,100,$7,'held'),($2,$3,$4,$5,$8,1,50,$7,'held')`,
      [x.cancelledItem,x.retainedItem,x.restaurant,x.cancellationOrder,x.cancellationInvoice,x.cake,x.station,x.retainedMenuItem]);
    const cancellationRequest=(await asUser(db,x.waiter2,"select public.request_waiter_cancellation($1,$2,'Wrong item entered',null) result",[x.cancellationOrder,x.cancelledItem])).rows[0].result;
    await asUser(db,x.cashier,"select public.cashier_handle_cancellation_request($1,'direct_cancel')",[cancellationRequest.request_id]);
    const cancelledLine=(await db.query("select invoice_id,kitchen_status,cancellation_request_id from public.order_items where id=$1",[x.cancelledItem])).rows[0];
    assert.equal(cancelledLine.invoice_id,x.cancellationInvoice);
    assert.equal(cancelledLine.kitchen_status,"cancelled");
    assert(cancelledLine.cancellation_request_id);
    await db.query(`update public.order_invoices set status='verified',payment_status='paid',total_price=50,grand_total=50,subtotal=50,
      paid_at=now()-interval '20 minutes',verified_at=now()-interval '20 minutes',verified_by=$2,cashier_shift_id=$3
      where id=$1`,[x.cancellationInvoice,x.cashierStaff,x.shift]);
    await db.query("update public.orders set status='paid',total_price=50,dining_session_status='closed' where id=$1",[x.cancellationOrder]);
    const feedbackTime = new Date().toISOString();
    await db.query(`insert into public.public_order_feedback(id,restaurant_id,order_id,rating,reactions,comment,created_at)
      values($1,$2,$3,5,array['Great Service'],'Excellent',$6),($4,$2,$5,3,array[]::text[],'Okay',$6)`,
      [uuid(),x.restaurant,x.order,uuid(),x.feedbackOrder,feedbackTime]);

    const refundFixture=(await db.query("select payment_status,paid_at,refunded_at,now() database_now,(refunded_at at time zone 'Africa/Nairobi')::date refund_date,(now() at time zone 'Africa/Nairobi')::date today from public.order_invoices where id=$1",[x.refundInvoice])).rows[0];
    assert.equal(refundFixture.payment_status,"refunded");
    assert(refundFixture.refunded_at);
    assert.equal(String(refundFixture.refund_date),String(refundFixture.today));

    const reportResult = await asUser(db,x.owner,"select public.get_owner_reports_read_model($1,'today',null,null) report",[x.restaurant]);
    const report=reportResult.rows[0].report;
    assert.equal(report.contractVersion,"owner_reports_v1");
    assert.equal(Number(report.summary.collectedSales),760);
    assert.equal(Number(report.summary.collectedInvoices),4);
    assert.equal(Number(report.summary.refundAmount),25);
    assert.equal(Number(report.summary.refundCount),1);
    assert.equal(report.period.completeness,"in_progress");
    pass("Owner own-tenant aggregate succeeds");
    const menuByName=new Map(report.menu.topSelling.map((row)=>[row.name,row]));
    assert.equal(Number(menuByName.get("Coffee").quantity),1);
    assert.equal(Number(menuByName.get("Burger").quantity),1);
    assert.equal(Number(menuByName.get("Cake Renamed").quantity),1);
    assert.equal(Number(menuByName.get("Cake Renamed").itemLineSalesValue),200);
    assert.equal(Number(report.menu.currentMenuItemsWithLowestRecordedSales.find((row)=>row.name==="Cake Renamed").quantity),1);
    assert.equal(Number(report.menu.legacyUnattributedItemCount),1);
    assert.equal(report.menu.quality.state,"partial");
    pass("Invoice A/B cohorts do not recount first-batch items");
    pass("Canonically cancelled line is excluded from its later paid invoice cohort");
    pass("Legacy invoice-less item remains explicit",`count=${report.menu.legacyUnattributedItemCount}`);
    const lowest=report.menu.currentMenuItemsWithLowestRecordedSales.find((row)=>row.name==="Recently Added Zero");
    assert(lowest && Number(lowest.quantity)===0);
    pass("Current zero-selling item is included with catalog limitation");
    assert.equal(Number(report.operations.kitchen.completedItems),1);
    assert.equal(Number(report.operations.kitchen.timedItems),1);
    assert.equal(Number(report.operations.kitchen.untimedItems),0);
    assert.equal(Number(report.operations.kitchen.medianPreparationMinutes),10);
    pass("Kitchen timed count, coverage, average and median are authoritative");
    assert.equal(Number(report.summary.collectedSales),760,"Handover must not change collected sales");
    pass("Cash handover amount is excluded from collected sales");
    assert(report.payments.methods.some((row)=>row.classification==="legacy_unrecognized"));
    assert(report.payments.methods.some((row)=>row.displayLabel==="Cash"&&row.currentlyEnabled===false));
    pass("Legacy payment method remains visible");
    pass("Disabled historical payment method remains visible and marked disabled");
    const originalCollectionDate=(await db.query("select ((now()-interval '3 days') at time zone 'Africa/Nairobi')::date value")).rows[0].value;
    const originalDay=(await asUser(db,x.owner,"select public.get_owner_reports_read_model($1,'custom',$2,$2) report",[x.restaurant,originalCollectionDate])).rows[0].report;
    assert.equal(Number(originalDay.summary.collectedSales),25);
    assert.equal(Number(originalDay.summary.collectedInvoices),1);
    assert.equal(Number(originalDay.summary.refundAmount),0);
    assert.equal(Number(report.summary.refundAmount),25);
    assert.equal(Number(report.summary.collectedSales),760);
    pass("Later refund is attributed at refunded_at while original collection remains at paid_at");

    const finance=await asUser(db,x.owner,"select public.get_owner_finance_read_model($1,$2,$3,$4,$5) report",[x.restaurant,report.period.currentStart,report.period.currentEnd,report.period.comparisonStart,report.period.comparisonEnd]);
    assert.equal(Number(finance.rows[0].report.collections.collected_amount),Number(report.summary.collectedSales));
    assert.equal(Number(finance.rows[0].report.collections.collected_count),Number(report.summary.collectedInvoices));
    const reportMethods=report.payments.methods.map((row)=>({classification:row.classification,label:row.displayLabel,enabled:row.currentlyEnabled,amount:Number(row.collectedAmount),count:Number(row.collectedInvoices)})).sort((a,b)=>a.label.localeCompare(b.label));
    const financeMethods=finance.rows[0].report.payment_methods.map((row)=>({classification:row.classification,label:row.display_label,enabled:row.currently_enabled,amount:Number(row.collected_amount),count:Number(row.invoice_count)})).sort((a,b)=>a.label.localeCompare(b.label));
    assert.deepEqual(reportMethods,financeMethods);
    pass("Finance F2 collected amount, invoice count and payment-method parity");

    await rejected("Cross-tenant Owner request rejected",()=>asUser(db,x.owner,"select public.get_owner_reports_read_model($1,'today',null,null)",[x.otherRestaurant]),/Owner report access/);
    for (const [label,user] of [["Manager",x.manager],["Cashier",x.cashier],["Waiter",x.waiter],["Kitchen",x.kitchen],["Inventory Officer",x.inventory],["Inactive Owner",x.inactiveOwner],["No membership",x.outsider]]) {
      await rejected(`${label} request rejected`,()=>asUser(db,user,"select public.get_owner_reports_read_model($1,'today',null,null)",[x.restaurant]),/Owner report access/);
    }
    await rejected("Anonymous request rejected",()=>asAnonymous(db,"select public.get_owner_reports_read_model($1,'today',null,null)",[x.restaurant]),/permission denied|Owner report access/);

    const privileges=await db.query(`select
      has_function_privilege('anon','public.get_owner_reports_read_model(uuid,text,date,date)','execute') anon_main,
      has_function_privilege('public','public.get_owner_reports_read_model(uuid,text,date,date)','execute') public_main,
      has_function_privilege('authenticated','public.get_owner_reports_read_model(uuid,text,date,date)','execute') auth_main,
      has_function_privilege('authenticated','public._owner_reports_resolve_period(uuid,text,date,date,timestamptz)','execute') auth_helper`);
    assert.equal(privileges.rows[0].anon_main,false); assert.equal(privileges.rows[0].public_main,false);
    assert.equal(privileges.rows[0].auth_main,true); assert.equal(privileges.rows[0].auth_helper,false);
    pass("Public/anon EXECUTE absent and internal helper hidden");

    const feedback1=(await asUser(db,x.owner,"select public.get_owner_report_feedback_page($1,'today',null,null,1,null,null) report",[x.restaurant])).rows[0].report;
    assert.equal(feedback1.items.length,1); assert(feedback1.nextCursor); assert.equal("photoUrl" in feedback1.items[0],false);
    const feedback2=(await asUser(db,x.owner,"select public.get_owner_report_feedback_page($1,'today',null,null,1,$2,$3) report",[x.restaurant,feedback1.nextCursor.createdAt,feedback1.nextCursor.id])).rows[0].report;
    assert.equal(feedback2.items.length,1);
    pass("Feedback keyset pagination handles duplicate timestamps without exposing photo URL");

    const staff1=(await asUser(db,x.owner,"select public.get_owner_report_staff_operations_page($1,'today',null,null,1,null,null,null) report",[x.restaurant])).rows[0].report;
    assert.equal(staff1.items.length,1); assert(staff1.nextCursor); assert.equal("hoursWorked" in staff1.items[0].operations,false);
    const staff2=(await asUser(db,x.owner,"select public.get_owner_report_staff_operations_page($1,'today',null,null,1,$2,$3,$4) report",[x.restaurant,staff1.nextCursor.role,staff1.nextCursor.displayName,staff1.nextCursor.staffId])).rows[0].report;
    assert.equal(staff2.items.length,1);
    for (const row of [...staff1.items,...staff2.items]) {
      assert.equal("userId" in row,false); assert.equal("authId" in row,false); assert.equal("email" in row,false);
      assert.equal("rank" in row,false); assert.equal("score" in row,false);
    }
    pass("Staff keyset pagination and privacy contract hold");
    const staffAll=(await asUser(db,x.owner,"select public.get_owner_report_staff_operations_page($1,'today',null,null,100,null,null,null) report",[x.restaurant])).rows[0].report;
    const cashierRow=staffAll.items.find((row)=>row.role==="cashier"&&row.displayName==="R3 Cashier");
    const waiterRow=staffAll.items.find((row)=>row.role==="waiter"&&row.membershipState==="inactive");
    const kitchenRow=staffAll.items.find((row)=>row.role==="kitchen");
    assert.equal(Number(cashierRow.operations.settlementsHandled),4);
    assert.equal(Number(cashierRow.operations.collectedAmountHandled),760);
    assert.equal(Number(cashierRow.operations.financialShiftsOpened),1);
    assert.equal(Number(cashierRow.operations.financialShiftsClosed),1);
    assert.equal(Number(cashierRow.operations.reconciliationsCompleted),1);
    assert.equal(Number(cashierRow.operations.recordedVariance),-10);
    assert.equal(Number(cashierRow.operations.handoversInitiated),1);
    assert.equal("hoursWorked" in cashierRow.operations,false);
    assert(waiterRow && Number(waiterRow.operations.ordersTaken)===1);
    assert(kitchenRow && Number(kitchenRow.operations.itemsCompleted)===1);
    pass("Waiter, cashier, reconciliation, handover and kitchen role facts are attributed without attendance");

    const localToday=(await db.query("select (statement_timestamp() at time zone 'Africa/Nairobi')::date value")).rows[0].value;
    const custom=(await asUser(db,x.owner,"select public.get_owner_reports_read_model($1,'custom',$2,$2) report",[x.restaurant,localToday])).rows[0].report;
    assert.equal(custom.period.completeness,"in_progress"); assert.equal(custom.period.durationSecondsEqual,true);
    pass("Custom range ending today uses equal elapsed comparison and in-progress metadata");
    await rejected("367-day custom range rejected",()=>asUser(db,x.owner,"select public.get_owner_reports_read_model($1,'custom',$2::date-366,$2) report",[x.restaurant,localToday]),/366/);
    const zero=(await asUser(db,x.owner,"select public.get_owner_reports_read_model($1,'custom','2020-01-01','2020-01-01') report",[x.restaurant])).rows[0].report;
    assert.equal(zero.summary.quality.state,"no_activity"); assert.equal(Number(zero.summary.collectedSales),0);
    pass("True zero is no_activity, not unavailable");
    await rejected("Invalid timezone fails instead of returning zero",()=>asUser(db,x.otherOwner,"select public.get_owner_reports_read_model($1,'today',null,null)",[x.otherRestaurant]),/timezone configuration is invalid/);

    const businessCounts=()=>db.query(`select jsonb_build_object(
      'orders',(select count(*) from public.orders where restaurant_id=$1),
      'invoices',(select count(*) from public.order_invoices where restaurant_id=$1),
      'items',(select count(*) from public.order_items where restaurant_id=$1),
      'menuItems',(select count(*) from public.menu_items where restaurant_id=$1),
      'staff',(select count(*) from public.restaurant_staff where restaurant_id=$1),
      'shifts',(select count(*) from public.cashier_shifts where restaurant_id=$1),
      'handovers',(select count(*) from public.cashier_cash_handovers where restaurant_id=$1),
      'feedback',(select count(*) from public.public_order_feedback where restaurant_id=$1),
      'paymentMethods',(select count(*) from public.business_payment_methods where restaurant_id=$1)
    ) counts`,[x.restaurant]);
    const before=(await businessCounts()).rows[0].counts;
    await asUser(db,x.owner,"select public.get_owner_reports_read_model($1,'today',null,null)",[x.restaurant]);
    await asUser(db,x.owner,"select public.get_owner_report_feedback_page($1,'today',null,null,25,null,null)",[x.restaurant]);
    await asUser(db,x.owner,"select public.get_owner_report_staff_operations_page($1,'today',null,null,25,null,null,null)",[x.restaurant]);
    const after=(await businessCounts()).rows[0].counts;
    assert.deepEqual(after,before);
    pass("All three report RPCs produce no business-data writes across orders, invoices, items, menu, staff, shifts, handovers, feedback or configuration");

    await db.query("set local enable_seqscan=off");
    for (const [label,query,args] of [
      ["invoice cohort","select * from public.order_invoices where restaurant_id=$1 and paid_at>=now()-interval '1 day'",[x.restaurant]],
      ["invoice-item join","select * from public.order_items where restaurant_id=$1 and invoice_id=$2",[x.restaurant,x.invoiceA]],
      ["orders range","select * from public.orders where restaurant_id=$1 and created_at>=now()-interval '1 day'",[x.restaurant]],
      ["kitchen range","select * from public.order_items where restaurant_id=$1 and kitchen_completed_at>=now()-interval '1 day'",[x.restaurant]],
      ["feedback keyset","select * from public.public_order_feedback where restaurant_id=$1 order by created_at desc,id desc limit 25",[x.restaurant]],
      ["staff keyset","select * from public.restaurant_staff where restaurant_id=$1 order by role::text,lower(display_name),id limit 25",[x.restaurant]],
      ["waiter event cohort","select * from public.orders where restaurant_id=$1 and created_by_waiter_id=$2 and created_at>=now()-interval '1 day'",[x.restaurant,x.waiter2Staff]],
      ["cashier event cohort","select * from public.order_invoices where restaurant_id=$1 and verified_by=$2 and paid_at>=now()-interval '1 day'",[x.restaurant,x.cashierStaff]],
      ["kitchen staff event cohort","select * from public.order_items where restaurant_id=$1 and kitchen_completed_by=$2 and kitchen_completed_at>=now()-interval '1 day'",[x.restaurant,x.kitchenStaff]],
    ]) {
      const plan=await db.query(`explain (format json) ${query}`,args);
      const payload=plan.rows[0]["QUERY PLAN"];
      assert(payload);
      const indexes=planIndexes(payload);
      pass(`EXPLAIN ${label} succeeds`,indexes.length?`planner index path: ${indexes.join(", ")}`:"no index node in forced-index review");
    }
    pass("Aggregate uses one PostgreSQL statement snapshot for all domain CTEs");
  } finally {
    await db.query("rollback");
  }
  const residue=await db.query(`select jsonb_build_object(
    'restaurants',(select count(*) from public.restaurants where id=any($1::uuid[])),
    'users',(select count(*) from auth.users where id=any($2::uuid[])),
    'staff',(select count(*) from public.restaurant_staff where id=any($3::uuid[])),
    'orders',(select count(*) from public.orders where id=any($4::uuid[])),
    'invoices',(select count(*) from public.order_invoices where id=any($5::uuid[])),
    'items',(select count(*) from public.order_items where id=any($6::uuid[])),
    'shifts',(select count(*) from public.cashier_shifts where id=any($7::uuid[])),
    'handovers',(select count(*) from public.cashier_cash_handovers where id=$8),
    'paymentMethods',(select count(*) from public.business_payment_methods where restaurant_id=any($1::uuid[])),
    'feedback',(select count(*) from public.public_order_feedback where restaurant_id=any($1::uuid[]))
  ) counts`,[[x.restaurant,x.otherRestaurant],allUsers,
    [x.ownerStaff,x.otherOwnerStaff,x.inactiveOwnerStaff,x.managerStaff,x.cashierStaff,x.secondCashierStaff,x.waiterStaff,x.waiter2Staff,x.kitchenStaff,x.inventoryStaff],
    [x.order,x.feedbackOrder,x.legacyOrder,x.cancellationOrder,x.refundOrder],
    [x.invoiceA,x.invoiceB,x.feedbackInvoice,x.cancellationInvoice,x.refundInvoice],
    [x.cancelledItem,x.retainedItem],[x.shift,x.closedShift],x.handover]);
  assert(Object.values(residue.rows[0].counts).every((value)=>Number(value)===0),`Fixture residue: ${JSON.stringify(residue.rows[0].counts)}`);
  pass("Transactional hostile fixtures rolled back with exact zero residue across auth, operations and configuration");
}

async function deployMigration(db, url) {
  const expectedProject = "dbdhuuanfsniqvcyuscd";
  assert.equal(projectRef(url), expectedProject, "Deployment target must be the approved project");
  const migration = fs.readFileSync(path.join(root,"supabase","migrations","267_owner_reports_v1_authoritative_read_model.sql"),"utf8");
  await db.query("begin");
  try {
    await db.query("select pg_advisory_xact_lock(hashtext('serveflow-migration-267'))");
    const head=(await db.query("select version from supabase_migrations.schema_migrations order by version desc limit 1")).rows[0]?.version;
    assert.equal(head,"266","Remote head changed; refusing to deploy Migration 267");
    const existing=(await db.query("select count(*)::int count from supabase_migrations.schema_migrations where version='267'")).rows[0].count;
    assert.equal(existing,0,"Migration 267 already exists remotely");
    await db.query(migration);
    await db.query("insert into supabase_migrations.schema_migrations(version,statements,name) values('267',$1::text[],'owner_reports_v1_authoritative_read_model')",[[migration]]);
    await db.query("commit");
    pass("Migration 267 deployed to approved hosted project",expectedProject);
  } catch(error) {
    await db.query("rollback");
    throw error;
  }
}

async function postflight(db, url) {
  assert.equal(projectRef(url),"dbdhuuanfsniqvcyuscd","Postflight target must be approved project");
  const head=(await db.query("select version,name,statements from supabase_migrations.schema_migrations order by version desc limit 1")).rows[0];
  assert.equal(head.version,"267");
  assert.equal(head.name,"owner_reports_v1_authoritative_read_model");
  pass("Remote migration head is 267",head.name);
  const localMigration=fs.readFileSync(path.join(root,"supabase","migrations","267_owner_reports_v1_authoritative_read_model.sql"),"utf8");
  assert.equal(head.statements.length,1);
  assert.equal(head.statements[0],localMigration,"Local Migration 267 bytes differ from hosted migration history");
  pass("Hosted migration-history statement matches local Migration 267 bytes",crypto.createHash("sha256").update(localMigration).digest("hex"));
  const functions=await db.query(`select p.proname,p.prosecdef,coalesce(array_to_string(p.proconfig,','),'') settings,
    pg_get_userbyid(p.proowner) owner,pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[]) order by p.proname`,[["get_owner_reports_read_model","get_owner_report_feedback_page","get_owner_report_staff_operations_page"]]);
  assert.equal(functions.rowCount,3);
  for(const row of functions.rows){
    assert.equal(row.prosecdef,true); assert(row.settings.includes("search_path=pg_catalog, public"));
    pass(`Effective ${row.proname}`,`owner=${row.owner}, sha256:${digest(row.definition)}`);
  }
  const privileges=await db.query(`select p.proname,
    has_function_privilege('public',p.oid,'execute') public_execute,
    has_function_privilege('anon',p.oid,'execute') anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') authenticated_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like '_owner_reports_%' order by p.proname`);
  assert(privileges.rows.every((row)=>!row.public_execute&&!row.anon_execute&&!row.authenticated_execute));
  pass("Internal Owner Reports helpers have no public/anon/authenticated EXECUTE");
  const externalPrivileges=await db.query(`select p.proname,
    has_function_privilege('public',p.oid,'execute') public_execute,
    has_function_privilege('anon',p.oid,'execute') anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') authenticated_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[]) order by p.proname`,[["get_owner_reports_read_model","get_owner_report_feedback_page","get_owner_report_staff_operations_page"]]);
  assert.equal(externalPrivileges.rowCount,3);
  assert(externalPrivileges.rows.every((row)=>!row.public_execute&&!row.anon_execute&&row.authenticated_execute));
  pass("All external Owner Reports RPCs deny PUBLIC/anon and grant authenticated EXECUTE");
  assert(!/\bcreate\s+(unique\s+)?index\b/i.test(localMigration),"Migration 267 unexpectedly contains an index DDL statement");
  pass("Migration 267 added no indexes");
  const legacy=await db.query(`select count(*)::int total,
    count(*) filter(where appended_at is not null)::int appended
    from public.order_items where invoice_id is null`);
  assert.equal(legacy.rows[0].total,1,"Hosted legacy invoice-less population changed");
  pass("Hosted legacy invoice-less item remains untouched",`total=${legacy.rows[0].total}, appended=${legacy.rows[0].appended}`);
  const indexes=await db.query(`select tablename,indexname,indexdef from pg_indexes where schemaname='public'
    and tablename=any($1::text[])
    and indexdef ~* '(paid_at|refunded_at|created_at|invoice_id|kitchen_completed_at|verified_by|created_by_waiter_id|kitchen_completed_by|display_name)'
    order by tablename,indexname`,[["order_invoices","orders","order_items","public_order_feedback","restaurant_staff"]]);
  for(const row of indexes.rows) pass("Existing relevant hosted index",`${row.tablename}.${row.indexname}: ${row.indexdef}`);
}

async function main() {
  const mode = process.argv[2] ?? "preflight";
  assert(["preflight", "validate", "test", "deploy", "postflight", "hosted-test"].includes(mode), "Unsupported audit mode");
  const url = connectionUrl();
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  await db.connect();
  try {
    if (mode === "preflight") await preflight(db, url);
    else if (mode === "validate") await validateMigration(db);
    else if (mode === "test") await hostileTests(db,true);
    else if (mode === "deploy") await deployMigration(db,url);
    else if (mode === "postflight") await postflight(db,url);
    else await hostileTests(db,false);
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`FAIL ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
