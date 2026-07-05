const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
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

async function asRole(client, role, userId, sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local row_security = on");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    if (userId) await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await client.query(sql, params);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function expectReject(label, action, pattern) {
  try {
    await action();
    return { label, ok: false, detail: "unexpected success" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { label, ok: pattern.test(message), detail: message };
  }
}

async function cleanup(client, admin, ids, emails) {
  const restaurants = [ids.restaurantA, ids.restaurantB].filter(Boolean);
  if (restaurants.length) {
    await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.users where id = any($1::uuid[])", [[ids.ownerA, ids.ownerB, ids.mainUser, ids.beverageUser, ids.cashierUser].filter(Boolean)]).catch(() => {});
    await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-item-status-isolation-a','kitchen-item-status-isolation-b')", [restaurants]).catch(() => {});
  }

  for (const userId of [ids.ownerA, ids.ownerB, ids.mainUser, ids.beverageUser, ids.cashierUser]) {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  for (const email of Object.values(emails)) {
    await client.query("delete from auth.users where email = $1", [email]).catch(() => {});
  }
}

function itemNames(rows) {
  return rows.flatMap((row) => row.items.map((item) => item.menu_item_name)).sort();
}

async function orderItemStatuses(client, orderId) {
  const rows = await client.query(`
    select menu_items.name, stations.name as station, items.kitchen_status
    from public.order_items items
    join public.menu_items menu_items
      on menu_items.restaurant_id = items.restaurant_id
     and menu_items.id = items.menu_item_id
    join public.kitchen_stations stations
      on stations.restaurant_id = items.restaurant_id
     and stations.id = items.kitchen_station_id
    where items.order_id = $1
    order by menu_items.name
  `, [orderId]);
  return rows.rows;
}

function statusMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.name, row.kitchen_status]));
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const appEnv = readKeyValueFile(path.join(__dirname, "..", ".env.local"));
  const supabaseUrl = appEnv.VITE_SUPABASE_URL;
  const serviceRoleKey = appEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error(".env.local must include Supabase URL and service role key.");

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  const sourceRoot = path.join(__dirname, "..");
  const ids = {
    ownerA: crypto.randomUUID(),
    ownerB: crypto.randomUUID(),
    mainUser: crypto.randomUUID(),
    beverageUser: crypto.randomUUID(),
    cashierUser: crypto.randomUUID(),
    staffOwnerA: crypto.randomUUID(),
    staffOwnerB: crypto.randomUUID(),
    staffMain: crypto.randomUUID(),
    staffBeverage: crypto.randomUUID(),
    staffCashier: crypto.randomUUID(),
    restaurantA: crypto.randomUUID(),
    restaurantB: crypto.randomUUID(),
    mainStationA: crypto.randomUUID(),
    beverageStationA: crypto.randomUUID(),
    tenantStationB: crypto.randomUUID(),
    categoryA: crypto.randomUUID(),
    categoryB: crypto.randomUUID(),
    tableA: crypto.randomUUID(),
    tableB: crypto.randomUUID(),
    burger: crypto.randomUUID(),
    pizza: crypto.randomUUID(),
    coffee: crypto.randomUUID(),
    juice: crypto.randomUUID(),
    tenantItem: crypto.randomUUID(),
    qrOrder: crypto.randomUUID(),
    cashierOrder: crypto.randomUUID(),
    waiterOrder: crypto.randomUUID(),
    tenantOrder: crypto.randomUUID(),
  };
  const emails = {
    ownerA: "kitchen-item-status-isolation-owner-a@example.test",
    ownerB: "kitchen-item-status-isolation-owner-b@example.test",
    main: "kitchen-item-status-isolation-main@example.test",
    beverage: "kitchen-item-status-isolation-beverage@example.test",
    cashier: "kitchen-item-status-isolation-cashier@example.test",
  };
  const password = "TempPass123!";
  const results = [];

  await client.connect();
  try {
    await cleanup(client, admin, ids, emails);

    for (const [id, email] of [
      [ids.ownerA, emails.ownerA],
      [ids.ownerB, emails.ownerB],
      [ids.mainUser, emails.main],
      [ids.beverageUser, emails.beverage],
      [ids.cashierUser, emails.cashier],
    ]) {
      const { error } = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
      if (error) throw error;
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Kitchen Item Status Isolation A', 'kitchen-item-status-isolation-a', 2, 2),
        ($2, 'Kitchen Item Status Isolation B', 'kitchen-item-status-isolation-b', 2, 2)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, display_color, icon, priority, active)
      values
        ($1, $4, 'Main Kitchen', '#0f766e', 'MK', 1, true),
        ($2, $4, 'Beverage Kitchen', '#0891b2', 'BK', 2, true),
        ($3, $5, 'Tenant B Station', '#2563eb', 'TB', 1, true)
    `, [ids.mainStationA, ids.beverageStationA, ids.tenantStationB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active, assigned_kitchen_station_id)
      values
        ($1, $6, $10, 'owner', 'Owner A', $15, true, null),
        ($2, $7, $11, 'owner', 'Owner B', $16, true, null),
        ($3, $6, $12, 'kitchen', 'Main Kitchen Staff', $17, true, $8),
        ($4, $6, $13, 'kitchen', 'Beverage Kitchen Staff', $18, true, $9),
        ($5, $6, $14, 'cashier', 'Cashier Staff', $19, true, null)
    `, [
      ids.staffOwnerA, ids.staffOwnerB, ids.staffMain, ids.staffBeverage, ids.staffCashier,
      ids.restaurantA, ids.restaurantB, ids.mainStationA, ids.beverageStationA,
      ids.ownerA, ids.ownerB, ids.mainUser, ids.beverageUser, ids.cashierUser,
      emails.ownerA, emails.ownerB, emails.main, emails.beverage, emails.cashier,
    ]);
    await client.query(`
      insert into public.users (id, restaurant_id, role)
      values ($1, $2, 'customer')
      on conflict (id) do update set restaurant_id = excluded.restaurant_id, role = excluded.role
    `, [ids.ownerA, ids.restaurantA]);
    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $3, 'Menu'), ($2, $4, 'Menu')", [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values
        ($1, $3, 1, 'Table 1', $5, '/r/kitchen-item-status-isolation-a/order?t=1', '/r/kitchen-item-status-isolation-a/order?t=1', true),
        ($2, $4, 1, 'Table 1', $6, '/r/kitchen-item-status-isolation-b/order?t=1', '/r/kitchen-item-status-isolation-b/order?t=1', true)
    `, [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, crypto.randomUUID(), crypto.randomUUID()]);
    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values
        ($1, $5, $6, 'Burger', 250, true, $7),
        ($2, $5, $6, 'Pizza', 300, true, $7),
        ($3, $5, $6, 'Coffee', 100, true, $8),
        ($4, $5, $6, 'Juice', 100, true, $8)
    `, [ids.burger, ids.pizza, ids.coffee, ids.juice, ids.restaurantA, ids.categoryA, ids.mainStationA, ids.beverageStationA]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Tenant Item', 10, true, $4)
    `, [ids.tenantItem, ids.restaurantB, ids.categoryB, ids.tenantStationB]);

    async function createOrder(orderId, source, restaurantId = ids.restaurantA, staffId = ids.staffOwnerA, customerUserId = null) {
      await client.query(`
        insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
        values ($1, $2, null, 'paid', 750, $3, '1', 'Cash', $4, $5, now())
      `.replace("null, 'paid'", "$6, 'paid'"), [orderId, restaurantId, `${source} Customer`, source, staffId, customerUserId]);
    }

    async function addFourItems(orderId) {
      await client.query(`
        insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price)
        values
          ($1, $2, $3, 1, 250),
          ($1, $2, $4, 1, 300),
          ($1, $2, $5, 1, 100),
          ($1, $2, $6, 1, 100)
      `, [ids.restaurantA, orderId, ids.burger, ids.pizza, ids.coffee, ids.juice]);
    }

    await createOrder(ids.qrOrder, "public_qr");
    await createOrder(ids.cashierOrder, "cashier", ids.restaurantA, ids.staffCashier);
    await createOrder(ids.waiterOrder, "authenticated", ids.restaurantA, ids.staffOwnerA, ids.ownerA);
    await addFourItems(ids.qrOrder);
    await addFourItems(ids.cashierOrder);
    await addFourItems(ids.waiterOrder);
    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
      values ($1, $2, null, 'paid', 10, 'Tenant Customer', '1', 'Cash', 'cashier', $3, now())
    `, [ids.tenantOrder, ids.restaurantB, ids.staffOwnerB]);
    await client.query("insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price) values ($1, $2, $3, 1, 10)", [ids.restaurantB, ids.tenantOrder, ids.tenantItem]);

    await asRole(client, "authenticated", ids.beverageUser, "select public.start_order_preparation($1)", [ids.qrOrder]);
    let rows = await orderItemStatuses(client, ids.qrOrder);
    results.push({
      label: "Beverage Start Preparing affects only Beverage items",
      ok: JSON.stringify(statusMap(rows)) === JSON.stringify({ Burger: "paid", Coffee: "preparing", Juice: "preparing", Pizza: "paid" }),
      detail: JSON.stringify(rows),
    });

    let mainQueue = await asRole(client, "authenticated", ids.mainUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    let beverageQueue = await asRole(client, "authenticated", ids.beverageUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push({
      label: "Other station remains pending after Beverage starts",
      ok: mainQueue.rows.some((row) => row.id === ids.qrOrder && row.status === "paid" && JSON.stringify(itemNames([row])) === JSON.stringify(["Burger", "Pizza"])) &&
        beverageQueue.rows.some((row) => row.id === ids.qrOrder && row.status === "preparing" && JSON.stringify(itemNames([row])) === JSON.stringify(["Coffee", "Juice"])),
      detail: JSON.stringify({ main: mainQueue.rows.find((row) => row.id === ids.qrOrder), beverage: beverageQueue.rows.find((row) => row.id === ids.qrOrder) }),
    });

    await asRole(client, "authenticated", ids.mainUser, "select public.start_order_preparation($1)", [ids.qrOrder]);
    rows = await orderItemStatuses(client, ids.qrOrder);
    results.push({
      label: "Main Start Preparing affects only Main items",
      ok: JSON.stringify(statusMap(rows)) === JSON.stringify({ Burger: "preparing", Coffee: "preparing", Juice: "preparing", Pizza: "preparing" }),
      detail: JSON.stringify(rows),
    });

    await asRole(client, "authenticated", ids.beverageUser, "select public.mark_order_ready($1)", [ids.qrOrder]);
    rows = await orderItemStatuses(client, ids.qrOrder);
    results.push({
      label: "Beverage Ready affects only Beverage items",
      ok: JSON.stringify(statusMap(rows)) === JSON.stringify({ Burger: "preparing", Coffee: "ready", Juice: "ready", Pizza: "preparing" }),
      detail: JSON.stringify(rows),
    });

    await asRole(client, "authenticated", ids.mainUser, "select public.mark_order_ready($1)", [ids.qrOrder]);
    rows = await orderItemStatuses(client, ids.qrOrder);
    const readyOrder = await client.query("select status::text as status from public.orders where id = $1", [ids.qrOrder]);
    results.push({
      label: "Multi-station order status becomes ready only after all stations are ready",
      ok: readyOrder.rows[0]?.status === "ready" &&
        JSON.stringify(statusMap(rows)) === JSON.stringify({ Burger: "ready", Coffee: "ready", Juice: "ready", Pizza: "ready" }),
      detail: JSON.stringify({ order: readyOrder.rows[0], items: rows }),
    });

    await asRole(client, "authenticated", ids.beverageUser, "select public.mark_order_completed($1)", [ids.qrOrder]);
    rows = await orderItemStatuses(client, ids.qrOrder);
    const afterBeverageComplete = await client.query("select status::text as status from public.orders where id = $1", [ids.qrOrder]);
    results.push({
      label: "Beverage Completed affects only Beverage items",
      ok: afterBeverageComplete.rows[0]?.status === "ready" &&
        JSON.stringify(statusMap(rows)) === JSON.stringify({ Burger: "ready", Coffee: "completed", Juice: "completed", Pizza: "ready" }),
      detail: JSON.stringify({ order: afterBeverageComplete.rows[0], items: rows }),
    });

    await asRole(client, "authenticated", ids.mainUser, "select public.mark_order_completed($1)", [ids.qrOrder]);
    rows = await orderItemStatuses(client, ids.qrOrder);
    const completedOrder = await client.query("select status::text as status from public.orders where id = $1", [ids.qrOrder]);
    results.push({
      label: "Order status is completed only after every routed item is completed",
      ok: completedOrder.rows[0]?.status === "completed" &&
        Object.values(statusMap(rows)).every((status) => status === "completed"),
      detail: JSON.stringify({ order: completedOrder.rows[0], items: rows }),
    });

    await asRole(client, "authenticated", ids.beverageUser, "select public.start_order_preparation($1)", [ids.cashierOrder]);
    const cashierRows = await orderItemStatuses(client, ids.cashierOrder);
    results.push({
      label: "Cashier orders keep station item isolation",
      ok: JSON.stringify(statusMap(cashierRows)) === JSON.stringify({ Burger: "paid", Coffee: "preparing", Juice: "preparing", Pizza: "paid" }),
      detail: JSON.stringify(cashierRows),
    });

    await asRole(client, "authenticated", ids.mainUser, "select public.start_order_preparation($1)", [ids.waiterOrder]);
    const waiterRows = await orderItemStatuses(client, ids.waiterOrder);
    results.push({
      label: "Future waiter-compatible order source keeps station item isolation",
      ok: JSON.stringify(statusMap(waiterRows)) === JSON.stringify({ Burger: "preparing", Coffee: "paid", Juice: "paid", Pizza: "preparing" }),
      detail: JSON.stringify(waiterRows),
    });

    const ownerAll = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_station_kitchen_orders($1, null, true, false)", [ids.restaurantA]);
    results.push({
      label: "Owner All Stations still returns active routed items",
      ok: ownerAll.rows.some((row) => row.id === ids.cashierOrder && JSON.stringify(itemNames([row])) === JSON.stringify(["Burger", "Coffee", "Juice", "Pizza"])),
      detail: JSON.stringify(ownerAll.rows.map((row) => ({ id: row.id, status: row.status, items: itemNames([row]) }))),
    });

    await asRole(client, "authenticated", ids.ownerA, "select public.mark_order_ready($1, $2)", [ids.cashierOrder, ids.beverageStationA]);
    const ownerStationRows = await orderItemStatuses(client, ids.cashierOrder);
    results.push({
      label: "Owner selected station action is station-scoped",
      ok: JSON.stringify(statusMap(ownerStationRows)) === JSON.stringify({ Burger: "paid", Coffee: "ready", Juice: "ready", Pizza: "paid" }),
      detail: JSON.stringify(ownerStationRows),
    });

    const tenantReject = await expectReject(
      "Multi-tenant isolation passes",
      () => asRole(client, "authenticated", ids.ownerB, "select * from public.get_station_kitchen_orders($1, null, true, false)", [ids.restaurantA]),
      /Only active kitchen staff and owners|view kitchen orders/i
    );
    results.push(tenantReject);

    const beverageRls = await asRole(client, "authenticated", ids.beverageUser, `
      select distinct kitchen_station_id
      from public.order_items
      where restaurant_id = $1
      order by kitchen_station_id
    `, [ids.restaurantA]);
    results.push({
      label: "RLS limits kitchen staff to their station items",
      ok: beverageRls.rows.length === 1 && beverageRls.rows[0].kitchen_station_id === ids.beverageStationA,
      detail: JSON.stringify(beverageRls.rows),
    });

    const realtimePublication = await client.query(`
      select tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename
    `, [["orders", "order_items", "restaurant_staff"]]);
    const realtimeTables = realtimePublication.rows.map((row) => row.tablename);
    results.push({
      label: "Realtime still publishes kitchen workflow tables",
      ok: realtimeTables.includes("order_items") && realtimeTables.includes("restaurant_staff"),
      detail: JSON.stringify(realtimeTables),
    });

    try {
      execSync("npm run build", { cwd: sourceRoot, stdio: "pipe", shell: true });
      results.push({ label: "Build passes", ok: true, detail: "npm run build" });
    } catch (error) {
      results.push({ label: "Build passes", ok: false, detail: error.stdout?.toString() || error.message });
    }
  } finally {
    await cleanup(client, admin, ids, emails);
    await client.end();
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}: ${result.detail}`);
  console.log(`Passed: ${failed.length === 0 ? "all" : results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
