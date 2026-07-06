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
  const env = readKeyValueFile(path.join(__dirname, "..", "connection.env"));
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-auto-station-phase4d7m-${label}`).digest("hex").slice(0, 32);
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
  const restaurants = [ids.restaurantA, ids.restaurantB, ids.restaurantC, ids.restaurantD];
  await client.query("delete from public.restaurant_starter_template_imports where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_order_station_progress where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_invoices where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d7m-auto-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d7m-auto-%@example.test'").catch(() => {});
}

async function seedRestaurant(client, ids, suffix, options = {}) {
  const ownerId = ids[`owner${suffix}`];
  const staffId = ids[`staff${suffix}`];
  const restaurantId = ids[`restaurant${suffix}`];

  await client.query(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
  `, [ownerId, `phase4d7m-auto-owner-${suffix.toLowerCase()}@example.test`]);

  await client.query(`
    insert into public.restaurants (id, name, slug, total_tables, table_count)
    values ($1, $2, $3, 4, 4)
  `, [restaurantId, `Phase4D7M Auto ${suffix}`, `phase4d7m-auto-${suffix.toLowerCase()}`]);

  await client.query(`
    insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
    values ($1, $2, $3, 'owner', $4, $5, true)
  `, [staffId, restaurantId, ownerId, `Owner ${suffix}`, `phase4d7m-auto-owner-${suffix.toLowerCase()}@example.test`]);

  if (options.main !== false) {
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values ($1, $2, 'Main Kitchen', 'Main station', '#0f766e', 'MK', 1, true)
    `, [ids[`mainStation${suffix}`], restaurantId]);
  }

  if (options.beverage === true) {
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values ($1, $2, 'Beverage Kitchen', 'Beverage station', '#0891b2', 'BK', 2, true)
    `, [ids[`beverageStation${suffix}`], restaurantId]);
  }
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    ownerC: uuid("owner-c"),
    ownerD: uuid("owner-d"),
    cashierA: uuid("cashier-a"),
    staffA: uuid("staff-a"),
    staffB: uuid("staff-b"),
    staffC: uuid("staff-c"),
    staffD: uuid("staff-d"),
    cashierStaffA: uuid("cashier-staff-a"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    restaurantC: uuid("restaurant-c"),
    restaurantD: uuid("restaurant-d"),
    mainStationA: uuid("main-station-a"),
    beverageStationA: uuid("beverage-station-a"),
    mainStationB: uuid("main-station-b"),
    mainStationC: uuid("main-station-c"),
    mainStationD: uuid("main-station-d"),
    categoryFoodA: uuid("category-food-a"),
    categoryDrinkA: uuid("category-drink-a"),
    categoryCoffeeB: uuid("category-coffee-b"),
    categoryImportC: uuid("category-import-c"),
    categoryD: uuid("category-d"),
    tableA: uuid("table-a"),
    tokenA: uuid("token-a"),
    coffee: uuid("coffee"),
    tea: uuid("tea"),
    juice: uuid("juice"),
    cocktail: uuid("cocktail"),
    pizza: uuid("pizza"),
    burger: uuid("burger"),
    pasta: uuid("pasta"),
    steak: uuid("steak"),
    unknown: uuid("unknown"),
    manualCoffee: uuid("manual-coffee"),
    fallbackCoffee: uuid("fallback-coffee"),
    noStationUnknown: uuid("no-station-unknown"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "060_menu_item_auto_station_assignment_phase4d7m.sql"), "utf8"));
    await cleanup(client, ids);

    await seedRestaurant(client, ids, "A", { main: true, beverage: true });
    await seedRestaurant(client, ids, "B", { main: true, beverage: false });
    await seedRestaurant(client, ids, "C", { main: false, beverage: false });
    await seedRestaurant(client, ids, "D", { main: false, beverage: false });

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d7m-auto-cashier-a@example.test', '', now(), now(), now())
    `, [ids.cashierA]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values ($1, $2, $3, 'cashier', 'Cashier A', 'phase4d7m-auto-cashier-a@example.test', true)
    `, [ids.cashierStaffA, ids.restaurantA, ids.cashierA]);

    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values
        ($1, $3, 'Food'),
        ($2, $3, 'Coffee & Drinks'),
        ($4, $5, 'Coffee'),
        ($6, $7, 'Import'),
        ($8, $9, 'Menu')
    `, [ids.categoryFoodA, ids.categoryDrinkA, ids.restaurantA, ids.categoryCoffeeB, ids.restaurantB, ids.categoryImportC, ids.restaurantC, ids.categoryD, ids.restaurantD]);

    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values ($1, $2, 1, 'Table 1', $3, '/r/phase4d7m-auto-a/order?t=1', '/r/phase4d7m-auto-a/order?t=1', true)
    `, [ids.tableA, ids.restaurantA, ids.tokenA]);

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available)
      values
        ($1, $10, $11, 'Coffee', 10, true),
        ($2, $10, $11, 'Tea', 10, true),
        ($3, $10, $11, 'Mango Juice', 10, true),
        ($4, $10, $11, 'House Cocktail', 10, true),
        ($5, $10, $12, 'Pizza', 10, true),
        ($6, $10, $12, 'Burger', 10, true),
        ($7, $10, $12, 'Pasta', 10, true),
        ($8, $10, $12, 'Steak', 10, true),
        ($9, $10, $12, 'Chef Special', 10, true)
    `, [
      ids.coffee,
      ids.tea,
      ids.juice,
      ids.cocktail,
      ids.pizza,
      ids.burger,
      ids.pasta,
      ids.steak,
      ids.unknown,
      ids.restaurantA,
      ids.categoryDrinkA,
      ids.categoryFoodA,
    ]);

    const stationRows = await client.query(`
      select items.name, stations.name as station_name
      from public.menu_items items
      join public.kitchen_stations stations
        on stations.restaurant_id = items.restaurant_id
       and stations.id = items.kitchen_station_id
      where items.restaurant_id = $1
      order by items.name
    `, [ids.restaurantA]);
    const stationByItem = Object.fromEntries(stationRows.rows.map((row) => [row.name, row.station_name]));
    results.push(result(
      "beverage keywords auto-assign to Beverage Kitchen",
      ["Coffee", "Tea", "Mango Juice", "House Cocktail"].every((name) => stationByItem[name] === "Beverage Kitchen"),
      JSON.stringify(stationByItem)
    ));
    results.push(result(
      "food and unknown items auto-assign to Main Kitchen",
      ["Pizza", "Burger", "Pasta", "Steak", "Chef Special"].every((name) => stationByItem[name] === "Main Kitchen"),
      JSON.stringify(stationByItem)
    ));

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Manual Coffee', 10, true, $4)
    `, [ids.manualCoffee, ids.restaurantA, ids.categoryDrinkA, ids.mainStationA]);
    const manual = await client.query(`
      select stations.name as station_name
      from public.menu_items items
      join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
      where items.id = $1
    `, [ids.manualCoffee]);
    results.push(result("manual station assignment wins on insert", manual.rows[0]?.station_name === "Main Kitchen", JSON.stringify(manual.rows[0] ?? null)));

    await asRole(client, "authenticated", ids.ownerA, `
      update public.menu_items
      set kitchen_station_id = $1
      where id = $2 and restaurant_id = $3
    `, [ids.beverageStationA, ids.unknown, ids.restaurantA]);
    const override = await client.query(`
      select stations.name as station_name
      from public.menu_items items
      join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
      where items.id = $1
    `, [ids.unknown]);
    results.push(result("owner can override station anytime", override.rows[0]?.station_name === "Beverage Kitchen", JSON.stringify(override.rows[0] ?? null)));

    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available)
      values ($1, $2, $3, 'Coffee', 10, true)
    `, [ids.fallbackCoffee, ids.restaurantB, ids.categoryCoffeeB]);
    const fallback = await client.query(`
      select stations.name as station_name
      from public.menu_items items
      join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
      where items.id = $1
    `, [ids.fallbackCoffee]);
    results.push(result("beverage items fall back to Main Kitchen when Beverage Kitchen is missing", fallback.rows[0]?.station_name === "Main Kitchen", JSON.stringify(fallback.rows[0] ?? null)));

    await asRole(client, "authenticated", ids.ownerD, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available)
      values ($1, $2, $3, 'Unknown Item', 10, true)
    `, [ids.noStationUnknown, ids.restaurantD, ids.categoryD]);
    const autoCreatedMain = await client.query(`
      select stations.name as station_name
      from public.menu_items items
      join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
      where items.id = $1
    `, [ids.noStationUnknown]);
    results.push(result("restaurant with no stations receives Main Kitchen automatically", autoCreatedMain.rows[0]?.station_name === "Main Kitchen", JSON.stringify(autoCreatedMain.rows[0] ?? null)));

    await asRole(client, "authenticated", ids.ownerC, "select public.import_restaurant_starter_templates($1, $2::text[])", [ids.restaurantC, ["coffee_tea"]]);
    const imported = await client.query(`
      select items.name, stations.name as station_name
      from public.menu_items items
      join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
      where items.restaurant_id = $1
        and items.name = 'Macchiato'
      limit 1
    `, [ids.restaurantC]);
    results.push(result("starter import does not fail when restaurant has no stations", imported.rows[0]?.station_name === "Main Kitchen", JSON.stringify(imported.rows[0] ?? null)));

    let cashierChanged = false;
    try {
      const cashierUpdate = await asRole(client, "authenticated", ids.cashierA, "update public.menu_items set kitchen_station_id = $1 where id = $2 and restaurant_id = $3", [ids.mainStationA, ids.coffee, ids.restaurantA]);
      cashierChanged = cashierUpdate.rowCount > 0;
    } catch {
      cashierChanged = false;
    }
    const coffeeAfterCashier = await client.query("select kitchen_station_id from public.menu_items where id = $1", [ids.coffee]);
    results.push(result(
      "non-owner cannot manually change station",
      !cashierChanged && coffeeAfterCashier.rows[0]?.kitchen_station_id === ids.beverageStationA,
      JSON.stringify({ cashierChanged, kitchen_station_id: coffeeAfterCashier.rows[0]?.kitchen_station_id })
    ));

    const orderResult = await asRole(client, "anon", null, `
      select public.create_public_qr_order($1, '1', $2, 'Auto Station Guest', 'Cash', $3::jsonb) as payload
    `, ["phase4d7m-auto-a", ids.tokenA, JSON.stringify([
      { menu_item_id: ids.coffee, quantity: 1 },
      { menu_item_id: ids.burger, quantity: 1 },
    ])]);
    const orderId = orderResult.rows[0].payload.order_id;
    const routedItems = await client.query(`
      select menu_items.name, stations.name as station_name
      from public.order_items order_items
      join public.menu_items menu_items on menu_items.restaurant_id = order_items.restaurant_id and menu_items.id = order_items.menu_item_id
      join public.kitchen_stations stations on stations.restaurant_id = order_items.restaurant_id and stations.id = order_items.kitchen_station_id
      where order_items.order_id = $1
      order by menu_items.name
    `, [orderId]);
    const routedByItem = Object.fromEntries(routedItems.rows.map((row) => [row.name, row.station_name]));
    results.push(result(
      "QR order routing uses auto-assigned stations",
      routedByItem.Coffee === "Beverage Kitchen" && routedByItem.Burger === "Main Kitchen",
      JSON.stringify(routedByItem)
    ));

    const root = path.join(__dirname, "..", "..");
    const ownerSource = fs.readFileSync(path.join(root, "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    const migrationSource = fs.readFileSync(path.join(__dirname, "..", "migrations", "060_menu_item_auto_station_assignment_phase4d7m.sql"), "utf8");
    results.push(result(
      "owner menu form no longer blocks missing station",
      ownerSource.includes("<option value=\"\">Auto assign</option>")
        && ownerSource.includes("kitchen_station_id: formStationId || null")
        && !ownerSource.includes("Choose a kitchen station for this menu item."),
      "OwnerDashboardPage source checked"
    ));
    results.push(result(
      "migration contains auto assignment trigger and resolver",
      migrationSource.includes("resolve_menu_item_kitchen_station")
        && migrationSource.includes("auto_assign_menu_item_kitchen_station")
        && migrationSource.includes("menu_item_prefers_beverage_station")
        && migrationSource.includes("Manual station"),
      "Migration source checked"
    ));

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL menu-auto-station-assignment-phase4d7m-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS menu-auto-station-assignment-phase4d7m-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL menu-auto-station-assignment-phase4d7m-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await cleanup(client, ids).catch(() => {});
    await client.end().catch(() => {});
  }
}

main();
