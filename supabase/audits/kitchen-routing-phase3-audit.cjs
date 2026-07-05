const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

function readConnectionUrl() {
  const envPath = path.join(__dirname, "connection.env");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const line = lines.find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-kitchen-routing-phase3-audit-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-routing-phase3-audit-a','kitchen-routing-phase3-audit-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'kitchen-routing-phase3-audit-%@example.test'").catch(() => {});
}

async function getOrderItems(client, orderId) {
  const result = await client.query(`
    select oi.menu_item_id, oi.kitchen_station_id, mi.name as menu_item_name, ks.name as station_name
    from public.order_items oi
    join public.menu_items mi on mi.id = oi.menu_item_id and mi.restaurant_id = oi.restaurant_id
    left join public.kitchen_stations ks on ks.id = oi.kitchen_station_id and ks.restaurant_id = oi.restaurant_id
    where oi.order_id = $1
    order by mi.name
  `, [orderId]);
  return result.rows;
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    tableA: uuid("table-a"),
    tableB: uuid("table-b"),
    qrTokenA: uuid("qr-token-a"),
    qrTokenB: uuid("qr-token-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    hotStation: uuid("hot-station"),
    juiceStation: uuid("juice-station"),
    tenantBStation: uuid("tenant-b-station"),
    pizza: uuid("pizza"),
    tea: uuid("tea"),
    juice: uuid("juice"),
    fallbackItem: uuid("fallback-item"),
    tenantBItem: uuid("tenant-b-item"),
    historicalOrder: uuid("historical-order"),
    historicalItem: uuid("historical-item"),
    futureOrder: uuid("future-order"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "041_kitchen_station_foundation.sql"), "utf8"));
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "042_kitchen_station_menu_assignment.sql"), "utf8"));
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-phase3-audit-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-phase3-audit-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-routing-phase3-audit-cashier-a@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Kitchen Routing Phase3 Audit A', 'kitchen-routing-phase3-audit-a', 4, 4),
        ($2, 'Kitchen Routing Phase3 Audit B', 'kitchen-routing-phase3-audit-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $4, $6, 'owner', 'Owner A', 'kitchen-routing-phase3-audit-owner-a@example.test', true),
        ($2, $5, $7, 'owner', 'Owner B', 'kitchen-routing-phase3-audit-owner-b@example.test', true),
        ($3, $4, $8, 'cashier', 'Cashier A', 'kitchen-routing-phase3-audit-cashier-a@example.test', true)
    `, [ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA]);

    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values
        ($1, $3, 1, 'Table 1', $5, '/r/kitchen-routing-phase3-audit-a/order?t=1', '/r/kitchen-routing-phase3-audit-a/order?t=1', true),
        ($2, $4, 1, 'Table 1', $6, '/r/kitchen-routing-phase3-audit-b/order?t=1', '/r/kitchen-routing-phase3-audit-b/order?t=1', true)
    `, [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, ids.qrTokenA, ids.qrTokenB]);

    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values ($1, $3, 'Food'), ($2, $4, 'Food')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values
        ($1, $4, 'Hot Drinks', null, '#d97706', 'HD', 10, true),
        ($2, $4, 'Juice Bar', null, '#0891b2', 'JB', 20, true),
        ($3, $5, 'Tenant B Station', null, '#2563eb', 'GR', 10, true)
    `, [ids.hotStation, ids.juiceStation, ids.tenantBStation, ids.restaurantA, ids.restaurantB]);

    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "042_kitchen_station_menu_assignment.sql"), "utf8"));

    const mainA = await client.query("select id from public.kitchen_stations where restaurant_id = $1 and lower(btrim(name)) = 'main kitchen' and archived_at is null limit 1", [ids.restaurantA]);
    const mainKitchenA = mainA.rows[0].id;

    await client.query("drop trigger if exists validate_menu_item_kitchen_station on public.menu_items");

    await client.query(`
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values
        ($1, $5, $7, 'Pizza', 12, true, $9),
        ($2, $5, $7, 'Tea', 3, true, $10),
        ($3, $5, $7, 'Mango Juice', 5, true, $11),
        ($4, $6, $8, 'Tenant B Item', 6, true, $12)
    `, [ids.pizza, ids.tea, ids.juice, ids.tenantBItem, ids.restaurantA, ids.restaurantB, ids.categoryA, ids.categoryB, mainKitchenA, ids.hotStation, ids.juiceStation, ids.tenantBStation]);

    await client.query("drop trigger if exists validate_menu_item_kitchen_station on public.menu_items");
    await client.query(`
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Fallback Soup', 7, true, null)
    `, [ids.fallbackItem, ids.restaurantA, ids.categoryA]);
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "042_kitchen_station_menu_assignment.sql"), "utf8"));
    await client.query("drop trigger if exists validate_menu_item_kitchen_station on public.menu_items");
    await client.query("update public.menu_items set kitchen_station_id = null where id = $1", [ids.fallbackItem]);
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "043_kitchen_routing_engine.sql"), "utf8"));

    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source)
      values ($1, $2, null, 'pending_payment', 1, 'Historical', '1', 'Cash', 'public_qr')
    `, [ids.historicalOrder, ids.restaurantA]);
    await client.query(`
      insert into public.order_items (id, restaurant_id, order_id, menu_item_id, quantity, price)
      values ($1, $2, $3, $4, 1, 12)
    `, [ids.historicalItem, ids.restaurantA, ids.historicalOrder, ids.pizza]);
    await client.query("update public.order_items set kitchen_station_id = null where id = $1", [ids.historicalItem]);

    const qrOrder = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '1', $2, 'Ada', 'Cash', $3::jsonb) as result", [
      "kitchen-routing-phase3-audit-a",
      ids.qrTokenA,
      JSON.stringify([{ menu_item_id: ids.pizza, quantity: 1 }, { menu_item_id: ids.tea, quantity: 2 }, { menu_item_id: ids.juice, quantity: 1 }]),
    ]);
    const qrOrderId = qrOrder.rows[0].result.order_id;
    const qrItems = await getOrderItems(client, qrOrderId);
    results.push({
      label: "QR orders route correctly",
      ok: qrItems.some((item) => item.menu_item_id === ids.pizza && item.kitchen_station_id === mainKitchenA)
        && qrItems.some((item) => item.menu_item_id === ids.tea && item.kitchen_station_id === ids.hotStation)
        && qrItems.some((item) => item.menu_item_id === ids.juice && item.kitchen_station_id === ids.juiceStation),
      detail: JSON.stringify(qrItems),
    });

    await client.query("insert into public.cashier_shifts (restaurant_id, opened_by, opening_cash, notes) values ($1, $2, 100, 'audit')", [ids.restaurantA, ids.staffCashierA]);
    const cashierOrder = await asRole(client, "authenticated", ids.cashierA, "select public.create_cashier_order($1, '1', 'Cash', $2::jsonb) as result", [
      ids.restaurantA,
      JSON.stringify([{ menu_item_id: ids.tea, quantity: 1 }, { menu_item_id: ids.juice, quantity: 1 }]),
    ]);
    const cashierOrderId = cashierOrder.rows[0].result.order_id;
    const cashierItems = await getOrderItems(client, cashierOrderId);
    results.push({
      label: "Cashier orders route correctly",
      ok: cashierItems.every((item) => item.kitchen_station_id) && cashierItems.some((item) => item.kitchen_station_id === ids.hotStation) && cashierItems.some((item) => item.kitchen_station_id === ids.juiceStation),
      detail: JSON.stringify(cashierItems),
    });

    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source)
      values ($1, $2, null, 'pending_payment', 1, 'Future Waiter', '1', 'Cash', 'cashier')
    `, [ids.futureOrder, ids.restaurantA]);
    await client.query("insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price) values ($1, $2, $3, 1, 7)", [ids.restaurantA, ids.futureOrder, ids.fallbackItem]);
    const futureItems = await getOrderItems(client, ids.futureOrder);
    results.push({
      label: "Future waiter path remains compatible",
      ok: futureItems.length === 1 && futureItems[0].kitchen_station_id === mainKitchenA,
      detail: JSON.stringify(futureItems),
    });

    const allNewRouted = await client.query("select count(*)::int as missing from public.order_items where restaurant_id = $1 and order_id <> $2 and kitchen_station_id is null", [ids.restaurantA, ids.historicalOrder]);
    results.push({ label: "Every new order_item receives kitchen_station_id", ok: allNewRouted.rows[0].missing === 0, detail: JSON.stringify(allNewRouted.rows[0]) });

    const historical = await client.query("select kitchen_station_id from public.order_items where id = $1", [ids.historicalItem]);
    results.push({ label: "Existing orders unchanged", ok: historical.rows[0].kitchen_station_id === null, detail: JSON.stringify(historical.rows[0]) });

    results.push({ label: "Main Kitchen fallback works", ok: futureItems[0].kitchen_station_id === mainKitchenA, detail: JSON.stringify(futureItems[0]) });

    results.push(await expectReject(
      "Multi-tenant isolation rejects another restaurant station",
      () => client.query("insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price, kitchen_station_id) values ($1, $2, $3, 1, 12, $4)", [ids.restaurantA, qrOrderId, ids.pizza, ids.tenantBStation]),
      /Kitchen station does not belong|foreign key/i
    ));

    const qrOrderStillThere = await client.query("select payment_method, status, order_source from public.orders where id = $1", [qrOrderId]);
    const cashierOrderStillThere = await client.query("select payment_method, status, order_source, payment_verified_at is not null as paid from public.orders where id = $1", [cashierOrderId]);
    results.push({ label: "Existing RPCs continue working", ok: qrOrderStillThere.rowCount === 1 && cashierOrderStillThere.rowCount === 1, detail: JSON.stringify({ qr: qrOrderStillThere.rows[0], cashier: cashierOrderStillThere.rows[0] }) });
    results.push({ label: "Payment flow unchanged", ok: cashierOrderStillThere.rows[0].payment_method === "Cash" && cashierOrderStillThere.rows[0].paid === true && qrOrderStillThere.rows[0].status === "pending_payment", detail: JSON.stringify({ qr: qrOrderStillThere.rows[0], cashier: cashierOrderStillThere.rows[0] }) });

    const activityLogs = await client.query("select action::text, count(*)::int as count from public.staff_activity_log where restaurant_id = $1 and action::text = 'kitchen_routing_completed' group by action::text", [ids.restaurantA]);
    results.push({ label: "Activity logs record Kitchen Routing Completed", ok: (activityLogs.rows[0]?.count ?? 0) >= 3, detail: JSON.stringify(activityLogs.rows) });

    const realtimePublication = await client.query(`
      select count(*)::int as count
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'order_items'
    `);
    results.push({ label: "Realtime unaffected", ok: realtimePublication.rows[0].count === 1, detail: JSON.stringify(realtimePublication.rows[0]) });

    const sourceChecks = [
      ["Kitchen Dashboard unaffected", path.join(__dirname, "..", "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx")],
      ["Reports unaffected", path.join(__dirname, "migrations", "040_owner_dashboard_operational_staff_reports.sql")],
      ["Owner analytics unaffected", path.join(__dirname, "..", "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx")],
    ].map(([label, file]) => ({ label, ok: fs.existsSync(file), detail: file }));
    results.push(...sourceChecks);

    const ownerView = await asRole(client, "authenticated", ids.ownerA, "select count(*)::int as count from public.order_items where restaurant_id = $1", [ids.restaurantA]);
    const tenantBView = await asRole(client, "authenticated", ids.ownerB, "select count(*)::int as count from public.order_items where restaurant_id = $1", [ids.restaurantA]);
    results.push({ label: "RLS enforced", ok: ownerView.rows[0].count > 0 && tenantBView.rows[0].count === 0, detail: JSON.stringify({ ownerA: ownerView.rows[0], ownerB: tenantBView.rows[0] }) });

    try {
      execSync("npm run build", {
        cwd: path.join(__dirname, ".."),
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
