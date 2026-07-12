const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const root = path.join(__dirname, "..", "..");
const migrationPath = path.join(root, "supabase", "migrations", "077_phase_p6_payment_verification_architecture.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

function readKeyValueFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      })
  );
}

function readConnectionUrl() {
  const env = readKeyValueFile(path.join(root, "supabase", "connection.env"));
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function readSupabaseEnv() {
  const env = readKeyValueFile(path.join(root, ".env.local"));
  if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local");
  }
  return env;
}

function uuid(label) {
  const chars = crypto.createHash("sha256").update(`serveflow-p6-live-audit-${label}`).digest("hex").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

async function asUser(client, userId, sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const output = await client.query(sql, params);
    await client.query("commit");
    return output;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function expectReject(label, action, pattern) {
  try {
    await action();
    return result(label, false, "unexpected success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result(label, pattern.test(message), message);
  }
}

async function cleanup(client, ids) {
  await client.query("alter table public.cash_reconciliations disable trigger cash_reconciliations_immutable_delete").catch(() => {});
  try {
    for (const table of [
      "receipt_generation_events",
      "shift_activity_logs",
      "cash_reconciliations",
      "cashier_shifts",
      "order_items",
      "order_invoices",
      "orders",
      "menu_items",
      "categories",
      "restaurant_tables",
      "restaurant_staff",
    ]) {
      await client.query(`delete from public.${table} where restaurant_id in ($1, $2)`, [ids.restaurantA, ids.restaurantB]).catch(() => {});
    }
  } finally {
    await client.query("alter table public.cash_reconciliations enable trigger cash_reconciliations_immutable_delete").catch(() => {});
  }
  await client.query("delete from storage.objects where bucket_id = 'payment-screenshots' and name like $1", [`${ids.restaurantA}/%`]).catch(() => {});
  await client.query("delete from public.restaurants where id in ($1, $2) or slug in ('p6-audit-a', 'p6-audit-b')", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from auth.users where id in ($1, $2, $3, $4) or email like 'p6-audit-%@example.test'", [ids.ownerUser, ids.cashierUser, ids.otherOwnerUser, ids.customerUser]).catch(() => {});
}

async function seedBase(client, ids) {
  await client.query(`
    insert into public.restaurants (id, name, slug, security_settings)
    values
      ($1, 'P6 Audit A', 'p6-audit-a', '{"cash_variance_reason_threshold": 0}'::jsonb),
      ($2, 'P6 Audit B', 'p6-audit-b', '{}'::jsonb)
    on conflict (id) do update set name = excluded.name, slug = excluded.slug, security_settings = excluded.security_settings
  `, [ids.restaurantA, ids.restaurantB]);

  await client.query(`
    insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, active)
    values
      ($1, $4, $6, 'owner', 'P6 Owner', true),
      ($2, $4, $7, 'cashier', 'P6 Cashier', true),
      ($3, $5, $8, 'owner', 'P6 Other Owner', true)
    on conflict (id) do update set user_id = excluded.user_id, role = excluded.role, display_name = excluded.display_name, active = excluded.active
  `, [ids.ownerStaff, ids.cashierStaff, ids.otherOwnerStaff, ids.restaurantA, ids.restaurantB, ids.ownerUser, ids.cashierUser, ids.otherOwnerUser]);

  await client.query(`
    insert into public.restaurant_tables (restaurant_id, table_number, label, qr_path, qr_url, active)
    values ($1, 1, 'Table 1', '/r/p6-audit-a/order?table=1', 'https://example.test/r/p6-audit-a/order?table=1', true)
    on conflict (restaurant_id, table_number) do update set label = excluded.label, qr_path = excluded.qr_path, qr_url = excluded.qr_url, active = excluded.active
  `, [ids.restaurantA]);

  await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $2, 'Audit') on conflict (restaurant_id, name) do update set name = excluded.name", [ids.category, ids.restaurantA]);
  await client.query("insert into public.menu_items (id, restaurant_id, category_id, name, price, available) values ($1, $2, $3, 'Verified Batch Item', 10, true) on conflict (id) do update set name = excluded.name, price = excluded.price", [ids.menuItem, ids.restaurantA, ids.category]);
}

async function provisionAuthUsers(serviceClient, ids) {
  const password = "P6-audit-password-1234";
  for (const key of ["owner", "cashier", "otherOwner", "customer"]) {
    const email = `p6-audit-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}@example.test`;
    const { data, error } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    ids[`${key}User`] = data.user.id;
  }
}

async function createSignedInClient(env, email) {
  const password = "P6-audit-password-1234";
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function createOrderBatch(client, ids, orderId, invoiceId, itemId, options = {}) {
  const {
    status = "pending_payment",
    orderTotal = 9999,
    invoiceStatus = "pending",
    invoiceTotal = 100,
    paymentMethod = "Cash",
    invoicePaymentMethod = paymentMethod,
    verifiedAt = null,
    verifiedBy = null,
    kitchenStatus = "held",
    reference = null,
    transaction = null,
  } = options;
  await client.query(`
    insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_at, payment_verified_by, created_at)
    values ($1, $2, null, $3, $4, 'P6 Guest', '1', $5, 'cashier', $6, $7, now())
    on conflict (id) do update set status = excluded.status, total_price = excluded.total_price, payment_method = excluded.payment_method, payment_verified_at = excluded.payment_verified_at, payment_verified_by = excluded.payment_verified_by
  `, [orderId, ids.restaurantA, status, orderTotal, paymentMethod, verifiedAt, verifiedBy]);
  await client.query(`
    insert into public.order_invoices (id, restaurant_id, order_id, invoice_number, status, total_price, payment_method, paid_at, paid_by, verified_at, verified_by, reference_number, transaction_id)
    values ($1, $2, $3, 1, $4, $5, $6, $7, $8, $7, $8, $9, $10)
    on conflict (id) do update set status = excluded.status, total_price = excluded.total_price, payment_method = excluded.payment_method, paid_at = excluded.paid_at, paid_by = excluded.paid_by, verified_at = excluded.verified_at, verified_by = excluded.verified_by, reference_number = excluded.reference_number, transaction_id = excluded.transaction_id
  `, [invoiceId, ids.restaurantA, orderId, invoiceStatus, invoiceTotal, invoicePaymentMethod, verifiedAt, verifiedBy, reference, transaction]);
  await client.query(`
    insert into public.order_items (id, restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, kitchen_status)
    values ($1, $2, $3, $4, $5, 1, $6, $7)
    on conflict (id) do update set invoice_id = excluded.invoice_id, kitchen_status = excluded.kitchen_status, price = excluded.price
  `, [itemId, ids.restaurantA, orderId, invoiceId, ids.menuItem, invoiceTotal, kitchenStatus]);
}

async function main() {
  const ids = {
    ownerUser: uuid("owner-user"),
    cashierUser: uuid("cashier-user"),
    otherOwnerUser: uuid("other-owner-user"),
    customerUser: uuid("customer-user"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    ownerStaff: uuid("owner-staff"),
    cashierStaff: uuid("cashier-staff"),
    otherOwnerStaff: uuid("other-owner-staff"),
    category: uuid("category"),
    menuItem: uuid("menu-item"),
    closeShift: uuid("close-shift"),
    closeOrder: uuid("close-order"),
    closeInvoice: uuid("close-invoice"),
    closeItem: uuid("close-item"),
    receiptOrder: uuid("receipt-order"),
    receiptInvoice: uuid("receipt-invoice"),
    receiptItem: uuid("receipt-item"),
    customerPaidOrder: uuid("customer-paid-order"),
    customerPaidInvoice: uuid("customer-paid-invoice"),
    customerPaidItem: uuid("customer-paid-item"),
    missingInvoiceMethodOrder: uuid("missing-invoice-method-order"),
    missingInvoiceMethodInvoice: uuid("missing-invoice-method-invoice"),
    missingInvoiceMethodItem: uuid("missing-invoice-method-item"),
    dupOrderA: uuid("dup-order-a"),
    dupInvoiceA: uuid("dup-invoice-a"),
    dupItemA: uuid("dup-item-a"),
    dupOrderB: uuid("dup-order-b"),
    dupInvoiceB: uuid("dup-invoice-b"),
    dupItemB: uuid("dup-item-b"),
    reportOrder: uuid("report-order"),
    reportInvoice: uuid("report-invoice"),
    reportItem: uuid("report-item"),
    unverifiedOrder: uuid("unverified-order"),
    unverifiedInvoice: uuid("unverified-invoice"),
    unverifiedItem: uuid("unverified-item"),
  };

  const results = [
    result("Static close_cashier_shift override exists in P6 migration", /create or replace function public\.close_cashier_shift/.test(migration)),
    result("Static close_cashier_shift does not use orders.total_price", !/create or replace function public\.close_cashier_shift[\s\S]*?end;\s*\$\$;/.exec(migration)?.[0].includes("orders.total_price")),
    result("Static receipt event uniqueness exists", /unique \(restaurant_id, invoice_id\)/.test(migration) && /on conflict \(restaurant_id, invoice_id\) do nothing/.test(migration)),
    result("Static duplicate references have unique database guards", /order_invoices_reference_verified_unique_idx/.test(migration) && /order_invoices_transaction_verified_unique_idx/.test(migration)),
    result("Static verify_order_payment accepts paid invoices and promotes verified status", /target_invoice\.status not in \('pending', 'paid'\)/.test(migration) && /status = 'verified'/.test(migration)),
    result("Static verify_order_payment falls back to order payment method", /coalesce\(target_invoice\.payment_method, target_order\.payment_method\)/.test(migration)),
  ];

  const connectionString = readConnectionUrl();
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  const raceA = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  const raceB = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  const supabaseEnv = readSupabaseEnv();
  const supabase = createClient(supabaseEnv.VITE_SUPABASE_URL, supabaseEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let ownerStorage = null;
  let cashierStorage = null;
  let otherOwnerStorage = null;
  const screenshotPath = `${ids.restaurantA}/audit/${ids.receiptInvoice}/screenshot.png`;

  await client.connect();
  try {
    await client.query(migration);
    results.push(result("P6 migration applied to configured development database", true));

    await cleanup(client, ids);
    await provisionAuthUsers(supabase, ids);
    await seedBase(client, ids);
    ownerStorage = await createSignedInClient(supabaseEnv, "p6-audit-owner@example.test");
    cashierStorage = await createSignedInClient(supabaseEnv, "p6-audit-cashier@example.test");
    otherOwnerStorage = await createSignedInClient(supabaseEnv, "p6-audit-other-owner@example.test");

    const closeSource = await client.query("select pg_get_functiondef('public.close_cashier_shift(uuid, numeric, text)'::regprocedure) as source");
    results.push(result("Live close_cashier_shift source excludes orders.total_price", !closeSource.rows[0].source.includes("orders.total_price")));

    const now = new Date().toISOString();
    await client.query(`
      insert into public.cashier_shifts (id, restaurant_id, opened_by, opened_at, opening_cash, notes)
      values ($1, $2, $3, now() - interval '10 minutes', 50, 'P6 close audit')
    `, [ids.closeShift, ids.restaurantA, ids.cashierStaff]);
    await createOrderBatch(client, ids, ids.closeOrder, ids.closeInvoice, ids.closeItem, {
      status: "completed",
      orderTotal: 9999,
      invoiceStatus: "paid",
      invoiceTotal: 125,
      paymentMethod: "Cash",
      verifiedAt: now,
      verifiedBy: ids.cashierStaff,
      kitchenStatus: "completed",
      reference: "P6-CLOSE-REF",
    });
    await client.query("update public.orders set created_at = now() - interval '30 minutes' where id = $1", [ids.closeOrder]);
    const activeShiftSummary = await asUser(client, ids.cashierUser, "select public.get_cashier_shift_summary($1) as summary", [ids.restaurantA]);
    results.push(result(
      "Cashier summary persists verified batches created before shift but verified during shift",
      Number(activeShiftSummary.rows[0].summary.active_shift.cash_collected) === 125 &&
        Number(activeShiftSummary.rows[0].summary.active_shift.payments_processed) === 1,
      JSON.stringify(activeShiftSummary.rows[0].summary.active_shift)
    ));
    const closed = await asUser(client, ids.cashierUser, "select public.close_cashier_shift($1, 175, null) as payload", [ids.closeShift]);
    const reconciliation = await client.query("select cash_payments, expected_cash, variance from public.cash_reconciliations where shift_id = $1", [ids.closeShift]);
    results.push(result(
      "Cash drawer close uses verified payment batch total only",
      Number(reconciliation.rows[0].cash_payments) === 125 && Number(reconciliation.rows[0].expected_cash) === 175 && Number(reconciliation.rows[0].variance) === 0,
      JSON.stringify({ returned_expected_cash: closed.rows[0].payload.shift.expected_cash, reconciliation: reconciliation.rows[0] })
    ));

    await createOrderBatch(client, ids, ids.receiptOrder, ids.receiptInvoice, ids.receiptItem, {
      status: "pending_payment",
      orderTotal: 5000,
      invoiceStatus: "pending",
      invoiceTotal: 77,
      paymentMethod: "Cash",
      kitchenStatus: "held",
    });
    await asUser(client, ids.cashierUser, "select public.verify_order_payment($1, 'P6-RECEIPT-REF', null, null, false)", [ids.receiptInvoice]);
    const secondReceiptAttempt = await expectReject(
      "Second approval is rejected after first verification",
      () => asUser(client, ids.cashierUser, "select public.verify_order_payment($1, 'P6-RECEIPT-REF', null, null, false)", [ids.receiptInvoice]),
      /Only pending or paid payments may be verified/
    );
    results.push(secondReceiptAttempt);
    const receiptEvents = await client.query("select count(*)::int as count from public.receipt_generation_events where invoice_id = $1", [ids.receiptInvoice]);
    results.push(result("Receipt generation event is idempotent per invoice", receiptEvents.rows[0].count === 1, JSON.stringify(receiptEvents.rows[0])));

    await createOrderBatch(client, ids, ids.customerPaidOrder, ids.customerPaidInvoice, ids.customerPaidItem, {
      status: "pending_payment",
      invoiceStatus: "paid",
      invoiceTotal: 66,
      paymentMethod: "Telebirr",
      verifiedAt: null,
      verifiedBy: null,
      kitchenStatus: "held",
      reference: "P6-CUSTOMER-PAID-REF",
    });
    const paidQueueBefore = await asUser(client, ids.cashierUser, "select invoice_status from public.get_cashier_invoice_queue($1) where invoice_id = $2", [ids.restaurantA, ids.customerPaidInvoice]);
    await asUser(client, ids.cashierUser, "select public.verify_order_payment($1, 'P6-CUSTOMER-PAID-VERIFIED', null, null, false)", [ids.customerPaidInvoice]);
    const paidInvoiceAfter = await client.query("select status, verified_at, verified_by from public.order_invoices where id = $1", [ids.customerPaidInvoice]);
    const paidQueueAfter = await asUser(client, ids.cashierUser, "select invoice_status from public.get_cashier_invoice_queue($1) where invoice_id = $2", [ids.restaurantA, ids.customerPaidInvoice]);
    results.push(result(
      "Cashier can verify payment after customer or waiter marked invoice paid",
      paidQueueBefore.rows[0]?.invoice_status === "paid" &&
        paidInvoiceAfter.rows[0]?.status === "verified" &&
        paidInvoiceAfter.rows[0]?.verified_at &&
        paidInvoiceAfter.rows[0]?.verified_by === ids.cashierStaff &&
        paidQueueAfter.rows[0]?.invoice_status === "verified",
      JSON.stringify({ before: paidQueueBefore.rows[0], after: paidInvoiceAfter.rows[0], queue_after: paidQueueAfter.rows[0] })
    ));

    await createOrderBatch(client, ids, ids.missingInvoiceMethodOrder, ids.missingInvoiceMethodInvoice, ids.missingInvoiceMethodItem, {
      status: "pending_payment",
      invoiceStatus: "pending",
      invoiceTotal: 88,
      paymentMethod: "Cash",
      invoicePaymentMethod: null,
      kitchenStatus: "held",
    });
    const missingMethodQueueBefore = await asUser(client, ids.cashierUser, "select invoice_status, payment_method from public.get_cashier_invoice_queue($1) where invoice_id = $2", [ids.restaurantA, ids.missingInvoiceMethodInvoice]);
    await asUser(client, ids.cashierUser, "select public.verify_order_payment($1, null, null, null, false)", [ids.missingInvoiceMethodInvoice]);
    const missingMethodAfter = await client.query("select status, payment_method, verified_at, verified_by from public.order_invoices where id = $1", [ids.missingInvoiceMethodInvoice]);
    results.push(result(
      "Cashier can verify waiter-style invoice with method inherited from order",
      missingMethodQueueBefore.rows[0]?.invoice_status === "pending" &&
        missingMethodQueueBefore.rows[0]?.payment_method === "Cash" &&
        missingMethodAfter.rows[0]?.status === "verified" &&
        missingMethodAfter.rows[0]?.payment_method === "Cash" &&
        missingMethodAfter.rows[0]?.verified_at &&
        missingMethodAfter.rows[0]?.verified_by === ids.cashierStaff,
      JSON.stringify({ before: missingMethodQueueBefore.rows[0], after: missingMethodAfter.rows[0] })
    ));

    await createOrderBatch(client, ids, ids.dupOrderA, ids.dupInvoiceA, ids.dupItemA, { status: "pending_payment", invoiceStatus: "pending", invoiceTotal: 31, paymentMethod: "Telebirr" });
    await createOrderBatch(client, ids, ids.dupOrderB, ids.dupInvoiceB, ids.dupItemB, { status: "pending_payment", invoiceStatus: "pending", invoiceTotal: 32, paymentMethod: "Telebirr" });
    await raceA.connect();
    await raceB.connect();
    const duplicateRace = await Promise.allSettled([
      asUser(raceA, ids.cashierUser, "select public.verify_order_payment($1, 'P6-DUP-RACE', null, null, false)", [ids.dupInvoiceA]),
      asUser(raceB, ids.cashierUser, "select public.verify_order_payment($1, 'P6-DUP-RACE', null, null, false)", [ids.dupInvoiceB]),
    ]);
    const duplicatePaid = await client.query("select count(*)::int as count from public.order_invoices where restaurant_id = $1 and reference_number = 'P6-DUP-RACE' and status in ('paid', 'verified')", [ids.restaurantA]);
    results.push(result(
      "Concurrent duplicate transaction references allow only one approval",
      duplicateRace.filter((entry) => entry.status === "fulfilled").length === 1 && duplicatePaid.rows[0].count === 1,
      duplicateRace.map((entry) => entry.status === "fulfilled" ? "approved" : entry.reason.message).join(" | ")
    ));

    await createOrderBatch(client, ids, ids.reportOrder, ids.reportInvoice, ids.reportItem, {
      status: "completed",
      orderTotal: 9999,
      invoiceStatus: "paid",
      invoiceTotal: 210,
      paymentMethod: "Telebirr",
      verifiedAt: now,
      verifiedBy: ids.cashierStaff,
      kitchenStatus: "completed",
      reference: "P6-REPORT-REF",
    });
    await createOrderBatch(client, ids, ids.unverifiedOrder, ids.unverifiedInvoice, ids.unverifiedItem, {
      status: "pending_payment",
      orderTotal: 8888,
      invoiceStatus: "pending",
      invoiceTotal: 8888,
      paymentMethod: "Cash",
      kitchenStatus: "held",
    });
    const reportPayload = await asUser(
      client,
      ids.ownerUser,
      "select public.get_owner_reporting_center($1, now() - interval '1 day', now() + interval '1 day') as report",
      [ids.restaurantA]
    );
    const report = reportPayload.rows[0].report;
    const verifiedRevenue = await client.query(
      "select coalesce(sum(total_price), 0)::numeric as revenue from public.order_invoices where restaurant_id = $1 and status in ('paid', 'verified') and verified_at >= now() - interval '1 day' and verified_at < now() + interval '1 day'",
      [ids.restaurantA]
    );
    const verifiedRevenueTotal = Number(verifiedRevenue.rows[0].revenue);
    results.push(result(
      "Owner reporting revenue is verified payment batches only",
      Number(report.summary.revenue) === verifiedRevenueTotal &&
        Number(report.summary.revenue) !== 9999 &&
        Number(report.summary.revenue) !== 8888,
      JSON.stringify({ summary: report.summary, verifiedRevenue: verifiedRevenueTotal })
    ));
    results.push(result(
      "Owner analytics/export sections are verified-batch based",
      report.sales_by_day.length > 0 &&
        report.payment_methods.every((row) => Number(row.revenue) <= verifiedRevenueTotal) &&
        report.menu_performance.every((row) => Number(row.revenue) <= verifiedRevenueTotal) &&
        report.table_usage.every((row) => Number(row.revenue) <= verifiedRevenueTotal) &&
        report.customers.every((row) => Number(row.revenue) <= verifiedRevenueTotal),
      JSON.stringify({ payment_methods: report.payment_methods, table_usage: report.table_usage })
    ));

    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000150a0f5b80000000049454e44ae426082", "hex");
    await supabase.storage.from("payment-screenshots").remove([screenshotPath]).catch(() => {});
    const upload = await cashierStorage.storage.from("payment-screenshots").upload(screenshotPath, png, { contentType: "image/png", upsert: true });
    results.push(result("Payment screenshot upload succeeds in private bucket", !upload.error, upload.error?.message ?? screenshotPath));
    const signed = await ownerStorage.storage.from("payment-screenshots").createSignedUrl(screenshotPath, 60);
    results.push(result("Payment screenshot signed preview succeeds", Boolean(signed.data?.signedUrl) && !signed.error, signed.error?.message ?? "signed URL created"));
    const bucket = await client.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'payment-screenshots'");
    results.push(result(
      "Payment screenshot file validation is configured",
      bucket.rowCount === 1 &&
        bucket.rows[0].public === false &&
        Number(bucket.rows[0].file_size_limit) === 5242880 &&
        bucket.rows[0].allowed_mime_types.includes("image/png") &&
        bucket.rows[0].allowed_mime_types.includes("image/jpeg"),
      JSON.stringify(bucket.rows[0])
    ));
    const sameRestaurantRead = await asUser(client, ids.ownerUser, "select count(*)::int as count from storage.objects where bucket_id = 'payment-screenshots' and name = $1", [screenshotPath]);
    const otherRestaurantRead = await asUser(client, ids.otherOwnerUser, "select count(*)::int as count from storage.objects where bucket_id = 'payment-screenshots' and name = $1", [screenshotPath]);
    const otherSigned = await otherOwnerStorage.storage.from("payment-screenshots").createSignedUrl(screenshotPath, 60);
    results.push(result("Payment screenshot restaurant isolation enforced", sameRestaurantRead.rows[0].count === 1 && otherRestaurantRead.rows[0].count === 0 && Boolean(otherSigned.error), otherSigned.error?.message ?? ""));
    const invalidUpload = await cashierStorage.storage.from("payment-screenshots").upload("not-a-restaurant/file.png", png, { contentType: "image/png", upsert: true });
    results.push(result("Payment screenshot invalid path is rejected", Boolean(invalidUpload.error), invalidUpload.error?.message ?? "unexpected success"));
    const cashierDelete = await cashierStorage.storage.from("payment-screenshots").remove([screenshotPath]);
    const afterCashierDelete = await client.query("select count(*)::int as count from storage.objects where bucket_id = 'payment-screenshots' and name = $1", [screenshotPath]);
    results.push(result("Payment screenshot cleanup denies cashier delete", afterCashierDelete.rows[0].count === 1, cashierDelete.error?.message ?? JSON.stringify(cashierDelete.data)));
    const ownerDelete = await ownerStorage.storage.from("payment-screenshots").remove([screenshotPath]);
    results.push(result("Payment screenshot cleanup permits owner delete", !ownerDelete.error, ownerDelete.error?.message ?? "owner removed object"));
    const afterOwnerDelete = await client.query("select count(*)::int as count from storage.objects where bucket_id = 'payment-screenshots' and name = $1", [screenshotPath]);
    results.push(result("Payment screenshot cleanup removed storage object", afterOwnerDelete.rows[0].count === 0));
    await supabase.storage.from("payment-screenshots").remove([screenshotPath]).catch(() => {});
  } catch (error) {
    results.push(result("Live P6 audit completed without uncaught error", false, error instanceof Error ? error.stack || error.message : String(error)));
  } finally {
    await raceA.end().catch(() => {});
    await raceB.end().catch(() => {});
    await cleanup(client, ids).catch(() => {});
    await client.end();
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}${entry.detail ? `: ${entry.detail}` : ""}`);
  }
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
