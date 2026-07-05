const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

function readKeyValueFile(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      })
  );
}

function readConnectionUrl() {
  const env = readKeyValueFile(path.join(__dirname, "connection.env"));
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-invoice-billing-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

async function asRole(client, role, userId, sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local row_security = on");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    if (userId) await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const queryResult = await client.query(sql, params);
    await client.query("commit");
    return queryResult;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function cleanup(client, ids) {
  const restaurants = [ids.restaurantA, ids.restaurantB];
  await client.query("delete from public.kitchen_order_station_progress where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_invoices where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cashier_shifts where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('invoice-billing-a','invoice-billing-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'invoice-billing-%@example.test'").catch(() => {});
}

function itemNames(rows) {
  return rows.flatMap((row) => row.items ?? []).map((item) => item.menu_item_name).sort();
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    kitchenA: uuid("kitchen-a"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    staffKitchenA: uuid("staff-kitchen-a"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    stationA: uuid("station-a"),
    stationB: uuid("station-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    tableA: uuid("table-a"),
    tableB: uuid("table-b"),
    qrTokenA: uuid("qr-token-a"),
    qrTokenB: uuid("qr-token-b"),
    pizza: uuid("pizza"),
    coffee: uuid("coffee"),
    tenantItem: uuid("tenant-item"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "053_invoice_based_billing.sql"), "utf8"));
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invoice-billing-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invoice-billing-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invoice-billing-cashier-a@example.test', '', now(), now(), now()),
        ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invoice-billing-kitchen-a@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA, ids.kitchenA]);

    await client.query("insert into public.restaurants (id, name, slug, total_tables, table_count) values ($1, 'Invoice Billing A', 'invoice-billing-a', 4, 4), ($2, 'Invoice Billing B', 'invoice-billing-b', 4, 4)", [ids.restaurantA, ids.restaurantB]);
    await client.query("insert into public.kitchen_stations (id, restaurant_id, name, priority, active) values ($1, $3, 'Main Kitchen', 1, true), ($2, $4, 'Tenant Kitchen', 1, true)", [ids.stationA, ids.stationB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active, assigned_kitchen_station_id)
      values
        ($1, $5, $7, 'owner', 'Owner A', 'invoice-billing-owner-a@example.test', true, null),
        ($2, $6, $8, 'owner', 'Owner B', 'invoice-billing-owner-b@example.test', true, null),
        ($3, $5, $9, 'cashier', 'Cashier A', 'invoice-billing-cashier-a@example.test', true, null),
        ($4, $5, $10, 'kitchen', 'Kitchen A', 'invoice-billing-kitchen-a@example.test', true, $11)
    `, [ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.staffKitchenA, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA, ids.kitchenA, ids.stationA]);
    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $3, 'Menu'), ($2, $4, 'Menu')", [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query("insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active) values ($1, $3, 5, 'Table 5', $5, '/r/invoice-billing-a?t=5', '/r/invoice-billing-a?t=5', true), ($2, $4, 5, 'Table 5', $6, '/r/invoice-billing-b?t=5', '/r/invoice-billing-b?t=5', true)", [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, ids.qrTokenA, ids.qrTokenB]);
    await asRole(client, "authenticated", ids.ownerA, "insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id) values ($1, $3, $4, 'Pizza', 400, true, $5), ($2, $3, $4, 'Coffee', 100, true, $5)", [ids.pizza, ids.coffee, ids.restaurantA, ids.categoryA, ids.stationA]);
    await asRole(client, "authenticated", ids.ownerB, "insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id) values ($1, $2, $3, 'Tenant Item', 10, true, $4)", [ids.tenantItem, ids.restaurantB, ids.categoryB, ids.stationB]);
    await asRole(client, "authenticated", ids.cashierA, "select public.open_cashier_shift($1, 0, null)", [ids.restaurantA]);

    const first = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '5', $2, 'Ada', 'Cash', $3::jsonb) as order", ["invoice-billing-a", ids.qrTokenA, JSON.stringify([{ menu_item_id: ids.pizza, quantity: 1 }])]);
    const firstOrder = first.rows[0].order;
    results.push(result("First order creates pending invoice", firstOrder.invoice_number === 1 && firstOrder.invoice_status === "pending", JSON.stringify(firstOrder)));

    const heldItems = await client.query("select kitchen_status from public.order_items where restaurant_id = $1 and order_id = $2", [ids.restaurantA, firstOrder.order_id]);
    results.push(result("Unpaid items held from kitchen", heldItems.rowCount === 1 && heldItems.rows[0].kitchen_status === "held", JSON.stringify(heldItems.rows)));

    const emptyKitchen = await asRole(client, "authenticated", ids.kitchenA, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("Kitchen receives nothing before payment", emptyKitchen.rowCount === 0, JSON.stringify(emptyKitchen.rows)));

    await asRole(client, "authenticated", ids.cashierA, "select public.approve_order_payment($1)", [firstOrder.order_id]);
    const paidFirst = await client.query("select invoice_number, status, locked_at is not null as locked from public.order_invoices where restaurant_id = $1 and order_id = $2 order by invoice_number", [ids.restaurantA, firstOrder.order_id]);
    results.push(result("Payment locks invoice 1", paidFirst.rowCount === 1 && paidFirst.rows[0].status === "paid" && paidFirst.rows[0].locked, JSON.stringify(paidFirst.rows)));

    const pizzaKitchen = await asRole(client, "authenticated", ids.kitchenA, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("Paid invoice releases Pizza to kitchen", pizzaKitchen.rowCount === 1 && JSON.stringify(itemNames(pizzaKitchen.rows)) === JSON.stringify(["Pizza"]), JSON.stringify(pizzaKitchen.rows.map((row) => ({ status: row.status, items: itemNames([row]) })))));

    const second = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '5', $2, 'Ada', 'Cash', $3::jsonb) as order", ["invoice-billing-a", ids.qrTokenA, JSON.stringify([{ menu_item_id: ids.coffee, quantity: 1 }])]);
    const secondOrder = second.rows[0].order;
    results.push(result("Post-payment addition creates invoice 2 pending", secondOrder.order_id === firstOrder.order_id && secondOrder.invoice_number === 2 && secondOrder.invoice_status === "pending", JSON.stringify(secondOrder)));

    const invoicesAfterAppend = await client.query("select invoice_number, status, total_price from public.order_invoices where restaurant_id = $1 and order_id = $2 order by invoice_number", [ids.restaurantA, firstOrder.order_id]);
    results.push(result("Paid invoice is not mutated", invoicesAfterAppend.rowCount === 2 && invoicesAfterAppend.rows[0].status === "paid" && Number(invoicesAfterAppend.rows[0].total_price) === 400 && invoicesAfterAppend.rows[1].status === "pending" && Number(invoicesAfterAppend.rows[1].total_price) === 100, JSON.stringify(invoicesAfterAppend.rows)));

    const coffeeHeld = await client.query(`
      select menu_items.name, items.kitchen_status, invoices.invoice_number, invoices.status as invoice_status
      from public.order_items items
      join public.menu_items menu_items on menu_items.restaurant_id = items.restaurant_id and menu_items.id = items.menu_item_id
      join public.order_invoices invoices on invoices.restaurant_id = items.restaurant_id and invoices.id = items.invoice_id
      where items.restaurant_id = $1 and items.order_id = $2
      order by invoices.invoice_number
    `, [ids.restaurantA, firstOrder.order_id]);
    results.push(result("Coffee remains unpaid and held", coffeeHeld.rows.some((row) => row.name === "Coffee" && row.kitchen_status === "held" && row.invoice_number === 2 && row.invoice_status === "pending"), JSON.stringify(coffeeHeld.rows)));

    const kitchenBeforeSecondPay = await asRole(client, "authenticated", ids.kitchenA, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("Kitchen still only sees paid Pizza", JSON.stringify(itemNames(kitchenBeforeSecondPay.rows)) === JSON.stringify(["Pizza"]), JSON.stringify(kitchenBeforeSecondPay.rows.map((row) => ({ status: row.status, items: itemNames([row]) })))));

    const cashierQueue = await asRole(client, "authenticated", ids.cashierA, "select * from public.get_cashier_invoice_queue($1)", [ids.restaurantA]);
    results.push(result("Cashier sees paid and pending invoices", cashierQueue.rows.length === 2 && cashierQueue.rows.some((row) => row.invoice_number === 1 && row.invoice_status === "paid" && Number(row.total_price) === 400) && cashierQueue.rows.some((row) => row.invoice_number === 2 && row.invoice_status === "pending" && Number(row.total_price) === 100), JSON.stringify(cashierQueue.rows.map((row) => ({ invoice_number: row.invoice_number, invoice_status: row.invoice_status, total_price: row.total_price })))));

    const shiftAfterPending = await asRole(client, "authenticated", ids.cashierA, "select public.get_cashier_shift_summary($1) as summary", [ids.restaurantA]);
    results.push(result("Revenue excludes pending invoice", Number(shiftAfterPending.rows[0].summary.active_shift.cash_collected) === 400 && Number(shiftAfterPending.rows[0].summary.active_shift.payments_processed) === 1, JSON.stringify(shiftAfterPending.rows[0].summary.active_shift)));

    await asRole(client, "authenticated", ids.cashierA, "select public.approve_order_payment($1)", [firstOrder.order_id]);
    const kitchenAfterSecondPay = await asRole(client, "authenticated", ids.kitchenA, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("Second payment releases Coffee to kitchen", JSON.stringify(itemNames(kitchenAfterSecondPay.rows)) === JSON.stringify(["Coffee", "Pizza"]), JSON.stringify(kitchenAfterSecondPay.rows.map((row) => ({ status: row.status, items: itemNames([row]) })))));

    const finalCounts = await client.query("select (select count(*) from public.orders where restaurant_id = $1)::int as orders, (select count(*) from public.order_items where restaurant_id = $1)::int as items, (select count(*) from public.order_invoices where restaurant_id = $1)::int as invoices", [ids.restaurantA]);
    results.push(result("No duplicate orders or items", finalCounts.rows[0].orders === 1 && finalCounts.rows[0].items === 2 && finalCounts.rows[0].invoices === 2, JSON.stringify(finalCounts.rows[0])));

    const finalShift = await asRole(client, "authenticated", ids.cashierA, "select public.get_cashier_shift_summary($1) as summary", [ids.restaurantA]);
    results.push(result("Revenue includes both paid invoices after second payment", Number(finalShift.rows[0].summary.active_shift.cash_collected) === 500 && Number(finalShift.rows[0].summary.active_shift.payments_processed) === 2, JSON.stringify(finalShift.rows[0].summary.active_shift)));
  } finally {
    await cleanup(client, ids);
    await client.end();
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}: ${entry.detail}`);
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
