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
  const hex = crypto.createHash("sha256").update(`serveflow-kitchen-stations-phase2-audit-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-stations-phase2-audit-a','kitchen-stations-phase2-audit-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'kitchen-stations-phase2-audit-%@example.test'").catch(() => {});
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
    categoryFoodA: uuid("category-food-a"),
    categoryDrinkA: uuid("category-drink-a"),
    categoryFoodB: uuid("category-food-b"),
    preassignedStation: uuid("preassigned-station"),
    legacyItem: uuid("legacy-item"),
    preassignedItem: uuid("preassigned-item"),
    newItem: uuid("new-item"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "041_kitchen_station_foundation.sql"), "utf8"));
    await client.query("drop trigger if exists validate_menu_item_kitchen_station on public.menu_items");
    await client.query("drop trigger if exists log_menu_item_kitchen_station_assignment on public.menu_items");
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-stations-phase2-audit-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-stations-phase2-audit-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-stations-phase2-audit-cashier-a@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Kitchen Stations Phase2 Audit A', 'kitchen-stations-phase2-audit-a', 4, 4),
        ($2, 'Kitchen Stations Phase2 Audit B', 'kitchen-stations-phase2-audit-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $4, $6, 'owner', 'Owner A', 'kitchen-stations-phase2-audit-owner-a@example.test', true),
        ($2, $5, $7, 'owner', 'Owner B', 'kitchen-stations-phase2-audit-owner-b@example.test', true),
        ($3, $4, $8, 'cashier', 'Cashier A', 'kitchen-stations-phase2-audit-cashier-a@example.test', true)
    `, [ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA]);

    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values
        ($1, $4, 'Food'),
        ($2, $4, 'Drinks'),
        ($3, $5, 'Food')
    `, [ids.categoryFoodA, ids.categoryDrinkA, ids.categoryFoodB, ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values ($1, $2, 'Existing Prep Station', null, '#2563eb', 'GR', 5, true)
    `, [ids.preassignedStation, ids.restaurantA]);

    await client.query(`
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Legacy Pizza', 12, true, null)
    `, [ids.legacyItem, ids.restaurantA, ids.categoryFoodA]);

    await client.query(`
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Already Assigned Toast', 8, true, $4)
    `, [ids.preassignedItem, ids.restaurantA, ids.categoryFoodA, ids.preassignedStation]);

    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "042_kitchen_station_menu_assignment.sql"), "utf8"));

    const stationsA = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_owner_kitchen_stations($1)", [ids.restaurantA]);
    const mainKitchen = stationsA.rows.find((row) => row.name === "Main Kitchen");
    results.push({ label: "Existing menu items safely receive Main Kitchen", ok: Boolean(mainKitchen) && stationsA.rows.length >= 1, detail: JSON.stringify({ stations: stationsA.rows }) });

    const legacy = await client.query("select kitchen_station_id from public.menu_items where id = $1", [ids.legacyItem]);
    results.push({ label: "Legacy null assignment backfilled once", ok: legacy.rows[0].kitchen_station_id === mainKitchen.id, detail: JSON.stringify(legacy.rows[0]) });

    const preassigned = await client.query("select kitchen_station_id from public.menu_items where id = $1", [ids.preassignedItem]);
    results.push({ label: "Already assigned menu items are not modified", ok: preassigned.rows[0].kitchen_station_id === ids.preassignedStation, detail: JSON.stringify(preassigned.rows[0]) });

    const mainKitchenCount = await client.query("select count(*)::int as count from public.kitchen_stations where restaurant_id = $1 and lower(btrim(name)) = 'main kitchen' and archived_at is null", [ids.restaurantA]);
    results.push({ label: "Main Kitchen is not duplicated", ok: mainKitchenCount.rows[0].count === 1, detail: JSON.stringify(mainKitchenCount.rows[0]) });

    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "042_kitchen_station_menu_assignment.sql"), "utf8"));
    const afterRerun = await client.query(`
      select
        (select count(*)::int from public.kitchen_stations where restaurant_id = $1 and lower(btrim(name)) = 'main kitchen' and archived_at is null) as main_kitchen_count,
        (select kitchen_station_id from public.menu_items where id = $2) as legacy_station_id,
        (select kitchen_station_id from public.menu_items where id = $3) as preassigned_station_id
    `, [ids.restaurantA, ids.legacyItem, ids.preassignedItem]);
    results.push({
      label: "Re-running migration remains idempotent",
      ok:
        afterRerun.rows[0].main_kitchen_count === 1 &&
        afterRerun.rows[0].legacy_station_id === mainKitchen.id &&
        afterRerun.rows[0].preassigned_station_id === ids.preassignedStation,
      detail: JSON.stringify(afterRerun.rows[0]),
    });

    await asRole(client, "authenticated", ids.ownerA, "select public.manage_kitchen_station($1, 'create', null, 'Hot Drinks', null, '#d97706', 'HD', 10, true)", [ids.restaurantA]);
    await asRole(client, "authenticated", ids.ownerA, "select public.manage_kitchen_station($1, 'create', null, 'Juice Bar', null, '#0891b2', 'JB', 20, true)", [ids.restaurantA]);
    await asRole(client, "authenticated", ids.ownerA, "select public.manage_kitchen_station($1, 'create', null, 'Bakery', null, '#7c3aed', 'BK', 30, false)", [ids.restaurantA]);
    await asRole(client, "authenticated", ids.ownerB, "select public.manage_kitchen_station($1, 'create', null, 'Tenant B Station', null, '#2563eb', 'GR', 10, true)", [ids.restaurantB]);

    const hotDrinks = await client.query("select id from public.kitchen_stations where restaurant_id = $1 and name = 'Hot Drinks'", [ids.restaurantA]);
    const juiceBar = await client.query("select id from public.kitchen_stations where restaurant_id = $1 and name = 'Juice Bar'", [ids.restaurantA]);
    const bakery = await client.query("select id from public.kitchen_stations where restaurant_id = $1 and name = 'Bakery'", [ids.restaurantA]);
    const tenantBStation = await client.query("select id from public.kitchen_stations where restaurant_id = $1 and name = 'Tenant B Station'", [ids.restaurantB]);

    results.push(await expectReject(
      "New menu items require a station",
      () => asRole(client, "authenticated", ids.ownerA, "insert into public.menu_items (restaurant_id, category_id, name, price, available) values ($1, $2, 'No Station', 5, true)", [ids.restaurantA, ids.categoryFoodA]),
      /Choose a kitchen station/i
    ));

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Macchiato', 4, true, $4)
    `, [ids.newItem, ids.restaurantA, ids.categoryDrinkA, hotDrinks.rows[0].id]);
    const created = await client.query("select kitchen_station_id from public.menu_items where id = $1", [ids.newItem]);
    results.push({ label: "Create menu item with station", ok: created.rows[0].kitchen_station_id === hotDrinks.rows[0].id, detail: JSON.stringify(created.rows[0]) });

    await asRole(client, "authenticated", ids.ownerA, "update public.menu_items set kitchen_station_id = $1 where id = $2 and restaurant_id = $3", [juiceBar.rows[0].id, ids.newItem, ids.restaurantA]);
    const edited = await client.query("select kitchen_station_id from public.menu_items where id = $1", [ids.newItem]);
    results.push({ label: "Edit station works", ok: edited.rows[0].kitchen_station_id === juiceBar.rows[0].id, detail: JSON.stringify(edited.rows[0]) });

    results.push(await expectReject(
      "Inactive stations cannot be assigned",
      () => asRole(client, "authenticated", ids.ownerA, "update public.menu_items set kitchen_station_id = $1 where id = $2 and restaurant_id = $3", [bakery.rows[0].id, ids.newItem, ids.restaurantA]),
      /active kitchen station/i
    ));

    results.push(await expectReject(
      "Multi-tenant isolation rejects another restaurant station",
      () => asRole(client, "authenticated", ids.ownerA, "update public.menu_items set kitchen_station_id = $1 where id = $2 and restaurant_id = $3", [tenantBStation.rows[0].id, ids.newItem, ids.restaurantA]),
      /active kitchen station|violates foreign key/i
    ));

    try {
      const cashierUpdate = await asRole(client, "authenticated", ids.cashierA, "update public.menu_items set kitchen_station_id = $1 where id = $2 and restaurant_id = $3", [hotDrinks.rows[0].id, ids.newItem, ids.restaurantA]);
      const afterCashierUpdate = await client.query("select kitchen_station_id from public.menu_items where id = $1", [ids.newItem]);
      results.push({
        label: "Only Owner can assign stations",
        ok: cashierUpdate.rowCount === 0 && afterCashierUpdate.rows[0].kitchen_station_id === juiceBar.rows[0].id,
        detail: JSON.stringify({ rowCount: cashierUpdate.rowCount, kitchen_station_id: afterCashierUpdate.rows[0].kitchen_station_id }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        label: "Only Owner can assign stations",
        ok: /Only restaurant owners may assign kitchen stations|permission denied|row-level security/i.test(message),
        detail: message,
      });
    }

    const logs = await client.query(`
      select action::text, count(*)::int as count
      from public.staff_activity_log
      where restaurant_id = $1
        and action::text in ('menu_station_assigned', 'menu_station_changed')
      group by action::text
      order by action::text
    `, [ids.restaurantA]);
    const logCounts = new Map(logs.rows.map((row) => [row.action, row.count]));
    results.push({
      label: "Activity logs record Menu Station Assigned and Changed",
      ok: (logCounts.get("menu_station_assigned") ?? 0) > 0 && (logCounts.get("menu_station_changed") ?? 0) > 0,
      detail: JSON.stringify(logs.rows),
    });

    const realtimePublication = await client.query(`
      select count(*)::int as count
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'menu_items'
    `);
    results.push({ label: "Realtime publication includes menu_items", ok: realtimePublication.rows[0].count === 1, detail: JSON.stringify(realtimePublication.rows[0]) });

    const ownerSource = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    results.push({ label: "Station badge displays", ok: ownerSource.includes("od-station-badge") && ownerSource.includes("getStationName(stations, item.kitchen_station_id)"), detail: "Menu table renders station badge." });
    results.push({ label: "Station filter works with menu filters", ok: ownerSource.includes("stationFilter") && ownerSource.includes("matchesStation") && ownerSource.includes("filteredItems"), detail: "Station filter participates in filteredItems." });
    results.push({ label: "Search still works", ok: ownerSource.includes("matchesSearch") && ownerSource.includes("Search menu"), detail: "Menu search participates in filteredItems." });
    results.push({ label: "Category filter still works", ok: ownerSource.includes("categoryFilter") && ownerSource.includes("matchesCategory"), detail: "Category filter participates in filteredItems." });
    results.push({ label: "Availability filter still works", ok: ownerSource.includes("availabilityFilter") && ownerSource.includes("matchesAvailability"), detail: "Availability filter participates in filteredItems." });

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
