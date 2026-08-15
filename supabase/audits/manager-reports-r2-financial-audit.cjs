const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, "supabase/connection.env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/237_manager_reports_r2_financial_read_model.sql"),
  "utf8",
);
const db = new Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
const results = [];
const check = (letter, label, ok, detail = "") =>
  results.push({ letter, label, ok: Boolean(ok), detail });
const id = () => crypto.randomUUID();
const amount = (value) => Number(value ?? 0);

async function actorReport(userId, restaurantId, start, end, comparisonStart, comparisonEnd) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  const response = await db.query(
    "select public.get_manager_financial_report($1,$2,$3,$4,$5) report",
    [restaurantId, start, end, comparisonStart, comparisonEnd],
  );
  await db.query("reset role");
  return response.rows[0].report;
}

async function main() {
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  await db.connect();
  await db.query("begin");
  try {
    if (process.env.SERVEFLOW_R2_USE_DEPLOYED !== "1") await db.query(migration);

    const actors = (await db.query(
      "select id from auth.users order by created_at, id limit 5",
    )).rows.map((row) => row.id);
    if (actors.length < 4) throw new Error("Audit requires at least four existing auth users; none are modified.");
    const [managerA, managerB, waiterA, cashierA] = actors;
    const tenantA = id();
    const tenantB = id();
    const suffix = crypto.randomBytes(6).toString("hex");
    await db.query(
      "insert into public.restaurants(id,name,slug) values($1,$2,$3),($4,$5,$6)",
      [tenantA, "R2 Audit Tenant A", `r2-a-${suffix}`, tenantB, "R2 Audit Tenant B", `r2-b-${suffix}`],
    );
    await db.query(
      `insert into public.restaurant_staff(restaurant_id,user_id,role,display_name,active)
       values($1,$2,'manager','Audit Manager A',true),($3,$4,'manager','Audit Manager B',true),
             ($1,$5,'waiter','Audit Waiter',true),($1,$6,'cashier','Audit Cashier',true)`,
      [tenantA, managerA, tenantB, managerB, waiterA, cashierA],
    );

    const currentStart = "2026-08-10T00:00:00Z";
    const currentEnd = "2026-08-11T00:00:00Z";
    const comparisonStart = "2026-08-09T00:00:00Z";
    const comparisonEnd = currentStart;
    const fixtures = [
      { tenant: tenantA, created: "2026-08-10T01:00:00Z", paid: "2026-08-10T02:00:00Z", status: "paid", method: "Cash", total: 100, subtotal: 80, vat: 12, service: 10, discount: 2 },
      { tenant: tenantA, created: "2026-08-10T03:00:00Z", paid: "2026-08-10T04:00:00Z", status: "paid", method: "tele birr", total: 50, subtotal: 45, vat: 5, service: 1, discount: 1 },
      { tenant: tenantA, created: "2026-08-10T05:00:00Z", status: "pending", method: "Cash", total: 30, subtotal: 30, vat: 0, service: 0, discount: 0 },
      { tenant: tenantA, created: "2026-08-10T06:00:00Z", paid: "2026-08-10T06:30:00Z", refunded: "2026-08-10T07:00:00Z", status: "refunded", method: "Cash", total: 40, subtotal: 35, vat: 4, service: 2, discount: 1 },
      { tenant: tenantA, created: "2026-08-10T08:00:00Z", paid: "2026-08-10T09:00:00Z", status: "paid", method: "Cash", total: 20, subtotal: 20, vat: 0, service: 0, discount: 0, legacy: true },
      { tenant: tenantA, created: "2026-08-09T01:00:00Z", paid: "2026-08-09T02:00:00Z", status: "paid", method: "Cash", total: 80, subtotal: 70, vat: 8, service: 3, discount: 1 },
      { tenant: tenantB, created: "2026-08-10T01:00:00Z", paid: "2026-08-10T02:00:00Z", status: "paid", method: "Cash", total: 999, subtotal: 900, vat: 99, service: 0, discount: 0 },
    ];
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index];
      const orderId = id();
      await db.query(
        `insert into public.orders(id,restaurant_id,status,total_price,created_at,customer_name,table_number,payment_method,order_source)
         values($1,$2,'pending',$3,$4,'R2 Audit',$5,$6,'public_qr')`,
        [orderId, fixture.tenant, fixture.total, fixture.created, String(index + 1), fixture.method],
      );
      await db.query(
        `insert into public.order_invoices(
           restaurant_id,order_id,invoice_number,status,payment_status,total_price,grand_total,subtotal,
           vat_rate,vat_amount,service_charge_rate,service_charge_amount,discount_amount,payment_method,
           paid_at,refunded_at,created_at,invoice_source,financial_snapshot_version
         ) values(
           $1,$2,1,$3,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'public_qr',$15
         )`,
        [
          fixture.tenant, orderId, fixture.status, fixture.total, fixture.subtotal,
          fixture.subtotal ? fixture.vat / fixture.subtotal : 0, fixture.vat,
          fixture.subtotal ? fixture.service / fixture.subtotal : 0, fixture.service,
          fixture.discount, fixture.method, fixture.paid ?? null, fixture.refunded ?? null,
          fixture.created, fixture.legacy ? null : "frozen_v1",
        ],
      );
    }

    const report = await actorReport(managerA, tenantA, currentStart, currentEnd, comparisonStart, comparisonEnd);
    const current = report.current;
    const comparison = report.comparison;
    check("A", "Tenant A Manager can access Tenant A report", !report.error);
    check("B", "Tenant B Manager cannot access Tenant A report", (await actorReport(managerB, tenantA, currentStart, currentEnd, comparisonStart, comparisonEnd)).error === "Permission denied.");
    check("C", "Waiter cannot access Manager report", (await actorReport(waiterA, tenantA, currentStart, currentEnd, comparisonStart, comparisonEnd)).error === "Permission denied.");
    check("D", "Cashier cannot access Manager report", (await actorReport(cashierA, tenantA, currentStart, currentEnd, comparisonStart, comparisonEnd)).error === "Permission denied.");
    const customerDenied = (await actorReport(id(), tenantA, currentStart, currentEnd, comparisonStart, comparisonEnd)).error === "Permission denied.";
    const anonAcl = await db.query(
      "select has_function_privilege('anon', 'public.get_manager_financial_report(uuid,timestamptz,timestamptz,timestamptz,timestamptz)', 'execute') allowed",
    );
    check("E", "Customer/public cannot access", customerDenied && anonAcl.rows[0].allowed === false);

    check("F", "Paid cash invoice contributes to collected", amount(current.collected_amount) === 210);
    const telebirr = current.payment_methods.find((row) => row.payment_method === "Telebirr");
    check("G", "Paid Telebirr uses canonical bucket", amount(telebirr?.collected_amount) === 50 && Number(telebirr?.invoice_count) === 1);
    check("H", "Unpaid invoice does not contribute to collected", Number(current.collected_invoice_count) === 4);
    check("I", "Outstanding follows created-in-period current-state contract", amount(current.outstanding_amount) === 30 && Number(current.outstanding_invoice_count) === 1);
    check("J", "Refund is separate and reduces net collection", amount(current.refund_amount) === 40 && amount(current.net_collection) === 170);
    check("K", "Frozen VAT is used", amount(current.vat_amount) === 21 && amount(current.net_vat_amount) === 17);
    check("L", "Legacy VAT quality is explicit", current.data_quality.tax_history === "mixed_legacy");
    check("M", "Frozen discounts and service charges are used", amount(current.discount_amount) === 4 && amount(current.service_charge_amount) === 13);
    check("N", "Orders Created is separate from paid invoice count", Number(current.orders_created) === 5 && Number(current.collected_invoice_count) === 4);
    check("O", "Comparison period is isolated", amount(comparison.collected_amount) === 80 && Number(comparison.orders_created) === 1);
    check("P", "Cross-tenant financial rows never leak", amount(current.collected_amount) !== 1209 && amount(current.collected_amount) === 210);
  } finally {
    await db.query("reset role").catch(() => {});
    await db.query("rollback").catch(() => {});
    await db.end();
  }

  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.letter}. ${result.label}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
  else console.log(
    process.env.SERVEFLOW_R2_USE_DEPLOYED === "1"
      ? "\nPASS: 16/16 R2 hosted checks against deployed migration; synthetic tenant data rolled back."
      : "\nPASS: 16/16 R2 hosted rollback checks; synthetic tenant data and test migration DDL rolled back.",
  );
}

main().catch((error) => {
  console.error(`FAIL audit crashed — ${error.message}`);
  process.exitCode = 1;
});
