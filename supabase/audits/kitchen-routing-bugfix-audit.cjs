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
  const hex = crypto.createHash("sha256").update(`serveflow-kitchen-routing-bugfix-audit-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-routing-bugfix-a','kitchen-routing-bugfix-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'kitchen-routing-bugfix-%@example.test'").catch(() => {});
}

function itemsFor(rows) {
  return rows.flatMap((row) => row.items ?? []);
}

function itemNames(rows) {
  return itemsFor(rows).map((item) => item.menu_item_name).sort();
}

function totals(rows) {
  return rows.map((row) => Number(row.total_price)).sort((a, b) => a - b);
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    mainKitchenUser: uuid("main-kitchen-user"),
    beverageKitchenUser: uuid("beverage-kitchen-user"),
    tenantKitchenUser: uuid("tenant-kitchen-user"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    staffMainKitchen: uuid("staff-main-kitchen"),
    staffBeverageKitchen: uuid("staff-beverage-kitchen"),
    staffTenantKitchen: uuid("staff-tenant-kitchen"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    mainStationA: uuid("main-station-a"),
    beverageStationA: uuid("beverage-station-a"),
    tenantStationB: uuid("tenant-station-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    tableA: uuid("table-a"),
    tableB: uuid("table-b"),
    qrTokenA: uuid("qr-token-a"),
    qrTokenB: uuid("qr-token-b"),
    burger: uuid("burger"),
    pizza: uuid("pizza"),
    mangoJuice: uuid("mango-juice"),
    coffee: uuid("coffee"),
    tenantItem: uuid("tenant-item"),
    mixedOrder: uuid("mixed-order"),
    tenantOrder: uuid("tenant-order"),
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
      "045_kitchen_staff_station_assignment_ui.sql",
      "046_kitchen_routing_station_queue_totals_bugfix.sql",
    ]) {
      await applyKitchenMigration(client, migration);
    }
    await applyPhase4BCompatibility(client);

    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-bugfix-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-bugfix-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-bugfix-cashier-a@example.test', '', now(), now(), now()),
        ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-bugfix-main@example.test', '', now(), now(), now()),
        ($5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-bugfix-beverage@example.test', '', now(), now(), now()),
        ($6, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-bugfix-tenant-kitchen@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA, ids.mainKitchenUser, ids.beverageKitchenUser, ids.tenantKitchenUser]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Kitchen Routing Bugfix Audit A', 'kitchen-routing-bugfix-a', 2, 2),
        ($2, 'Kitchen Routing Bugfix Audit B', 'kitchen-routing-bugfix-b', 2, 2)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values
        ($1, $4, 'Main Kitchen', null, '#0f766e', 'MK', 1, true),
        ($2, $4, 'Beverage Kitchen', null, '#0891b2', 'BK', 2, true),
        ($3, $5, 'Tenant B Station', null, '#2563eb', 'TB', 1, true)
    `, [ids.mainStationA, ids.beverageStationA, ids.tenantStationB, ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active, assigned_kitchen_station_id)
      values
        ($1, $7, $10, 'owner', 'Owner A', 'kitchen-routing-bugfix-owner-a@example.test', true, null),
        ($2, $8, $11, 'owner', 'Owner B', 'kitchen-routing-bugfix-owner-b@example.test', true, null),
        ($3, $7, $12, 'cashier', 'Cashier A', 'kitchen-routing-bugfix-cashier-a@example.test', true, null),
        ($4, $7, $13, 'kitchen', 'Main Cook', 'kitchen-routing-bugfix-main@example.test', true, $9),
        ($5, $7, $14, 'kitchen', 'Beverage Cook', 'kitchen-routing-bugfix-beverage@example.test', true, $9),
        ($6, $8, $15, 'kitchen', 'Tenant Cook', 'kitchen-routing-bugfix-tenant-kitchen@example.test', true, $16)
    `, [
      ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.staffMainKitchen, ids.staffBeverageKitchen, ids.staffTenantKitchen,
      ids.restaurantA, ids.restaurantB, ids.mainStationA,
      ids.ownerA, ids.ownerB, ids.cashierA, ids.mainKitchenUser, ids.beverageKitchenUser, ids.tenantKitchenUser, ids.tenantStationB,
    ]);

    const ownerAssignment = await asRole(client, "authenticated", ids.ownerA, `
      update public.restaurant_staff
      set assigned_kitchen_station_id = $1
      where id = $2 and restaurant_id = $3
      returning assigned_kitchen_station_id
    `, [ids.beverageStationA, ids.staffBeverageKitchen, ids.restaurantA]);
    const storedAssignment = await client.query(`
      select assigned_kitchen_station_id
      from public.restaurant_staff
      where id = $1 and restaurant_id = $2
    `, [ids.staffBeverageKitchen, ids.restaurantA]);
    results.push({
      label: "Staff assignment stored correctly",
      ok: ownerAssignment.rows[0]?.assigned_kitchen_station_id === ids.beverageStationA &&
        storedAssignment.rows[0]?.assigned_kitchen_station_id === ids.beverageStationA,
      detail: JSON.stringify({ ownerUpdate: ownerAssignment.rows[0], stored: storedAssignment.rows[0] }),
    });

    const mainContext = await asRole(client, "authenticated", ids.mainKitchenUser, "select public.get_kitchen_dashboard_context($1) as context", [ids.restaurantA]);
    const beverageContext = await asRole(client, "authenticated", ids.beverageKitchenUser, "select public.get_kitchen_dashboard_context($1) as context", [ids.restaurantA]);
    results.push({
      label: "Kitchen login receives assigned station",
      ok: mainContext.rows[0].context.restaurant.id === ids.restaurantA &&
        mainContext.rows[0].context.assignedStation.id === ids.mainStationA &&
        mainContext.rows[0].context.assignedStation.name === "Main Kitchen" &&
        beverageContext.rows[0].context.restaurant.id === ids.restaurantA &&
        beverageContext.rows[0].context.assignedStation.id === ids.beverageStationA &&
        beverageContext.rows[0].context.assignedStation.name === "Beverage Kitchen",
      detail: JSON.stringify({ main: mainContext.rows[0].context, beverage: beverageContext.rows[0].context }),
    });

    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values ($1, $3, 'Menu'), ($2, $4, 'Menu')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values
        ($1, $3, 1, 'Table 1', $5, '/r/kitchen-routing-bugfix-a/order?t=1', '/r/kitchen-routing-bugfix-a/order?t=1', true),
        ($2, $4, 1, 'Table 1', $6, '/r/kitchen-routing-bugfix-b/order?t=1', '/r/kitchen-routing-bugfix-b/order?t=1', true)
    `, [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, ids.qrTokenA, ids.qrTokenB]);

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values
        ($1, $5, $6, 'Burger', 250, true, $7),
        ($2, $5, $6, 'Pizza', 300, true, $7),
        ($3, $5, $6, 'Mango Juice', 100, true, $8),
        ($4, $5, $6, 'Coffee', 100, true, $8)
    `, [ids.burger, ids.pizza, ids.mangoJuice, ids.coffee, ids.restaurantA, ids.categoryA, ids.mainStationA, ids.beverageStationA]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Tenant Item', 10, true, $4)
    `, [ids.tenantItem, ids.restaurantB, ids.categoryB, ids.tenantStationB]);

    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
      values ($1, $2, null, 'paid', 750, 'Split Station Customer', '1', 'Cash', 'cashier', $3, now())
    `, [ids.mixedOrder, ids.restaurantA, ids.staffCashierA]);
    await client.query(`
      insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price)
      values
        ($1, $2, $3, 1, 250),
        ($1, $2, $4, 1, 300),
        ($1, $2, $5, 1, 100),
        ($1, $2, $6, 1, 100)
    `, [ids.restaurantA, ids.mixedOrder, ids.burger, ids.pizza, ids.mangoJuice, ids.coffee]);
    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
      values ($1, $2, null, 'paid', 10, 'Tenant Customer', '1', 'Cash', 'cashier', $3, now())
    `, [ids.tenantOrder, ids.restaurantB, ids.staffOwnerB]);
    await client.query("insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price) values ($1, $2, $3, 1, 10)", [ids.restaurantB, ids.tenantOrder, ids.tenantItem]);

    const routedItems = await client.query(`
      select menu_items.name, order_items.kitchen_station_id
      from public.order_items
      join public.menu_items
        on menu_items.restaurant_id = order_items.restaurant_id
       and menu_items.id = order_items.menu_item_id
      where order_items.restaurant_id = $1 and order_items.order_id = $2
      order by menu_items.name
    `, [ids.restaurantA, ids.mixedOrder]);
    const routes = Object.fromEntries(routedItems.rows.map((row) => [row.name, row.kitchen_station_id]));
    results.push({
      label: "Menu item routing trigger assigns correct station",
      ok: routes.Burger === ids.mainStationA &&
        routes.Pizza === ids.mainStationA &&
        routes["Mango Juice"] === ids.beverageStationA &&
        routes.Coffee === ids.beverageStationA,
      detail: JSON.stringify(routes),
    });

    const duplicateRouting = await client.query(`
      select count(*)::int as row_count,
        count(distinct id)::int as distinct_item_count,
        count(*) filter (where kitchen_station_id is null)::int as unrouted_count
      from public.order_items
      where restaurant_id = $1 and order_id = $2
    `, [ids.restaurantA, ids.mixedOrder]);
    results.push({
      label: "No duplicate routing",
      ok: duplicateRouting.rows[0].row_count === 4 &&
        duplicateRouting.rows[0].distinct_item_count === 4 &&
        duplicateRouting.rows[0].unrouted_count === 0,
      detail: JSON.stringify(duplicateRouting.rows[0]),
    });

    const mainQueue = await asRole(client, "authenticated", ids.mainKitchenUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    const beverageQueue = await asRole(client, "authenticated", ids.beverageKitchenUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push({
      label: "Main Kitchen only receives Main Kitchen items",
      ok: JSON.stringify(itemNames(mainQueue.rows)) === JSON.stringify(["Burger", "Pizza"]) &&
        JSON.stringify(totals(mainQueue.rows)) === JSON.stringify([550]),
      detail: JSON.stringify({ items: itemNames(mainQueue.rows), totals: totals(mainQueue.rows) }),
    });
    results.push({
      label: "Beverage Kitchen only receives Beverage items",
      ok: JSON.stringify(itemNames(beverageQueue.rows)) === JSON.stringify(["Coffee", "Mango Juice"]) &&
        JSON.stringify(totals(beverageQueue.rows)) === JSON.stringify([200]),
      detail: JSON.stringify({ items: itemNames(beverageQueue.rows), totals: totals(beverageQueue.rows) }),
    });
    results.push({
      label: "One order with multiple stations splits correctly",
      ok: mainQueue.rows.length === 1 &&
        beverageQueue.rows.length === 1 &&
        mainQueue.rows[0].id === ids.mixedOrder &&
        beverageQueue.rows[0].id === ids.mixedOrder &&
        !itemNames(mainQueue.rows).some((name) => ["Coffee", "Mango Juice"].includes(name)) &&
        !itemNames(beverageQueue.rows).some((name) => ["Burger", "Pizza"].includes(name)),
      detail: JSON.stringify({ main: itemNames(mainQueue.rows), beverage: itemNames(beverageQueue.rows) }),
    });
    results.push({
      label: "Customer total is not used as station total",
      ok: Number(mainQueue.rows[0]?.total_price) !== 750 &&
        Number(beverageQueue.rows[0]?.total_price) !== 750 &&
        Number(mainQueue.rows[0]?.total_price) + Number(beverageQueue.rows[0]?.total_price) === 750,
      detail: JSON.stringify({ customerTotal: 750, mainStationTotal: mainQueue.rows[0]?.total_price, beverageStationTotal: beverageQueue.rows[0]?.total_price }),
    });

    const ownerMain = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_station_kitchen_orders($1, $2, false, false)", [ids.restaurantA, ids.mainStationA]);
    const ownerBeverage = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_station_kitchen_orders($1, $2, false, false)", [ids.restaurantA, ids.beverageStationA]);
    results.push({
      label: "Owner station picker uses Supabase queue filtering",
      ok: JSON.stringify(itemNames(ownerMain.rows)) === JSON.stringify(["Burger", "Pizza"]) &&
        JSON.stringify(itemNames(ownerBeverage.rows)) === JSON.stringify(["Coffee", "Mango Juice"]),
      detail: JSON.stringify({ main: itemNames(ownerMain.rows), beverage: itemNames(ownerBeverage.rows) }),
    });

    const rlsItems = await asRole(client, "authenticated", ids.beverageKitchenUser, `
      select distinct kitchen_station_id
      from public.order_items
      where restaurant_id = $1
      order by kitchen_station_id
    `, [ids.restaurantA]);
    results.push({
      label: "RLS restricts kitchen staff to assigned station items",
      ok: rlsItems.rows.length === 1 && rlsItems.rows[0].kitchen_station_id === ids.beverageStationA,
      detail: JSON.stringify(rlsItems.rows),
    });

    const tenantReject = await expectReject(
      "Tenant isolation blocks cross-restaurant queue access",
      () => asRole(client, "authenticated", ids.ownerB, "select * from public.get_station_kitchen_orders($1, null, true, false)", [ids.restaurantA]),
      /Only active kitchen staff and owners|view kitchen orders/i
    );
    results.push(tenantReject);

    const tenantUpdate = await asRole(client, "authenticated", ids.ownerB, `
      update public.restaurant_staff
      set assigned_kitchen_station_id = $1
      where id = $2
      returning id
    `, [ids.tenantStationB, ids.staffBeverageKitchen]);
    const protectedAssignment = await client.query("select assigned_kitchen_station_id from public.restaurant_staff where id = $1", [ids.staffBeverageKitchen]);
    results.push({
      label: "Tenant isolation blocks cross-restaurant staff assignment",
      ok: tenantUpdate.rows.length === 0 && protectedAssignment.rows[0]?.assigned_kitchen_station_id === ids.beverageStationA,
      detail: JSON.stringify({ updatedRows: tenantUpdate.rows.length, protectedAssignment: protectedAssignment.rows[0] }),
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
    const dashboardSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx"), "utf8");
    const ownerSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    results.push({
      label: "Realtime refreshes station queues and staff assignments",
      ok: realtimeTables.includes("order_items") &&
        dashboardSource.includes('table: "orders"') &&
        dashboardSource.includes('table: "order_items"') &&
        dashboardSource.includes("kitchen_station_id=eq.") &&
        dashboardSource.includes("refreshStationOrders(false)") &&
        ownerSource.includes('table: "restaurant_staff"') &&
        ownerSource.includes("refreshStaff()"),
      detail: JSON.stringify({ published: realtimeTables, dashboard: "orders/order_items refresh via RPC", owner: "restaurant_staff refreshStaff" }),
    });

    const serviceSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "kitchen", "services", "kitchenOrderService.ts"), "utf8");
    const functionSource = fs.readFileSync(path.join(supabaseRoot, "functions", "manage-staff", "index.ts"), "utf8");
    const migrationSource = fs.readFileSync(path.join(supabaseRoot, "migrations", "046_kitchen_routing_station_queue_totals_bugfix.sql"), "utf8");
    results.push({
      label: "Frontend does not download every order and filter in React",
      ok: serviceSource.includes('.rpc("get_station_kitchen_orders"') &&
        dashboardSource.includes("fetchStationKitchenOrders") &&
        !dashboardSource.includes("fetchKitchenOrders") &&
        !dashboardSource.includes(".from(\"orders\")"),
      detail: "KitchenDashboardPage runtime path uses get_station_kitchen_orders for queue data.",
    });
    results.push({
      label: "Manage-staff validates and writes assigned station",
      ok: functionSource.includes('requireUuid(payload.assignedKitchenStationId, "Kitchen station")') &&
        functionSource.includes("requireActiveKitchenStation(nextStationId)") &&
        functionSource.includes("updates.assigned_kitchen_station_id = nextStationId") &&
        functionSource.includes("assigned_kitchen_station_id: assignedKitchenStationId"),
      detail: "Owner Staff Management payload reaches manage-staff and restaurant_staff assigned_kitchen_station_id.",
    });
    results.push({
      label: "RPC computes station subtotal from routed items",
      ok: migrationSource.includes("coalesce(sum(items.price * items.quantity), 0)::numeric as total_price") &&
        !migrationSource.includes("orders.total_price,"),
      detail: "Kitchen queue total_price is station subtotal; orders.total_price remains unchanged for payment.",
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
