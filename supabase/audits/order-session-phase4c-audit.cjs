const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

const root = path.join(__dirname, "..");

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
  const hex = crypto.createHash("sha256").update(`serveflow-order-session-phase4c-${label}`).digest("hex").slice(0, 32);
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
  const restaurants = [ids.restaurantA, ids.restaurantB];
  await client.query("delete from public.kitchen_order_station_progress where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cashier_shifts where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('order-session-phase4c-a','order-session-phase4c-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'order-session-phase4c-%@example.test'").catch(() => {});
}

async function startRealtimeProbe(restaurantId) {
  const appEnv = readKeyValueFile(path.join(root, ".env.local"));
  const supabaseUrl = appEnv.VITE_SUPABASE_URL;
  const serviceRoleKey = appEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { events: [], ready: false, stop: async () => {} };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const events = [];
  const channel = supabase.channel(`order-session-phase4c-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => events.push({ table: "orders", event: payload.eventType }))
    .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => events.push({ table: "order_items", event: payload.eventType }));

  const ready = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve(true);
      }
    });
  });

  return {
    events,
    ready,
    stop: async () => {
      await supabase.removeChannel(channel);
    },
  };
}

async function waitForRealtime(events) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const tables = new Set(events.map((event) => event.table));
    if (tables.has("orders") && tables.has("order_items")) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function names(rows) {
  return rows.flatMap((row) => row.items ?? []).map((item) => item.menu_item_name).sort();
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    mainUser: uuid("main-user"),
    beverageUser: uuid("beverage-user"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    staffMain: uuid("staff-main"),
    staffBeverage: uuid("staff-beverage"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    mainStation: uuid("main-station"),
    beverageStation: uuid("beverage-station"),
    tenantStation: uuid("tenant-station"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    tableA: uuid("table-a"),
    tableB: uuid("table-b"),
    qrTokenA: uuid("qr-token-a"),
    qrTokenB: uuid("qr-token-b"),
    burger: uuid("burger"),
    coffee: uuid("coffee"),
    cake: uuid("cake"),
    tenantItem: uuid("tenant-item"),
  };
  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  let realtimeProbe = null;

  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "051_public_order_session_phase4c.sql"), "utf8"));
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-session-phase4c-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-session-phase4c-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-session-phase4c-cashier-a@example.test', '', now(), now(), now()),
        ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-session-phase4c-main@example.test', '', now(), now(), now()),
        ($5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'order-session-phase4c-beverage@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA, ids.mainUser, ids.beverageUser]);

    await client.query("insert into public.restaurants (id, name, slug, total_tables, table_count) values ($1, 'Order Session Phase4C A', 'order-session-phase4c-a', 4, 4), ($2, 'Order Session Phase4C B', 'order-session-phase4c-b', 4, 4)", [ids.restaurantA, ids.restaurantB]);
    await client.query("insert into public.kitchen_stations (id, restaurant_id, name, display_color, icon, priority, active) values ($1, $4, 'Main Kitchen', '#0f766e', 'MK', 1, true), ($2, $4, 'Beverages', '#0891b2', 'BV', 2, true), ($3, $5, 'Tenant Station', '#2563eb', 'TN', 1, true)", [ids.mainStation, ids.beverageStation, ids.tenantStation, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active, assigned_kitchen_station_id)
      values
        ($1, $6, $8, 'owner', 'Owner A', 'order-session-phase4c-owner-a@example.test', true, null),
        ($2, $7, $9, 'owner', 'Owner B', 'order-session-phase4c-owner-b@example.test', true, null),
        ($3, $6, $10, 'cashier', 'Cashier A', 'order-session-phase4c-cashier-a@example.test', true, null),
        ($4, $6, $11, 'kitchen', 'Main Cook', 'order-session-phase4c-main@example.test', true, $13),
        ($5, $6, $12, 'kitchen', 'Beverage Cook', 'order-session-phase4c-beverage@example.test', true, $14)
    `, [ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.staffMain, ids.staffBeverage, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA, ids.mainUser, ids.beverageUser, ids.mainStation, ids.beverageStation]);
    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $3, 'Menu'), ($2, $4, 'Menu')", [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query("insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active) values ($1, $3, 5, 'Table 5', $5, '/r/order-session-phase4c-a?t=5', '/r/order-session-phase4c-a?t=5', true), ($2, $4, 5, 'Table 5', $6, '/r/order-session-phase4c-b?t=5', '/r/order-session-phase4c-b?t=5', true)", [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, ids.qrTokenA, ids.qrTokenB]);
    await asRole(client, "authenticated", ids.ownerA, "insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id) values ($1, $4, $5, 'Burger', 250, true, $6), ($2, $4, $5, 'Coffee', 100, true, $7), ($3, $4, $5, 'Cake', 150, true, $6)", [ids.burger, ids.coffee, ids.cake, ids.restaurantA, ids.categoryA, ids.mainStation, ids.beverageStation]);
    await asRole(client, "authenticated", ids.ownerB, "insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id) values ($1, $2, $3, 'Tenant Item', 10, true, $4)", [ids.tenantItem, ids.restaurantB, ids.categoryB, ids.tenantStation]);

    const first = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '5', $2, 'Ada', 'Cash', $3::jsonb) as order", ["order-session-phase4c-a", ids.qrTokenA, JSON.stringify([{ menu_item_id: ids.burger, quantity: 1 }])]);
    const firstOrder = first.rows[0].order;
    results.push(result("active session created", firstOrder.session_action === "created" && firstOrder.status === "pending_payment", JSON.stringify(firstOrder)));

    await asRole(client, "authenticated", ids.cashierA, "select public.approve_order_payment($1)", [firstOrder.order_id]);
    await asRole(client, "authenticated", ids.mainUser, "select public.start_order_preparation($1)", [firstOrder.order_id]);

    realtimeProbe = await startRealtimeProbe(ids.restaurantA);
    const second = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '5', $2, 'Ada', 'Cash', $3::jsonb) as order", ["order-session-phase4c-a", ids.qrTokenA, JSON.stringify([{ menu_item_id: ids.coffee, quantity: 1 }])]);
    const secondOrder = second.rows[0].order;
    const realtimeReceived = realtimeProbe.ready ? await waitForRealtime(realtimeProbe.events) : false;

    results.push(result("active session reused", secondOrder.order_id === firstOrder.order_id && secondOrder.session_action === "appended", JSON.stringify(secondOrder)));

    const oneOrder = await client.query("select count(*)::int as count, sum(total_price)::numeric as total from public.orders where restaurant_id = $1 and table_number = '5'", [ids.restaurantA]);
    results.push(result("duplicate orders prevented", oneOrder.rows[0].count === 1, JSON.stringify(oneOrder.rows[0])));

    const itemsAfterAppend = await client.query(`
      select menu_items.name, items.quantity, items.appended_at is not null as appended, items.kitchen_status, stations.name as station
      from public.order_items items
      join public.menu_items menu_items on menu_items.restaurant_id = items.restaurant_id and menu_items.id = items.menu_item_id
      left join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
      where items.restaurant_id = $1 and items.order_id = $2
      order by menu_items.name
    `, [ids.restaurantA, firstOrder.order_id]);
    results.push(result(
      "kitchen receives only new items",
      itemsAfterAppend.rows.length === 2 &&
        itemsAfterAppend.rows.some((row) => row.name === "Burger" && row.appended === false) &&
        itemsAfterAppend.rows.some((row) => row.name === "Coffee" && row.appended === true),
      JSON.stringify(itemsAfterAppend.rows)
    ));

    const beverageQueue = await asRole(client, "authenticated", ids.beverageUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("new item appears in station queue", beverageQueue.rows.some((row) => row.id === firstOrder.order_id && JSON.stringify(names([row])) === JSON.stringify(["Coffee"])), JSON.stringify(beverageQueue.rows.map((row) => ({ id: row.id, items: names([row]) })))));

    const cashierView = await asRole(client, "authenticated", ids.cashierA, "select id, total_price from public.orders where restaurant_id = $1 and table_number = '5' and status::text in ('pending_payment','paid','preparing','ready')", [ids.restaurantA]);
    results.push(result("cashier sees single order", cashierView.rowCount === 1 && Number(cashierView.rows[0].total_price) === 350, JSON.stringify(cashierView.rows)));
    results.push(result("totals correct", Number(secondOrder.total_price) === 350 && Number(oneOrder.rows[0].total) === 350, JSON.stringify({ returned: secondOrder.total_price, stored: oneOrder.rows[0].total })));
    results.push(result("receipts correct", itemsAfterAppend.rows.length === 2 && itemsAfterAppend.rows.every((row) => row.quantity === 1), "one order id contains previous and new items"));

    const ownerMetric = await asRole(client, "authenticated", ids.ownerA, "select count(*)::int as orders, sum(total_price)::numeric as revenue, avg(total_price)::numeric as average_ticket from public.orders where restaurant_id = $1", [ids.restaurantA]);
    results.push(result("owner metrics correct", ownerMetric.rows[0].orders === 1 && Number(ownerMetric.rows[0].revenue) === 350 && Number(ownerMetric.rows[0].average_ticket) === 350, JSON.stringify(ownerMetric.rows[0])));

    const session = await asRole(client, "anon", null, "select public.get_public_qr_order_session($1, '5', $2) as session", ["order-session-phase4c-a", ids.qrTokenA]);
    results.push(result("multi-device session visible", session.rows[0].session.order_id === firstOrder.order_id && session.rows[0].session.items.length === 2, JSON.stringify(session.rows[0].session)));

    results.push(await expectReject(
      "multi-tenant isolation",
      () => asRole(client, "anon", null, "select public.get_public_qr_order_session($1, '5', $2)", ["order-session-phase4c-b", ids.qrTokenA]),
      /Invalid or expired table QR code/i
    ));

    results.push(await expectReject(
      "RLS",
      () => asRole(client, "anon", null, "insert into public.orders (restaurant_id, status, total_price, table_number, payment_method, order_source) values ($1, 'pending_payment', 1, '5', 'Cash', 'public_qr')", [ids.restaurantA]),
      /row-level security|permission denied|violates/i
    ));

    results.push(result("realtime", realtimeReceived, JSON.stringify({ subscribed: realtimeProbe.ready, events: realtimeProbe.events })));

    await asRole(client, "authenticated", ids.mainUser, "select public.mark_order_ready($1)", [firstOrder.order_id]);
    await asRole(client, "authenticated", ids.beverageUser, "select public.start_order_preparation($1)", [firstOrder.order_id]);
    await asRole(client, "authenticated", ids.beverageUser, "select public.mark_order_ready($1)", [firstOrder.order_id]);
    await asRole(client, "authenticated", ids.mainUser, "select public.mark_order_completed($1)", [firstOrder.order_id]);
    await asRole(client, "authenticated", ids.beverageUser, "select public.mark_order_completed($1)", [firstOrder.order_id]);

    const third = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '5', $2, 'Ada', 'Cash', $3::jsonb) as order", ["order-session-phase4c-a", ids.qrTokenA, JSON.stringify([{ menu_item_id: ids.cake, quantity: 1 }])]);
    results.push(result("completed session creates new order", third.rows[0].order.order_id !== firstOrder.order_id && third.rows[0].order.session_action === "created", JSON.stringify(third.rows[0].order)));

    const finalOrderCount = await client.query("select count(*)::int as count from public.orders where restaurant_id = $1 and table_number = '5'", [ids.restaurantA]);
    results.push(result("no regression", finalOrderCount.rows[0].count === 2, JSON.stringify(finalOrderCount.rows[0])));

    try {
      execSync("npm run build", { cwd: root, stdio: "pipe", shell: true });
      results.push(result("build passes", true, "npm run build"));
    } catch (error) {
      results.push(result("build passes", false, error.stdout?.toString() || error.message));
    }
  } finally {
    if (realtimeProbe) await realtimeProbe.stop();
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
