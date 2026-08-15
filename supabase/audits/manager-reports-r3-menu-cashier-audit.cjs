const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, "supabase/connection.env"), "utf8")
    .split(/\r?\n/).filter((line) => line.includes("="))
    .map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const migration = fs.readFileSync(path.join(root, "supabase/migrations/238_manager_reports_r3_menu_cashier.sql"), "utf8");
const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const id = () => crypto.randomUUID();
const amount = (value) => Number(value ?? 0);
const results = [];
const check = (letter, label, ok, detail = "") => results.push({ letter, label, ok: Boolean(ok), detail });

async function asActor(userId, functionName, args) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  const response = await db.query(`select public.${functionName}(${placeholders}) report`, args);
  await db.query("reset role");
  return response.rows[0].report;
}

async function insertOrder({ tenant, createdAt, status = "pending", method = "Cash", total = 0, tableNumber, completedBy = null }) {
  const orderId = id();
  await db.query(
    `insert into public.orders(id,restaurant_id,status,total_price,created_at,customer_name,table_number,payment_method,order_source,completed_by,completed_at)
     values($1,$2,$3,$4,$5,'R3 Audit',$6,$7,'cashier',$8,case when $8::uuid is null then null else $5::timestamptz end)`,
    [orderId, tenant, status, total, createdAt, tableNumber, method, completedBy],
  );
  return orderId;
}

async function insertInvoice({ tenant, orderId, number, status = "paid", method = "Cash", total, createdAt, paidAt = null, shiftId = null }) {
  const invoiceId = id();
  await db.query(
    `insert into public.order_invoices(
       id,restaurant_id,order_id,invoice_number,status,payment_status,total_price,grand_total,subtotal,
       vat_rate,vat_amount,service_charge_rate,service_charge_amount,discount_amount,payment_method,
       paid_at,created_at,invoice_source,cashier_shift_id,financial_snapshot_version
     ) values($1,$2,$3,$4,$5,$5,$6,$6,$6,0,0,0,0,0,$7,$8,$9,'public_qr',$10,'frozen_v1')`,
    [invoiceId, tenant, orderId, number, status, total, method, paidAt, createdAt, shiftId],
  );
  return invoiceId;
}

async function main() {
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  await db.connect();
  await db.query("begin");
  try {
    if (process.env.SERVEFLOW_R3_USE_DEPLOYED !== "1") await db.query(migration);
    const users = (await db.query("select id from auth.users order by created_at,id limit 4")).rows.map((row) => row.id);
    if (users.length < 4) throw new Error("Audit requires four existing auth users; none are modified.");
    const [managerA, managerB, waiterA, cashierA] = users;
    const tenantA = id();
    const tenantB = id();
    const suffix = crypto.randomBytes(6).toString("hex");
    await db.query(
      "insert into public.restaurants(id,name,slug) values($1,'R3 Audit Tenant A',$2),($3,'R3 Audit Tenant B',$4)",
      [tenantA, `r3-a-${suffix}`, tenantB, `r3-b-${suffix}`],
    );
    const staff = (await db.query(
      `insert into public.restaurant_staff(restaurant_id,user_id,role,display_name,active)
       values($1,$2,'manager','Audit Manager A',true),($3,$4,'manager','Audit Manager B',true),
             ($1,$5,'waiter','Audit Waiter',true),($1,$6,'cashier','Hana Cashier',true),
             ($1,$4,'cashier','Kadir Cashier',true)
       returning id,restaurant_id,user_id,role::text,display_name`,
      [tenantA, managerA, tenantB, managerB, waiterA, cashierA],
    )).rows;
    const managerStaff = staff.find((row) => row.restaurant_id === tenantA && row.role === "manager");
    const hana = staff.find((row) => row.restaurant_id === tenantA && row.display_name === "Hana Cashier");
    const kadir = staff.find((row) => row.restaurant_id === tenantA && row.display_name === "Kadir Cashier");

    const drinks = id();
    const food = id();
    await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'Drinks'),($3,$2,'Food')", [drinks, tenantA, food]);
    const station = id();
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name,priority,active) values($1,$2,'Main Kitchen',1,true)", [station, tenantA]);
    const coffee = id();
    const burger = id();
    const pizza = id();
    const soda = id();
    await db.query(
      `insert into public.menu_items(id,restaurant_id,category_id,name,price,available,kitchen_station_id)
       values($1,$2,$3,'Coffee',99,true,$8),($4,$2,$5,'Burger',999,true,$8),
             ($6,$2,$5,'Pizza',1000,true,$8),($7,$2,$3,'Soda',50,false,$8)`,
      [coffee, tenantA, drinks, burger, food, pizza, soda, station],
    );

    const currentStart = "2026-08-10T00:00:00Z";
    const currentEnd = "2026-08-11T00:00:00Z";
    const comparisonStart = "2026-08-09T00:00:00Z";
    const comparisonEnd = currentStart;
    const currentOrderOne = await insertOrder({ tenant: tenantA, createdAt: "2026-08-10T01:00:00Z", total: 90, tableNumber: "1", completedBy: hana.id });
    const currentInvoiceOne = await insertInvoice({ tenant: tenantA, orderId: currentOrderOne, number: 1, total: 90, createdAt: "2026-08-10T01:00:00Z", paidAt: "2026-08-10T02:00:00Z" });
    await db.query(
      `insert into public.order_items(restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status)
       values($1,$2,$3,$4,3,10,'completed'),($1,$2,$3,$5,2,30,'completed')`,
      [tenantA, currentOrderOne, currentInvoiceOne, coffee, burger],
    );
    const currentOrderTwo = await insertOrder({ tenant: tenantA, createdAt: "2026-08-10T03:00:00Z", total: 10, tableNumber: "2", completedBy: hana.id });
    const currentInvoiceTwo = await insertInvoice({ tenant: tenantA, orderId: currentOrderTwo, number: 1, total: 10, createdAt: "2026-08-10T03:00:00Z", paidAt: "2026-08-10T04:00:00Z" });
    await db.query("insert into public.order_items(restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status) values($1,$2,$3,$4,1,10,'completed')", [tenantA, currentOrderTwo, currentInvoiceTwo, coffee]);
    const cancelledOrder = await insertOrder({ tenant: tenantA, createdAt: "2026-08-10T05:00:00Z", total: 1000, tableNumber: "3" });
    const cancelledInvoice = await insertInvoice({ tenant: tenantA, orderId: cancelledOrder, number: 1, total: 1000, createdAt: "2026-08-10T05:00:00Z", paidAt: "2026-08-10T06:00:00Z" });
    const cancelledItem = id();
    await db.query("insert into public.order_items(id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status) values($1,$2,$3,$4,$5,10,100,'held')", [cancelledItem, tenantA, cancelledOrder, cancelledInvoice, pizza]);
    const cancellationRequest = id();
    await db.query(
      `insert into public.order_cancellation_requests(
         id,restaurant_id,order_id,order_item_id,request_scope,requested_by_staff_id,requested_by_user_id,
         reason,current_order_status,current_kitchen_status,current_payment_status,status
       ) values($1,$2,$3,$4,'item',$5,$6,'Wrong item entered','pending','held','paid','pending_review')`,
      [cancellationRequest, tenantA, cancelledOrder, cancelledItem, staff.find((row) => row.role === "waiter").id, waiterA],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [cashierA]);
    const cancelledUpdate = await db.query(
      "update public.order_items set kitchen_status='cancelled',cancellation_request_id=$1,cancelled_at='2026-08-10T06:30:00Z',cancelled_by_staff_id=$2 where id=$3",
      [cancellationRequest, hana.id, cancelledItem],
    );
    if (cancelledUpdate.rowCount !== 1) throw new Error("Cancelled item fixture was not updated.");
    const unpaidOrder = await insertOrder({ tenant: tenantA, createdAt: "2026-08-10T07:00:00Z", total: 250, tableNumber: "4", completedBy: hana.id });
    const unpaidInvoice = await insertInvoice({ tenant: tenantA, orderId: unpaidOrder, number: 1, status: "pending", total: 250, createdAt: "2026-08-10T07:00:00Z" });
    await db.query("insert into public.order_items(restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status) values($1,$2,$3,$4,5,50,'completed')", [tenantA, unpaidOrder, unpaidInvoice, soda]);
    const comparisonOrder = await insertOrder({ tenant: tenantA, createdAt: "2026-08-09T01:00:00Z", total: 20, tableNumber: "5", completedBy: hana.id });
    const comparisonInvoice = await insertInvoice({ tenant: tenantA, orderId: comparisonOrder, number: 1, total: 20, createdAt: "2026-08-09T01:00:00Z", paidAt: "2026-08-09T02:00:00Z" });
    await db.query("insert into public.order_items(restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status) values($1,$2,$3,$4,2,10,'completed')", [tenantA, comparisonOrder, comparisonInvoice, coffee]);

    const closedShift = id();
    const openShift = id();
    await db.query(
      `insert into public.cashier_shifts(id,restaurant_id,opened_by,closed_by,opened_at,closed_at,opening_cash,expected_cash,actual_cash,variance,variance_reason)
       values($1,$2,$3,$3,'2026-08-10T01:00:00Z','2026-08-10T10:00:00Z',100,230,220,-10,'Drawer short'),
             ($4,$2,$5,null,'2026-08-10T12:00:00Z',null,50,null,null,null,null)`,
      [closedShift, tenantA, hana.id, openShift, kadir.id],
    );
    const cashOrder = await insertOrder({ tenant: tenantA, createdAt: "2026-08-10T02:00:00Z", total: 150, tableNumber: "6" });
    await insertInvoice({ tenant: tenantA, orderId: cashOrder, number: 1, total: 150, createdAt: "2026-08-10T02:00:00Z", paidAt: "2026-08-10T02:30:00Z", shiftId: closedShift });
    const digitalOrder = await insertOrder({ tenant: tenantA, createdAt: "2026-08-10T03:00:00Z", method: "Telebirr", total: 100, tableNumber: "7" });
    await insertInvoice({ tenant: tenantA, orderId: digitalOrder, number: 1, method: "Telebirr", total: 100, createdAt: "2026-08-10T03:00:00Z", paidAt: "2026-08-10T03:30:00Z", shiftId: closedShift });
    await db.query(
      `insert into public.cashier_shift_expenses(restaurant_id,shift_id,cashier_staff_id,created_by,amount,reason,note,status,reviewed_by,reviewed_at,created_at)
       values($1,$2,$3,$3,20,'Ice purchase','Emergency ice','approved',$4,'2026-08-10T05:00:00Z','2026-08-10T04:00:00Z')`,
      [tenantA, closedShift, hana.id, managerStaff.id],
    );
    await db.query(
      `insert into public.cash_reconciliations(restaurant_id,shift_id,closed_by,opening_cash,cash_payments,cash_refunds,expected_cash,actual_cash,variance,variance_reason,closed_at,created_at)
       values($1,$2,$3,100,150,0,230,220,-10,'Drawer short','2026-08-10T10:00:00Z','2026-08-10T10:00:00Z')`,
      [tenantA, closedShift, hana.id],
    );
    await db.query(
      `insert into public.cashier_cash_handovers(restaurant_id,outgoing_shift_id,incoming_shift_id,outgoing_cashier_id,incoming_cashier_id,expected_amount,declared_amount,received_amount,difference,status,initiated_at,confirmed_at,outgoing_note,incoming_note)
       values($1,$2,$3,$4,$5,230,225,220,-10,'discrepancy','2026-08-10T09:00:00Z','2026-08-10T09:30:00Z','Counted before handover','Received short by 10')`,
      [tenantA, closedShift, openShift, hana.id, kadir.id],
    );
    await db.query(
      `insert into public.shift_activity_logs(restaurant_id,shift_id,actor_staff_id,action,message,amount,created_at)
       values($1,$2,$3,'shift_closed','Audit shift closed',220,'2026-08-10T10:00:00Z'),
             ($1,$4,$5,'shift_opened','Audit shift opened',50,'2026-08-10T12:00:00Z')`,
      [tenantA, closedShift, hana.id, openShift, kadir.id],
    );

    const menuArgs = [tenantA, currentStart, currentEnd, comparisonStart, comparisonEnd];
    const cashierArgs = [tenantA, currentStart, currentEnd];
    const menuReport = await asActor(managerA, "get_manager_menu_performance_report", menuArgs);
    const cashierReport = await asActor(managerA, "get_manager_cashier_period_report", cashierArgs);
    const coffeeRow = menuReport.items.find((row) => row.menu_item_id === coffee);
    const burgerRow = menuReport.items.find((row) => row.menu_item_id === burger);
    const pizzaRow = menuReport.items.find((row) => row.menu_item_id === pizza);
    const sodaRow = menuReport.items.find((row) => row.menu_item_id === soda);
    check("A", "Tenant A Manager retrieves Tenant A menu report", !menuReport.error);
    check("B", "Tenant B Manager cannot retrieve Tenant A menu report", (await asActor(managerB, "get_manager_menu_performance_report", menuArgs)).error === "Permission denied.");
    const waiterMenuDenied = (await asActor(waiterA, "get_manager_menu_performance_report", menuArgs)).error === "Permission denied.";
    const cashierReportsDenied = (await asActor(cashierA, "get_manager_cashier_period_report", cashierArgs)).error === "Permission denied.";
    const customerMenuDenied = (await asActor(id(), "get_manager_menu_performance_report", menuArgs)).error === "Permission denied.";
    check("C", "Waiter, cashier, and customer are denied Manager report RPCs", waiterMenuDenied && cashierReportsDenied && customerMenuDenied);
    check("D", "Paid completed items contribute", coffeeRow.current_quantity === 4 && amount(coffeeRow.current_sales) === 40);
    check("E", "Cancelled and unpaid items do not contribute", pizzaRow.current_quantity === 0 && sodaRow.current_quantity === 0, `pizza=${pizzaRow.current_quantity}, soda=${sodaRow.current_quantity}`);
    check("F", "Quantity ranking is correct", menuReport.top_by_quantity[0].menu_item_id === coffee, `top=${menuReport.top_by_quantity[0]?.menu_item_name}:${menuReport.top_by_quantity[0]?.current_quantity}`);
    check("G", "Revenue ranking is separate and correct", menuReport.top_by_sales[0].menu_item_id === burger, `top=${menuReport.top_by_sales[0]?.menu_item_name}:${menuReport.top_by_sales[0]?.current_sales}`);
    check("H", "Distinct-order count is correct", coffeeRow.current_orders === 2 && burgerRow.current_orders === 1);
    check("I", "Comparison period is isolated", coffeeRow.comparison_quantity === 2 && amount(coffeeRow.comparison_sales) === 20);
    check("J", "Zero-sale handling makes no availability-history claim", menuReport.availability_history_available === false && menuReport.data_quality.availability_history_quality === "unavailable");
    check("K", "Tenant A Manager retrieves cashier period report", !cashierReport.error && cashierReport.shifts.length === 2);
    check("L", "Tenant B Manager cannot retrieve Tenant A cashier report", (await asActor(managerB, "get_manager_cashier_period_report", cashierArgs)).error === "Permission denied.");
    const closed = cashierReport.shifts.find((row) => row.id === closedShift);
    const open = cashierReport.shifts.find((row) => row.id === openShift);
    check("M", "Opening cash is retained", amount(closed.opening_cash) === 100);
    check("N", "Cash-only drawer amount is correct", amount(closed.cash_sales) === 150);
    check("O", "Digital payment is excluded from drawer cash", amount(closed.non_cash_sales) === 100 && amount(closed.expected_cash) === 230);
    check("P", "Approved expenses are correct", amount(closed.approved_expenses) === 20);
    check("Q", "Expense reason and accountability are retained", cashierReport.expenses[0].reason === "Ice purchase" && cashierReport.expenses[0].recorded_by_name === "Hana Cashier");
    const handover = cashierReport.handovers[0];
    check("R", "Handover identities and amounts are correct", handover.outgoing_name === "Hana Cashier" && handover.incoming_name === "Kadir Cashier" && amount(handover.expected_amount) === 230 && amount(handover.received_amount) === 220);
    check("S", "Handover discrepancy remains explicit", amount(handover.difference) === -10 && handover.status === "discrepancy" && handover.incoming_note === "Received short by 10");
    check("T", "Reconciliation variance uses immutable truth", amount(closed.actual_cash) === 220 && amount(closed.variance) === -10 && closed.reconciliation_status === "reconciled");
    check("U", "Open shift remains open and unreconciled", open.status === "open" && open.reconciliation_status === "not_yet_reconciled" && open.actual_cash == null && open.variance == null);

    const anonAcl = await db.query(
      `select
        has_function_privilege('anon','public.get_manager_menu_performance_report(uuid,timestamptz,timestamptz,timestamptz,timestamptz)','execute') menu_allowed,
        has_function_privilege('anon','public.get_manager_cashier_period_report(uuid,timestamptz,timestamptz)','execute') cashier_allowed`,
    );
    if (anonAcl.rows[0].menu_allowed || anonAcl.rows[0].cashier_allowed) throw new Error("Anonymous execute grant detected.");
  } finally {
    await db.query("reset role").catch(() => {});
    await db.query("rollback").catch(() => {});
    await db.end();
  }

  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.letter}. ${result.label}${result.detail ? ` — ${result.detail}` : ""}`);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
  else console.log(
    process.env.SERVEFLOW_R3_USE_DEPLOYED === "1"
      ? "\nPASS: 21/21 R3 hosted checks against deployed migration; synthetic tenants and records rolled back."
      : "\nPASS: 21/21 R3 hosted rollback checks; synthetic tenants, records, and migration 238 DDL rolled back.",
  );
}

main().catch((error) => {
  console.error(`FAIL audit crashed — ${error.message}`);
  process.exitCode = 1;
});
