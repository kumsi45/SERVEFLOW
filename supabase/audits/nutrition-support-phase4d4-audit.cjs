const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const NUTRITION_FIELDS = [
  "calories",
  "protein_g",
  "carbohydrates_g",
  "fat_g",
  "fiber_g",
  "sugar_g",
  "sodium_mg",
];

const PUBLIC_DISPLAY_FIELDS = [
  "calories",
  "protein_g",
  "carbohydrates_g",
  "fat_g",
];

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
  const envPath = path.join(__dirname, "..", "connection.env");
  const env = readKeyValueFile(envPath);
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-nutrition-phase4d4-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d4-nutrition-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d4-nutrition-%@example.test'").catch(() => {});
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
    ]) {
      await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", migration), "utf8"));
    }

    await cleanup(client, ids);

    const columns = await client.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'menu_items'
        and column_name = any($1::text[])
      order by column_name
    `, [NUTRITION_FIELDS]);
    results.push(result(
      "nutrition storage columns exist and remain nullable",
      columns.rowCount === NUTRITION_FIELDS.length && columns.rows.every((row) => row.is_nullable === "YES"),
      JSON.stringify(columns.rows)
    ));

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d4-nutrition-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d4-nutrition-owner-b@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB]);
    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Phase4D4 Nutrition A', 'phase4d4-nutrition-a', 4, 4),
        ($2, 'Phase4D4 Nutrition B', 'phase4d4-nutrition-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Nutrition Owner A', 'phase4d4-nutrition-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Nutrition Owner B', 'phase4d4-nutrition-owner-b@example.test', true)
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
        ($1, $3, 'Nutrition Menu'),
        ($2, $4, 'Tenant Menu')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values ($1, $2, 1, 'Table 1', $3, '/r/phase4d4-nutrition-a/order?t=1', '/r/phase4d4-nutrition-a/order?t=1', true)
    `, [ids.tableA, ids.restaurantA, ids.tokenA]);

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (
        id,
        restaurant_id,
        category_id,
        name,
        description,
        price,
        available,
        kitchen_station_id,
        calories,
        protein_g,
        carbohydrates_g,
        fat_g,
        fiber_g,
        sugar_g,
        sodium_mg
      )
      values ($1, $2, $3, 'Nutrition Burger', 'Manual nutrition values.', 150, true, $4, 640, 31.5, 48.25, 27, 4.5, 7, 880)
    `, [ids.itemA, ids.restaurantA, ids.categoryA, ids.stationA]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Tenant Item', 10, true, $4)
    `, [ids.itemB, ids.restaurantB, ids.categoryB, ids.stationB]);

    const stored = await client.query(`
      select calories, protein_g, carbohydrates_g, fat_g, fiber_g, sugar_g, sodium_mg
      from public.menu_items
      where id = $1
    `, [ids.itemA]);
    results.push(result(
      "owner can manually store all nutrition values",
      Number(stored.rows[0].calories) === 640
        && Number(stored.rows[0].protein_g) === 31.5
        && Number(stored.rows[0].carbohydrates_g) === 48.25
        && Number(stored.rows[0].fat_g) === 27
        && Number(stored.rows[0].fiber_g) === 4.5
        && Number(stored.rows[0].sugar_g) === 7
        && Number(stored.rows[0].sodium_mg) === 880,
      JSON.stringify(stored.rows[0])
    ));

    const publicMenu = await asRole(client, "anon", null, "select public.get_public_qr_menu($1) as menu", ["phase4d4-nutrition-a"]);
    const publicItem = publicMenu.rows[0].menu.items.find((item) => item.id === ids.itemA);
    results.push(result(
      "public menu RPC returns nutrition fields",
      !!publicItem
        && Number(publicItem.calories) === 640
        && Number(publicItem.protein_g) === 31.5
        && Number(publicItem.carbohydrates_g) === 48.25
        && Number(publicItem.fat_g) === 27
        && Number(publicItem.fiber_g) === 4.5
        && Number(publicItem.sugar_g) === 7
        && Number(publicItem.sodium_mg) === 880,
      JSON.stringify(publicItem ?? null)
    ));

    const qrSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "qr-menu", "components", "NutritionSummary.tsx"), "utf8");
    const ownerSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    results.push(result(
      "public QR menu display is limited to calories, protein, carbs, and fat",
      PUBLIC_DISPLAY_FIELDS.every((field) => qrSource.includes(field))
        && !qrSource.includes("fiber_g")
        && !qrSource.includes("sugar_g")
        && !qrSource.includes("sodium_mg")
        && ["Calories", "Protein", "Carbs", "Fat"].every((label) => qrSource.includes(label)),
      JSON.stringify({ displayFields: PUBLIC_DISPLAY_FIELDS })
    ));
    results.push(result(
      "owner menu form supports manual nutrition edits",
      [
        "formCalories",
        "formProteinG",
        "formCarbohydratesG",
        "formFatG",
        "formFiberG",
        "formSugarG",
        "formSodiumMg",
        "parseOptionalNutritionNumber",
      ].every((token) => ownerSource.includes(token)),
      "owner form source checked"
    ));

    const orderResult = await asRole(client, "anon", null, `
      select public.create_public_qr_order($1, '1', $2, 'Nutrition Guest', 'Cash', $3::jsonb) as payload
    `, ["phase4d4-nutrition-a", ids.tokenA, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]);
    results.push(result(
      "QR ordering still accepts nutrition-backed menu item",
      Boolean(orderResult.rows[0].payload.order_id) && Number(orderResult.rows[0].payload.total_price) === 150,
      JSON.stringify(orderResult.rows[0].payload)
    ));

    results.push(await expectReject(
      "nutrition constraint rejects negative values",
      () => asRole(client, "authenticated", ids.ownerA, "update public.menu_items set protein_g = -1 where id = $1", [ids.itemA]),
      /nutrition|constraint|check/i
    ));

    const crossTenantUpdate = await asRole(client, "authenticated", ids.ownerB, "update public.menu_items set calories = 1 where id = $1 and restaurant_id = $2", [ids.itemA, ids.restaurantA]);
    const afterCrossTenant = await client.query("select calories from public.menu_items where id = $1", [ids.itemA]);
    results.push(result(
      "RLS prevents cross-tenant nutrition edits",
      crossTenantUpdate.rowCount === 0 && Number(afterCrossTenant.rows[0].calories) === 640,
      JSON.stringify({ rowCount: crossTenantUpdate.rowCount, calories: afterCrossTenant.rows[0]?.calories })
    ));

    const kitchenSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx"), "utf8");
    const cashierSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "cashier", "pages", "CashierDashboardPage.tsx"), "utf8");
    results.push(result(
      "kitchen and cashier source remain nutrition-free",
      !NUTRITION_FIELDS.some((field) => kitchenSource.includes(field) || cashierSource.includes(field)),
      "no nutrition tokens in kitchen/cashier pages"
    ));

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL nutrition-support-phase4d4-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS nutrition-support-phase4d4-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL nutrition-support-phase4d4-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await cleanup(client, ids).catch(() => {});
    await client.end().catch(() => {});
  }
}

main();
