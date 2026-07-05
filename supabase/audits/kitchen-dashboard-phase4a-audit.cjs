const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

const supabaseRoot = path.join(__dirname, "..");
const sourceRoot = path.join(supabaseRoot, "..");

function readConnectionUrl() {
  const envPath = path.join(supabaseRoot, "connection.env");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const line = lines.find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

async function applyKitchenMigration(client, migration) {
  if ([
    "044_kitchen_dashboard_station_awareness.sql",
    "046_kitchen_routing_station_queue_totals_bugfix.sql",
    "047_kitchen_station_item_status_isolation.sql",
  ].includes(migration)) {
    await client.query("drop function if exists public.get_station_kitchen_orders(uuid, uuid, boolean, boolean)");
  }
  await client.query(fs.readFileSync(path.join(supabaseRoot, "migrations", migration), "utf8"));
}

async function applyPhase4BCompatibility(client) {
  await applyKitchenMigration(client, "048_kitchen_station_collaboration_phase4b.sql");
  await applyKitchenMigration(client, "049_kitchen_station_audit_actor_compatibility.sql");
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-kitchen-dashboard-phase4a-audit-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

async function cleanup(client, ids) {
  const restaurants = [ids.restaurantA, ids.restaurantB];
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cashier_shifts where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-dashboard-phase4a-a','kitchen-dashboard-phase4a-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'kitchen-dashboard-phase4a-%@example.test'").catch(() => {});
}

function itemNames(rows) {
  return rows.flatMap((row) => row.items.map((item) => item.menu_item_name)).sort();
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    kitchenHotA1: uuid("kitchen-hot-a-1"),
    kitchenHotA2: uuid("kitchen-hot-a-2"),
    kitchenMainA: uuid("kitchen-main-a"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    staffKitchenHotA1: uuid("staff-kitchen-hot-a-1"),
    staffKitchenHotA2: uuid("staff-kitchen-hot-a-2"),
    staffKitchenMainA: uuid("staff-kitchen-main-a"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    tableA: uuid("table-a"),
    tableB: uuid("table-b"),
    qrTokenA: uuid("qr-token-a"),
    qrTokenB: uuid("qr-token-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    hotStationA: uuid("hot-station-a"),
    juiceStationA: uuid("juice-station-a"),
    tenantBStation: uuid("tenant-b-station"),
    macchiato: uuid("macchiato"),
    tea: uuid("tea"),
    pizza: uuid("pizza"),
    burger: uuid("burger"),
    juice: uuid("juice"),
    tenantBItem: uuid("tenant-b-item"),
    manualOrder: uuid("manual-order"),
    tenantBOrder: uuid("tenant-b-order"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const migration of [
      "041_kitchen_station_foundation.sql",
      "042_kitchen_station_menu_assignment.sql",
      "043_kitchen_routing_engine.sql",
      "044_kitchen_dashboard_station_awareness.sql",
    ]) {
      await applyKitchenMigration(client, migration);
    }
    await applyPhase4BCompatibility(client);

    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-dashboard-phase4a-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-dashboard-phase4a-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-dashboard-phase4a-cashier-a@example.test', '', now(), now(), now()),
        ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-dashboard-phase4a-hot1@example.test', '', now(), now(), now()),
        ($5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-dashboard-phase4a-hot2@example.test', '', now(), now(), now()),
        ($6, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-dashboard-phase4a-main@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA, ids.kitchenHotA1, ids.kitchenHotA2, ids.kitchenMainA]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Kitchen Dashboard Phase4A Audit A', 'kitchen-dashboard-phase4a-a', 4, 4),
        ($2, 'Kitchen Dashboard Phase4A Audit B', 'kitchen-dashboard-phase4a-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $7, $9, 'owner', 'Owner A', 'kitchen-dashboard-phase4a-owner-a@example.test', true),
        ($2, $8, $10, 'owner', 'Owner B', 'kitchen-dashboard-phase4a-owner-b@example.test', true),
        ($3, $7, $11, 'cashier', 'Cashier A', 'kitchen-dashboard-phase4a-cashier-a@example.test', true),
        ($4, $7, $12, 'kitchen', 'Hot Drinks One', 'kitchen-dashboard-phase4a-hot1@example.test', true),
        ($5, $7, $13, 'kitchen', 'Hot Drinks Two', 'kitchen-dashboard-phase4a-hot2@example.test', true),
        ($6, $7, $14, 'kitchen', 'Main Kitchen Staff', 'kitchen-dashboard-phase4a-main@example.test', true)
    `, [
      ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.staffKitchenHotA1, ids.staffKitchenHotA2, ids.staffKitchenMainA,
      ids.restaurantA, ids.restaurantB,
      ids.ownerA, ids.ownerB, ids.cashierA, ids.kitchenHotA1, ids.kitchenHotA2, ids.kitchenMainA,
    ]);

    const mainA = await client.query("select public.ensure_main_kitchen_station_for_restaurant($1) as id", [ids.restaurantA]);
    const mainKitchenA = mainA.rows[0].id;

    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values
        ($1, $4, 'Hot Drinks', null, '#d97706', 'HD', 10, true),
        ($2, $4, 'Juice Bar', null, '#0891b2', 'JB', 20, true),
        ($3, $5, 'Tenant B Station', null, '#2563eb', 'GR', 10, true)
    `, [ids.hotStationA, ids.juiceStationA, ids.tenantBStation, ids.restaurantA, ids.restaurantB]);

    await client.query(`
      update public.restaurant_staff
      set assigned_kitchen_station_id = case
        when id in ($1, $2) then $4
        when id = $3 then $5
        else assigned_kitchen_station_id
      end
      where id in ($1, $2, $3)
    `, [ids.staffKitchenHotA1, ids.staffKitchenHotA2, ids.staffKitchenMainA, ids.hotStationA, mainKitchenA]);

    await applyKitchenMigration(client, "044_kitchen_dashboard_station_awareness.sql");
    await applyPhase4BCompatibility(client);

    const assignmentRows = await client.query(`
      select id, assigned_kitchen_station_id
      from public.restaurant_staff
      where id = any($1::uuid[])
      order by id
    `, [[ids.staffCashierA, ids.staffKitchenHotA1, ids.staffKitchenHotA2, ids.staffKitchenMainA]]);
    const assignments = new Map(assignmentRows.rows.map((row) => [row.id, row.assigned_kitchen_station_id]));
    results.push({
      label: "Station assignment defaults correctly",
      ok: assignments.get(ids.staffKitchenHotA1) === ids.hotStationA &&
        assignments.get(ids.staffKitchenHotA2) === ids.hotStationA &&
        assignments.get(ids.staffCashierA) === null,
      detail: JSON.stringify(Object.fromEntries(assignments)),
    });
    results.push({
      label: "Main Kitchen default assignment works",
      ok: assignments.get(ids.staffKitchenMainA) === mainKitchenA,
      detail: JSON.stringify({ staff: ids.staffKitchenMainA, mainKitchenA, assigned: assignments.get(ids.staffKitchenMainA) }),
    });

    const mainKitchenCount = await client.query(`
      select count(*)::int as count
      from public.kitchen_stations
      where restaurant_id = $1
        and lower(btrim(name)) = 'main kitchen'
        and archived_at is null
    `, [ids.restaurantA]);
    results.push({
      label: "Migration rerunnable without duplicate Main Kitchen assignments",
      ok: mainKitchenCount.rows[0].count === 1 && assignments.get(ids.staffKitchenHotA1) === ids.hotStationA,
      detail: JSON.stringify({ mainKitchenCount: mainKitchenCount.rows[0].count, hotAssignment: assignments.get(ids.staffKitchenHotA1) }),
    });

    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values
        ($1, $3, 1, 'Table 1', $5, '/r/kitchen-dashboard-phase4a-a/order?t=1', '/r/kitchen-dashboard-phase4a-a/order?t=1', true),
        ($2, $4, 1, 'Table 1', $6, '/r/kitchen-dashboard-phase4a-b/order?t=1', '/r/kitchen-dashboard-phase4a-b/order?t=1', true)
    `, [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, ids.qrTokenA, ids.qrTokenB]);

    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values ($1, $3, 'Menu'), ($2, $4, 'Menu')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values
        ($1, $6, $7, 'Macchiato', 4, true, $8),
        ($2, $6, $7, 'Tea', 3, true, $8),
        ($3, $6, $7, 'Pizza', 12, true, $9),
        ($4, $6, $7, 'Burger', 10, true, $9),
        ($5, $6, $7, 'Juice', 5, true, $10)
    `, [ids.macchiato, ids.tea, ids.pizza, ids.burger, ids.juice, ids.restaurantA, ids.categoryA, ids.hotStationA, mainKitchenA, ids.juiceStationA]);

    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Tenant B Item', 6, true, $4)
    `, [ids.tenantBItem, ids.restaurantB, ids.categoryB, ids.tenantBStation]);

    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
      values ($1, $2, null, 'paid', 34, 'Manual', '1', 'Cash', 'cashier', $3, now())
    `, [ids.manualOrder, ids.restaurantA, ids.staffCashierA]);
    await client.query(`
      insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price)
      values
        ($1, $2, $3, 1, 4),
        ($1, $2, $4, 1, 3),
        ($1, $2, $5, 1, 12),
        ($1, $2, $6, 1, 10),
        ($1, $2, $7, 1, 5)
    `, [ids.restaurantA, ids.manualOrder, ids.macchiato, ids.tea, ids.pizza, ids.burger, ids.juice]);

    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
      values ($1, $2, null, 'paid', 6, 'Tenant B', '1', 'Cash', 'cashier', $3, now())
    `, [ids.tenantBOrder, ids.restaurantB, ids.staffOwnerB]);
    await client.query("insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price) values ($1, $2, $3, 1, 6)", [ids.restaurantB, ids.tenantBOrder, ids.tenantBItem]);

    const hotQueue = await asRole(client, "authenticated", ids.kitchenHotA1, "select * from public.get_station_kitchen_orders($1, null, false, true)", [ids.restaurantA]);
    const hotNames = itemNames(hotQueue.rows);
    results.push({ label: "Hot Drinks only sees Hot Drinks items", ok: JSON.stringify(hotNames) === JSON.stringify(["Macchiato", "Tea"]), detail: JSON.stringify(hotNames) });

    const mainQueue = await asRole(client, "authenticated", ids.kitchenMainA, "select * from public.get_station_kitchen_orders($1, null, false, true)", [ids.restaurantA]);
    const mainNames = itemNames(mainQueue.rows);
    results.push({ label: "Main Kitchen only sees Main Kitchen items", ok: JSON.stringify(mainNames) === JSON.stringify(["Burger", "Pizza"]), detail: JSON.stringify(mainNames) });

    const hotQueue2 = await asRole(client, "authenticated", ids.kitchenHotA2, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push({ label: "Multiple staff on same station see identical queue", ok: JSON.stringify(itemNames(hotQueue2.rows)) === JSON.stringify(hotNames), detail: JSON.stringify(itemNames(hotQueue2.rows)) });

    const ownerAll = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_station_kitchen_orders($1, null, true, true)", [ids.restaurantA]);
    results.push({ label: "Owner All Stations sees everything", ok: itemNames(ownerAll.rows).length === 5, detail: JSON.stringify(itemNames(ownerAll.rows)) });

    const ownerHot = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_station_kitchen_orders($1, $2, false, true)", [ids.restaurantA, ids.hotStationA]);
    results.push({ label: "Owner station filter works", ok: JSON.stringify(itemNames(ownerHot.rows)) === JSON.stringify(["Macchiato", "Tea"]), detail: JSON.stringify(itemNames(ownerHot.rows)) });

    const statusSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "kitchen", "types.ts"), "utf8");
    results.push({ label: "Existing statuses unchanged", ok: /\"paid\" \| \"preparing\" \| \"ready\" \| \"completed\"/.test(statusSource), detail: "KitchenOrderStatus remains paid/preparing/ready/completed." });

    const kitchenServiceSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "kitchen", "services", "kitchenOrderService.ts"), "utf8");
    const dashboardSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx"), "utf8");
    results.push({
      label: "Dashboard uses station-aware RPC instead of React-side order filtering",
      ok: kitchenServiceSource.includes('.rpc("get_station_kitchen_orders"') &&
        dashboardSource.includes("fetchStationKitchenOrders") &&
        !dashboardSource.includes("fetchKitchenOrders"),
      detail: "KitchenDashboardPage loads queues through fetchStationKitchenOrders/get_station_kitchen_orders.",
    });

    const qrOrder = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '1', $2, 'QR Guest', 'Cash', $3::jsonb) as result", [
      "kitchen-dashboard-phase4a-a",
      ids.qrTokenA,
      JSON.stringify([{ menu_item_id: ids.tea, quantity: 1 }, { menu_item_id: ids.pizza, quantity: 1 }]),
    ]);
    const qrOrderId = qrOrder.rows[0].result.order_id;
    await client.query("update public.orders set status = 'paid', payment_verified_by = $1, payment_verified_at = now() where id = $2", [ids.staffCashierA, qrOrderId]);
    const hotAfterQr = await asRole(client, "authenticated", ids.kitchenHotA1, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push({ label: "QR orders appear in correct station", ok: itemNames(hotAfterQr.rows).filter((name) => name === "Tea").length === 2 && !itemNames(hotAfterQr.rows).includes("Pizza"), detail: JSON.stringify(itemNames(hotAfterQr.rows)) });

    await client.query("insert into public.cashier_shifts (restaurant_id, opened_by, opening_cash, notes) values ($1, $2, 100, 'phase4a audit')", [ids.restaurantA, ids.staffCashierA]);
    const cashierOrder = await asRole(client, "authenticated", ids.cashierA, "select public.create_cashier_order($1, '1', 'Cash', $2::jsonb) as result", [
      ids.restaurantA,
      JSON.stringify([{ menu_item_id: ids.macchiato, quantity: 1 }, { menu_item_id: ids.juice, quantity: 1 }]),
    ]);
    const cashierOrderId = cashierOrder.rows[0].result.order_id;
    const hotAfterCashier = await asRole(client, "authenticated", ids.kitchenHotA1, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push({ label: "Cashier orders appear in correct station", ok: itemNames(hotAfterCashier.rows).filter((name) => name === "Macchiato").length === 2 && !itemNames(hotAfterCashier.rows).includes("Juice"), detail: JSON.stringify({ order_id: cashierOrderId, queue: itemNames(hotAfterCashier.rows) }) });

    const realtimePublication = await client.query(`
      select tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename
    `, [["order_items", "kitchen_stations", "restaurant_staff"]]);
    const realtimeTables = realtimePublication.rows.map((row) => row.tablename);
    results.push({
      label: "Realtime subscriptions refresh correctly",
      ok: realtimeTables.includes("order_items") &&
        realtimeTables.includes("kitchen_stations") &&
        realtimeTables.includes("restaurant_staff") &&
        dashboardSource.includes('table: "orders"') &&
        dashboardSource.includes('table: "order_items"') &&
        dashboardSource.includes("kitchen_station_id=eq.") &&
        dashboardSource.includes("refreshStationOrders(false)"),
      detail: JSON.stringify({ published: realtimeTables, dashboard: "orders/order_items refresh via station-aware RPC" }),
    });

    const tenantReject = await expectReject(
      "Multi-tenant isolation",
      () => asRole(client, "authenticated", ids.ownerB, "select * from public.get_station_kitchen_orders($1, null, true, false)", [ids.restaurantA]),
      /Only active kitchen staff and owners|view kitchen orders/i
    );
    results.push(tenantReject);

    const hotRls = await asRole(client, "authenticated", ids.kitchenHotA1, "select distinct kitchen_station_id from public.order_items where restaurant_id = $1 order by kitchen_station_id", [ids.restaurantA]);
    results.push({ label: "RLS enforced", ok: hotRls.rows.length === 1 && hotRls.rows[0].kitchen_station_id === ids.hotStationA, detail: JSON.stringify(hotRls.rows) });

    const queueLogs = await client.query("select count(*)::int as count from public.staff_activity_log where restaurant_id = $1 and action::text = 'kitchen_station_queue_viewed'", [ids.restaurantA]);
    results.push({ label: "Activity log records queue views without realtime spam", ok: queueLogs.rows[0].count >= 3 && queueLogs.rows[0].count <= 6, detail: JSON.stringify(queueLogs.rows[0]) });

    const migrationSource = fs.readFileSync(path.join(supabaseRoot, "migrations", "044_kitchen_dashboard_station_awareness.sql"), "utf8");
    results.push({
      label: "Migration is idempotent and preserves historical data",
      ok: migrationSource.includes("add column if not exists assigned_kitchen_station_id") &&
        migrationSource.includes("create index if not exists restaurant_staff_assigned_kitchen_station_idx") &&
        migrationSource.includes("create or replace function public.get_station_kitchen_orders") &&
        migrationSource.includes("where staff.role = 'kitchen'") &&
        migrationSource.includes("and staff.assigned_kitchen_station_id is null") &&
        !/update\s+public\.orders/i.test(migrationSource) &&
        !/update\s+public\.order_items/i.test(migrationSource),
      detail: "Uses IF NOT EXISTS/CREATE OR REPLACE, fills only null kitchen staff assignments, and does not rewrite orders/order_items.",
    });

    results.push({
      label: "Future waiter flow remains compatible",
      ok: migrationSource.includes("if new.role = 'kitchen'") &&
        migrationSource.includes("role in ('kitchen', 'owner')") &&
        assignments.get(ids.staffCashierA) === null,
      detail: "Phase 4A default assignment is kitchen-only and non-kitchen staff remain unassigned.",
    });

    const protectedSurfacePattern = /(public_qr|payments|receipt|reports|setup_wizard|cashier_shifts|waiter|manager)/i;
    results.push({
      label: "Production safety surface unchanged",
      ok: !protectedSurfacePattern.test(migrationSource),
      detail: "Phase 4A migration source stays scoped to kitchen station dashboard compatibility.",
    });

    try {
      execSync("npm run build", {
        cwd: sourceRoot,
        stdio: "pipe",
        shell: true,
      });
      results.push({ label: "Build passes", ok: true, detail: "npm run build" });
    } catch (error) {
      results.push({ label: "Build passes", ok: false, detail: error.stdout?.toString() || error.message });
    }
  } finally {
    await cleanup(client, ids);
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
