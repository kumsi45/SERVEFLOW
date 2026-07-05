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
  const hex = crypto.createHash("sha256").update(`serveflow-preparation-time-phase4d6-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d6-prep-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d6-prep-%@example.test'").catch(() => {});
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    staffA: uuid("staff-a"),
    staffB: uuid("staff-b"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    stationA: uuid("station-a"),
    stationB: uuid("station-b"),
    tableA: uuid("table-a"),
    tokenA: uuid("token-a"),
    itemA: uuid("item-a"),
    itemB: uuid("item-b"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    for (const migration of [
      "054_restaurant_starter_templates_phase4d.sql",
      "055_menu_data_foundation_phase4d1.sql",
      "056_starter_template_upgrade_phase4d2.sql",
      "057_category_hero_images_phase4d3.sql",
      "058_nutrition_support_phase4d4.sql",
      "059_ingredient_presentation_phase4d5.sql",
    ]) {
      await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", migration), "utf8"));
    }

    await cleanup(client, ids);

    const column = await client.query(`
      select column_name, is_nullable, data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'menu_items'
        and column_name = 'preparation_time_minutes'
    `);
    results.push(result(
      "preparation time storage exists and remains nullable",
      column.rowCount === 1 && column.rows[0].is_nullable === "YES",
      JSON.stringify(column.rows)
    ));

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d6-prep-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d6-prep-owner-b@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB]);
    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Phase4D6 Prep A', 'phase4d6-prep-a', 4, 4),
        ($2, 'Phase4D6 Prep B', 'phase4d6-prep-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Prep Owner A', 'phase4d6-prep-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Prep Owner B', 'phase4d6-prep-owner-b@example.test', true)
    `, [ids.staffA, ids.staffB, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB]);
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, priority, active)
      values
        ($1, $3, 'Main Kitchen', 1, true),
        ($2, $4, 'Main Kitchen', 1, true)
    `, [ids.stationA, ids.stationB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values
        ($1, $3, 'Prep Menu'),
        ($2, $4, 'Tenant Menu')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values ($1, $2, 1, 'Table 1', $3, '/r/phase4d6-prep-a/order?t=1', '/r/phase4d6-prep-a/order?t=1', true)
    `, [ids.tableA, ids.restaurantA, ids.tokenA]);

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, description, price, available, kitchen_station_id, preparation_time_minutes)
      values ($1, $2, $3, 'Prep Burger', 'Preparation estimate audit item.', 175, true, $4, 18)
    `, [ids.itemA, ids.restaurantA, ids.categoryA, ids.stationA]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id, preparation_time_minutes)
      values ($1, $2, $3, 'Tenant Item', 10, true, $4, 5)
    `, [ids.itemB, ids.restaurantB, ids.categoryB, ids.stationB]);

    const publicMenu = await asRole(client, "anon", null, "select public.get_public_qr_menu($1) as menu", ["phase4d6-prep-a"]);
    const publicItem = publicMenu.rows[0].menu.items.find((item) => item.id === ids.itemA);
    results.push(result(
      "public menu RPC returns preparation time",
      !!publicItem && Number(publicItem.preparation_time_minutes) === 18,
      JSON.stringify(publicItem ?? null)
    ));

    const orderResult = await asRole(client, "anon", null, `
      select public.create_public_qr_order($1, '1', $2, 'Prep Guest', 'Cash', $3::jsonb) as payload
    `, ["phase4d6-prep-a", ids.tokenA, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]);
    results.push(result(
      "QR ordering unchanged for preparation-time-backed item",
      Boolean(orderResult.rows[0].payload.order_id) && Number(orderResult.rows[0].payload.total_price) === 175,
      JSON.stringify(orderResult.rows[0].payload)
    ));

    const root = path.join(__dirname, "..", "..");
    const formatterSource = fs.readFileSync(path.join(root, "src", "core", "menu", "preparationTime.ts"), "utf8");
    const menuCardSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "MenuItemCard.tsx"), "utf8");
    const foodInfoSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "FoodInfoPanel.tsx"), "utf8");
    const featuredSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "FeaturedDishes.tsx"), "utf8");
    const orderingSource = fs.readFileSync(path.join(root, "src", "modules", "ordering", "pages", "OrderingPage.tsx"), "utf8");
    const ownerSource = fs.readFileSync(path.join(root, "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    const kitchenSource = fs.readFileSync(path.join(root, "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx"), "utf8");
    const modules = fs.readdirSync(path.join(root, "src", "modules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    results.push(result(
      "shared formatter creates minute ranges",
      formatterSource.includes("formatPreparationEstimate")
        && formatterSource.includes("lowerBound")
        && formatterSource.includes("upperBound")
        && formatterSource.includes("–")
        && formatterSource.includes("min"),
      formatterSource
    ));
    results.push(result(
      "public menu displays estimated preparation time",
      [menuCardSource, foodInfoSource, featuredSource].every((source) => source.includes("formatPreparationEstimate"))
        && menuCardSource.includes("prep-time-chip")
        && foodInfoSource.includes("Estimated Preparation Time"),
      "QR menu source checked"
    ));
    results.push(result(
      "waiter-compatible ordering menu displays estimated preparation time",
      orderingSource.includes("formatPreparationEstimate")
        && orderingSource.includes("prep-time-chip")
        && !modules.includes("waiter"),
      JSON.stringify({ dedicatedWaiterModuleExists: modules.includes("waiter") })
    ));
    results.push(result(
      "owner menu displays and edits estimated preparation time",
      ownerSource.includes("formatPreparationEstimate(item.preparation_time_minutes)")
        && ownerSource.includes("Preparation Time (minutes)")
        && ownerSource.includes("preparation_time_minutes: preparationTimeMinutes"),
      "OwnerDashboardPage source checked"
    ));
    results.push(result(
      "kitchen dashboard remains unaffected",
      !kitchenSource.includes("formatPreparationEstimate")
        && !kitchenSource.includes("preparation_time_minutes")
        && !kitchenSource.includes("prep-time-chip"),
      "KitchenDashboardPage source checked"
    ));

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL preparation-time-display-phase4d6-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS preparation-time-display-phase4d6-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL preparation-time-display-phase4d6-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await cleanup(client, ids).catch(() => {});
    await client.end().catch(() => {});
  }
}

main();
