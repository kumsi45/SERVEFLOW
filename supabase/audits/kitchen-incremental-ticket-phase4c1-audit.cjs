const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
  const hex = crypto.createHash("sha256").update(`serveflow-kitchen-incremental-ticket-phase4c1-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-incremental-phase4c1-a','kitchen-incremental-phase4c1-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'kitchen-incremental-phase4c1-%@example.test'").catch(() => {});
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
  const channel = supabase.channel(`kitchen-incremental-phase4c1-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => events.push({ table: "orders", event: payload.eventType }))
    .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => events.push({ table: "order_items", event: payload.eventType }))
    .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_order_station_progress", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => events.push({ table: "kitchen_order_station_progress", event: payload.eventType }));

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
    if (tables.has("order_items") && tables.has("kitchen_order_station_progress")) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function names(row) {
  return (row.items ?? []).map((item) => item.menu_item_name).sort();
}

function rowSummary(rows) {
  return rows.map((row) => ({
    id: row.id,
    batch: row.kitchen_batch_key,
    status: row.status,
    items: names(row),
  }));
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    mainUser: uuid("main-user"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    staffMain: uuid("staff-main"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    mainStation: uuid("main-station"),
    tenantStation: uuid("tenant-station"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    tableA: uuid("table-a"),
    tableB: uuid("table-b"),
    qrTokenA: uuid("qr-token-a"),
    qrTokenB: uuid("qr-token-b"),
    pizza: uuid("pizza"),
    burger: uuid("burger"),
    tenantItem: uuid("tenant-item"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  let realtimeProbe = null;

  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "052_kitchen_incremental_ticket_batches_phase4c1.sql"), "utf8"));
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-incremental-phase4c1-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-incremental-phase4c1-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-incremental-phase4c1-cashier-a@example.test', '', now(), now(), now()),
        ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-incremental-phase4c1-main@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA, ids.mainUser]);

    await client.query("insert into public.restaurants (id, name, slug, total_tables, table_count) values ($1, 'Kitchen Incremental Phase4C1 A', 'kitchen-incremental-phase4c1-a', 4, 4), ($2, 'Kitchen Incremental Phase4C1 B', 'kitchen-incremental-phase4c1-b', 4, 4)", [ids.restaurantA, ids.restaurantB]);
    await client.query("insert into public.kitchen_stations (id, restaurant_id, name, display_color, icon, priority, active) values ($1, $3, 'Main Kitchen', '#0f766e', 'MK', 1, true), ($2, $4, 'Tenant Station', '#2563eb', 'TN', 1, true)", [ids.mainStation, ids.tenantStation, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active, assigned_kitchen_station_id)
      values
        ($1, $5, $7, 'owner', 'Owner A', 'kitchen-incremental-phase4c1-owner-a@example.test', true, null),
        ($2, $6, $8, 'owner', 'Owner B', 'kitchen-incremental-phase4c1-owner-b@example.test', true, null),
        ($3, $5, $9, 'cashier', 'Cashier A', 'kitchen-incremental-phase4c1-cashier-a@example.test', true, null),
        ($4, $5, $10, 'kitchen', 'Main Cook', 'kitchen-incremental-phase4c1-main@example.test', true, $11)
    `, [ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.staffMain, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA, ids.mainUser, ids.mainStation]);
    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $3, 'Menu'), ($2, $4, 'Menu')", [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query("insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active) values ($1, $3, 5, 'Table 5', $5, '/r/kitchen-incremental-phase4c1-a?t=5', '/r/kitchen-incremental-phase4c1-a?t=5', true), ($2, $4, 5, 'Table 5', $6, '/r/kitchen-incremental-phase4c1-b?t=5', '/r/kitchen-incremental-phase4c1-b?t=5', true)", [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, ids.qrTokenA, ids.qrTokenB]);
    await asRole(client, "authenticated", ids.ownerA, "insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id) values ($1, $3, $4, 'Pizza', 400, true, $5), ($2, $3, $4, 'Burger', 250, true, $5)", [ids.pizza, ids.burger, ids.restaurantA, ids.categoryA, ids.mainStation]);
    await asRole(client, "authenticated", ids.ownerB, "insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id) values ($1, $2, $3, 'Tenant Item', 10, true, $4)", [ids.tenantItem, ids.restaurantB, ids.categoryB, ids.tenantStation]);

    const first = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '5', $2, 'Ada', 'Cash', $3::jsonb) as order", ["kitchen-incremental-phase4c1-a", ids.qrTokenA, JSON.stringify([{ menu_item_id: ids.pizza, quantity: 1 }])]);
    const firstOrder = first.rows[0].order;
    results.push(result("QR order created", firstOrder.session_action === "created" && firstOrder.status === "pending_payment", JSON.stringify(firstOrder)));

    await asRole(client, "authenticated", ids.cashierA, "select public.approve_order_payment($1)", [firstOrder.order_id]);
    const initialQueue = await asRole(client, "authenticated", ids.mainUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("Kitchen receives initial Pizza", initialQueue.rowCount === 1 && initialQueue.rows[0].status === "paid" && JSON.stringify(names(initialQueue.rows[0])) === JSON.stringify(["Pizza"]), JSON.stringify(rowSummary(initialQueue.rows))));

    await asRole(client, "authenticated", ids.mainUser, "select public.start_order_preparation($1)", [firstOrder.order_id]);
    const preparingQueue = await asRole(client, "authenticated", ids.mainUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("Pizza starts preparing", preparingQueue.rowCount === 1 && preparingQueue.rows[0].status === "preparing" && preparingQueue.rows[0].kitchen_batch_key === null, JSON.stringify(rowSummary(preparingQueue.rows))));

    realtimeProbe = await startRealtimeProbe(ids.restaurantA);
    const second = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '5', $2, 'Ada', 'Cash', $3::jsonb) as order", ["kitchen-incremental-phase4c1-a", ids.qrTokenA, JSON.stringify([{ menu_item_id: ids.burger, quantity: 1 }])]);
    const secondOrder = second.rows[0].order;
    const realtimeReceived = realtimeProbe.ready ? await waitForRealtime(realtimeProbe.events) : false;

    results.push(result("Same order reused", secondOrder.order_id === firstOrder.order_id && secondOrder.session_action === "appended" && secondOrder.appended_at, JSON.stringify(secondOrder)));

    const splitQueue = await asRole(client, "authenticated", ids.mainUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    const pizzaBatch = splitQueue.rows.find((row) => row.kitchen_batch_key === null);
    const burgerBatch = splitQueue.rows.find((row) => row.kitchen_batch_key !== null);
    results.push(result("Appended Burger appears as NEW ticket", splitQueue.rowCount === 2 && pizzaBatch?.status === "preparing" && burgerBatch?.status === "paid" && JSON.stringify(names(pizzaBatch)) === JSON.stringify(["Pizza"]) && JSON.stringify(names(burgerBatch)) === JSON.stringify(["Burger"]), JSON.stringify(rowSummary(splitQueue.rows))));

    await asRole(client, "authenticated", ids.mainUser, "select public.start_order_preparation($1, null, $2)", [firstOrder.order_id, burgerBatch.kitchen_batch_key]);
    const afterBurgerStart = await asRole(client, "authenticated", ids.mainUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("Start Preparing isolated per batch", afterBurgerStart.rows.some((row) => row.kitchen_batch_key === null && row.status === "preparing" && JSON.stringify(names(row)) === JSON.stringify(["Pizza"])) && afterBurgerStart.rows.some((row) => row.kitchen_batch_key !== null && row.status === "preparing" && JSON.stringify(names(row)) === JSON.stringify(["Burger"])), JSON.stringify(rowSummary(afterBurgerStart.rows))));

    await asRole(client, "authenticated", ids.mainUser, "select public.mark_order_ready($1, null, $2)", [firstOrder.order_id, burgerBatch.kitchen_batch_key]);
    const afterBurgerReady = await asRole(client, "authenticated", ids.mainUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result("Mark Ready isolated per batch", afterBurgerReady.rows.some((row) => row.kitchen_batch_key === null && row.status === "preparing" && JSON.stringify(names(row)) === JSON.stringify(["Pizza"])) && afterBurgerReady.rows.some((row) => row.kitchen_batch_key !== null && row.status === "ready" && JSON.stringify(names(row)) === JSON.stringify(["Burger"])), JSON.stringify(rowSummary(afterBurgerReady.rows))));

    const itemStates = await client.query(`
      select menu_items.name, items.kitchen_status, items.appended_at is not null as appended
      from public.order_items items
      join public.menu_items menu_items on menu_items.restaurant_id = items.restaurant_id and menu_items.id = items.menu_item_id
      where items.restaurant_id = $1 and items.order_id = $2
      order by menu_items.name
    `, [ids.restaurantA, firstOrder.order_id]);
    results.push(result("No duplicate items and no workflow drift", itemStates.rowCount === 2 && itemStates.rows.some((row) => row.name === "Pizza" && row.kitchen_status === "preparing" && row.appended === false) && itemStates.rows.some((row) => row.name === "Burger" && row.kitchen_status === "ready" && row.appended === true), JSON.stringify(itemStates.rows)));

    const orderCounts = await client.query("select count(*)::int as orders, sum(total_price)::numeric as total from public.orders where restaurant_id = $1 and table_number = '5'", [ids.restaurantA]);
    results.push(result("No duplicate orders", orderCounts.rows[0].orders === 1 && Number(orderCounts.rows[0].total) === 650, JSON.stringify(orderCounts.rows[0])));

    const cashierView = await asRole(client, "authenticated", ids.cashierA, "select id, total_price from public.orders where restaurant_id = $1 and table_number = '5' and status::text in ('paid','preparing','ready')", [ids.restaurantA]);
    results.push(result("Cashier unchanged", cashierView.rowCount === 1 && Number(cashierView.rows[0].total_price) === 650, JSON.stringify(cashierView.rows)));

    const session = await asRole(client, "anon", null, "select public.get_public_qr_order_session($1, '5', $2) as session", ["kitchen-incremental-phase4c1-a", ids.qrTokenA]);
    results.push(result("Dining session unchanged", session.rows[0].session.order_id === firstOrder.order_id && session.rows[0].session.items.length === 2, JSON.stringify({ order_id: session.rows[0].session.order_id, item_count: session.rows[0].session.items.length })));

    const ownerMetric = await asRole(client, "authenticated", ids.ownerA, "select count(*)::int as orders, sum(total_price)::numeric as revenue, avg(total_price)::numeric as average_ticket from public.orders where restaurant_id = $1", [ids.restaurantA]);
    results.push(result("Owner metrics unchanged except revenue total", ownerMetric.rows[0].orders === 1 && Number(ownerMetric.rows[0].revenue) === 650 && Number(ownerMetric.rows[0].average_ticket) === 650, JSON.stringify(ownerMetric.rows[0])));

    await asRole(client, "authenticated", ids.mainUser, "select public.mark_order_ready($1)", [firstOrder.order_id]);
    const readyOrder = await client.query("select status from public.orders where id = $1", [firstOrder.order_id]);
    results.push(result("Parent waits until every batch ready", readyOrder.rows[0].status === "ready", JSON.stringify(readyOrder.rows[0])));

    await asRole(client, "authenticated", ids.mainUser, "select public.mark_order_completed($1, null, null)", [firstOrder.order_id]);
    await asRole(client, "authenticated", ids.mainUser, "select public.mark_order_completed($1, null, $2)", [firstOrder.order_id, burgerBatch.kitchen_batch_key]);
    const completedOrder = await client.query("select status from public.orders where id = $1", [firstOrder.order_id]);
    results.push(result("Complete isolated per batch", completedOrder.rows[0].status === "completed", JSON.stringify(completedOrder.rows[0])));

    results.push(await expectReject(
      "Tenant isolation",
      () => asRole(client, "authenticated", ids.ownerB, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]),
      /Only active kitchen staff and owners|permission denied|row-level security/i
    ));

    results.push(await expectReject(
      "RLS",
      () => asRole(client, "anon", null, "insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price) values ($1, $2, $3, 1, 1)", [ids.restaurantA, firstOrder.order_id, ids.pizza]),
      /row-level security|permission denied|violates/i
    ));

    results.push(result("Realtime received", realtimeReceived, JSON.stringify({ subscribed: realtimeProbe.ready, events: realtimeProbe.events })));
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
