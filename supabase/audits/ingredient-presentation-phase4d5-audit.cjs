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
  const hex = crypto.createHash("sha256").update(`serveflow-ingredients-phase4d5-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d5-ingredients-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d5-ingredients-%@example.test'").catch(() => {});
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

    const ingredientColumns = await client.query(`
      select table_name, data_type, udt_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('menu_items', 'restaurant_starter_template_items')
        and column_name = 'ingredients'
      order by table_name
    `);
    results.push(result(
      "ingredients are stored as array columns",
      ingredientColumns.rowCount === 2 && ingredientColumns.rows.every((row) => row.data_type === "ARRAY" && row.udt_name === "_text"),
      JSON.stringify(ingredientColumns.rows)
    ));

    const indexes = await client.query(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in ('menu_items_ingredients_gin_idx', 'restaurant_starter_template_items_ingredients_gin_idx')
      order by indexname
    `);
    results.push(result("ingredient GIN indexes exist for future filtering", indexes.rowCount === 2, JSON.stringify(indexes.rows)));

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d5-ingredients-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d5-ingredients-owner-b@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB]);
    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Phase4D5 Ingredients A', 'phase4d5-ingredients-a', 4, 4),
        ($2, 'Phase4D5 Ingredients B', 'phase4d5-ingredients-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Ingredients Owner A', 'phase4d5-ingredients-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Ingredients Owner B', 'phase4d5-ingredients-owner-b@example.test', true)
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
        ($1, $3, 'Pizza'),
        ($2, $4, 'Tenant')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values ($1, $2, 1, 'Table 1', $3, '/r/phase4d5-ingredients-a/order?t=1', '/r/phase4d5-ingredients-a/order?t=1', true)
    `, [ids.tableA, ids.restaurantA, ids.tokenA]);

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, description, price, available, kitchen_station_id, ingredients)
      values ($1, $2, $3, 'Margherita Pizza', 'Ingredient audit pizza.', 180, true, $4, array['Mozzarella', 'Tomato Sauce', 'Fresh Basil', 'Olive Oil']::text[])
    `, [ids.itemA, ids.restaurantA, ids.categoryA, ids.stationA]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id, ingredients)
      values ($1, $2, $3, 'Tenant Item', 10, true, $4, array['Tenant Ingredient']::text[])
    `, [ids.itemB, ids.restaurantB, ids.categoryB, ids.stationB]);

    const stored = await client.query("select ingredients from public.menu_items where id = $1", [ids.itemA]);
    results.push(result(
      "owner item stores ingredients as individual array entries",
      Array.isArray(stored.rows[0].ingredients)
        && stored.rows[0].ingredients.length === 4
        && stored.rows[0].ingredients.includes("Fresh Basil"),
      JSON.stringify(stored.rows[0])
    ));

    const publicMenu = await asRole(client, "anon", null, "select public.get_public_qr_menu($1) as menu", ["phase4d5-ingredients-a"]);
    const publicItem = publicMenu.rows[0].menu.items.find((item) => item.id === ids.itemA);
    results.push(result(
      "public menu returns ingredient array, not a text blob",
      !!publicItem
        && Array.isArray(publicItem.ingredients)
        && publicItem.ingredients.length === 4
        && typeof publicItem.ingredients !== "string"
        && publicItem.ingredients.includes("Tomato Sauce"),
      JSON.stringify(publicItem ?? null)
    ));

    results.push(await expectReject(
      "ingredient constraint rejects blank array entries",
      () => asRole(client, "authenticated", ids.ownerA, "update public.menu_items set ingredients = array['Cheese', '   ']::text[] where id = $1", [ids.itemA]),
      /ingredients_individual_entries|constraint|check/i
    ));

    const cleaned = await client.query("select public.clean_menu_text_array(array[' Cheese ', '', 'Cheese', 'Fresh Basil']::text[]) as ingredients");
    results.push(result(
      "ingredient cleaner trims blanks and keeps individual entries",
      Array.isArray(cleaned.rows[0].ingredients)
        && cleaned.rows[0].ingredients.length === 2
        && cleaned.rows[0].ingredients[0] === "Cheese"
        && cleaned.rows[0].ingredients[1] === "Fresh Basil",
      JSON.stringify(cleaned.rows[0])
    ));

    await asRole(client, "authenticated", ids.ownerA, "select public.import_restaurant_starter_templates($1, $2::text[])", [ids.restaurantA, ["international_pizza_pasta"]]);
    const importedStarter = await client.query(`
      select ingredients
      from public.menu_items
      where restaurant_id = $1
        and name = 'Pepperoni Pizza'
      limit 1
    `, [ids.restaurantA]);
    results.push(result(
      "starter template import preserves ingredient arrays",
      importedStarter.rowCount === 1
        && Array.isArray(importedStarter.rows[0].ingredients)
        && importedStarter.rows[0].ingredients.includes("pepperoni"),
      JSON.stringify(importedStarter.rows[0] ?? null)
    ));

    const orderResult = await asRole(client, "anon", null, `
      select public.create_public_qr_order($1, '1', $2, 'Ingredients Guest', 'Cash', $3::jsonb) as payload
    `, ["phase4d5-ingredients-a", ids.tokenA, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]);
    results.push(result(
      "QR ordering unchanged for ingredient-backed menu item",
      Boolean(orderResult.rows[0].payload.order_id) && Number(orderResult.rows[0].payload.total_price) === 180,
      JSON.stringify(orderResult.rows[0].payload)
    ));

    const ingredientSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "qr-menu", "components", "IngredientList.tsx"), "utf8");
    const foodInfoSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "qr-menu", "components", "FoodInfoPanel.tsx"), "utf8");
    const ownerSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    const kitchenSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx"), "utf8");
    results.push(result(
      "public food detail renders professional ingredient checklist",
      ingredientSource.includes("Ingredients")
        && ingredientSource.includes("✓")
        && ingredientSource.includes("ingredient-check-list")
        && foodInfoSource.includes("IngredientList"),
      "IngredientList source checked"
    ));
    results.push(result(
      "owner form parses ingredients into arrays",
      ownerSource.includes("parseIngredientInput")
        && ownerSource.includes("split(/\\r?\\n|,/)")
        && ownerSource.includes("ingredients,"),
      "OwnerDashboardPage source checked"
    ));
    results.push(result(
      "kitchen dashboard remains ingredient-free",
      !kitchenSource.includes("ingredients"),
      "KitchenDashboardPage source checked"
    ));

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL ingredient-presentation-phase4d5-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS ingredient-presentation-phase4d5-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL ingredient-presentation-phase4d5-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await cleanup(client, ids).catch(() => {});
    await client.end().catch(() => {});
  }
}

main();
