const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const REQUIRED_PUBLIC_FIELDS = [
  "effective_image_url",
  "name",
  "price",
  "description",
  "ingredients",
  "preparation_time_minutes",
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
  const env = readKeyValueFile(path.join(__dirname, "..", "connection.env"));
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-menu-intelligence-phase4d8-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d8-menu-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d8-menu-%@example.test'").catch(() => {});
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
      "060_menu_item_auto_station_assignment_phase4d7m.sql",
    ]) {
      await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", migration), "utf8"));
    }

    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d8-menu-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d8-menu-owner-b@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB]);
    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Phase4D8 Menu A', 'phase4d8-menu-a', 4, 4),
        ($2, 'Phase4D8 Menu B', 'phase4d8-menu-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Phase4D8 Owner A', 'phase4d8-menu-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Phase4D8 Owner B', 'phase4d8-menu-owner-b@example.test', true)
    `, [ids.staffA, ids.staffB, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB]);
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, priority, active)
      values
        ($1, $3, 'Main Kitchen', 1, true),
        ($2, $4, 'Main Kitchen', 1, true)
    `, [ids.stationA, ids.stationB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.categories (id, restaurant_id, name, hero_image_url)
      values
        ($1, $3, 'Pizza', 'https://example.com/category-pizza.jpg'),
        ($2, $4, 'Tenant Menu', 'https://example.com/tenant.jpg')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values ($1, $2, 1, 'Table 1', $3, '/r/phase4d8-menu-a/order?t=1', '/r/phase4d8-menu-a/order?t=1', true)
    `, [ids.tableA, ids.restaurantA, ids.tokenA]);

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (
        id,
        restaurant_id,
        category_id,
        name,
        description,
        ingredients,
        price,
        available,
        kitchen_station_id,
        preparation_time_minutes,
        calories,
        protein_g,
        carbohydrates_g,
        fat_g
      )
      values (
        $1,
        $2,
        $3,
        'International Pizza',
        'Stone-baked pizza with mozzarella, tomato sauce, and fresh basil.',
        array['mozzarella', 'tomato sauce', 'fresh basil', 'olive oil'],
        420,
        true,
        $4,
        18,
        690,
        28,
        82,
        21
      )
    `, [ids.itemA, ids.restaurantA, ids.categoryA, ids.stationA]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Tenant Hidden Item', 10, true, $4)
    `, [ids.itemB, ids.restaurantB, ids.categoryB, ids.stationB]);

    const publicMenu = await asRole(client, "anon", null, "select public.get_public_qr_menu($1) as menu", ["phase4d8-menu-a"]);
    const payload = publicMenu.rows[0].menu;
    const publicItem = payload.items.find((item) => item.id === ids.itemA);
    const publicCategory = payload.categories.find((category) => category.id === ids.categoryA);

    results.push(result(
      "public menu payload includes every professional item field",
      !!publicItem
        && REQUIRED_PUBLIC_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(publicItem, field))
        && publicItem.name === "International Pizza"
        && Number(publicItem.price) === 420
        && publicItem.description.includes("Stone-baked")
        && Array.isArray(publicItem.ingredients)
        && publicItem.ingredients.length === 4
        && Number(publicItem.preparation_time_minutes) === 18
        && Number(publicItem.calories) === 690
        && Number(publicItem.protein_g) === 28
        && Number(publicItem.carbohydrates_g) === 82
        && Number(publicItem.fat_g) === 21,
      JSON.stringify(publicItem ?? null)
    ));
    results.push(result(
      "category hero image fallback remains active",
      !!publicItem
        && !!publicCategory
        && publicItem.image_url === null
        && publicItem.category_image_url === publicCategory.hero_image_url
        && publicItem.effective_image_url === publicCategory.hero_image_url,
      JSON.stringify({ category: publicCategory ?? null, item: publicItem ?? null })
    ));
    results.push(result(
      "public menu payload does not expose kitchen assignment",
      !!publicItem && !Object.prototype.hasOwnProperty.call(publicItem, "kitchen_station_id"),
      JSON.stringify(publicItem ?? null)
    ));
    results.push(result(
      "tenant menu item is isolated from public slug payload",
      !payload.items.some((item) => item.id === ids.itemB || item.name === "Tenant Hidden Item"),
      JSON.stringify(payload.items.map((item) => item.name))
    ));

    const orderResult = await asRole(client, "anon", null, `
      select public.create_public_qr_order($1, '1', $2, 'Phase4D8 Guest', 'Cash', $3::jsonb) as payload
    `, ["phase4d8-menu-a", ids.tokenA, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]);
    results.push(result(
      "QR ordering remains unchanged for professional menu item",
      Boolean(orderResult.rows[0].payload.order_id) && Number(orderResult.rows[0].payload.total_price) === 420,
      JSON.stringify(orderResult.rows[0].payload)
    ));

    const root = path.join(__dirname, "..", "..");
    const menuCardSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "MenuItemCard.tsx"), "utf8");
    const featuredSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "FeaturedDishes.tsx"), "utf8");
    const foodInfoSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "FoodInfoPanel.tsx"), "utf8");
    const ingredientSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "IngredientList.tsx"), "utf8");
    const nutritionSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "NutritionSummary.tsx"), "utf8");
    const qrMenuComponents = [menuCardSource, featuredSource, foodInfoSource, ingredientSource, nutritionSource].join("\n");

    results.push(result(
      "customer menu cards display hero image, name, price, description, ingredients, nutrition, and prep time",
      menuCardSource.includes("menu-item-image")
        && menuCardSource.includes("loading=\"lazy\"")
        && menuCardSource.includes("<h3>{item.name}</h3>")
        && menuCardSource.includes("formatETBPrice(Number(item.price))")
        && menuCardSource.includes("item.description")
        && menuCardSource.includes("MenuItemIngredientPreview")
        && menuCardSource.includes("NutritionSummary")
        && menuCardSource.includes("formatPreparationEstimate"),
      "MenuItemCard source checked"
    ));
    results.push(result(
      "featured menu items use the same professional display fields",
      featuredSource.includes("featured-dish-media")
        && featuredSource.includes("loading=\"lazy\"")
        && featuredSource.includes("<h3>{item.name}</h3>")
        && featuredSource.includes("formatETBPrice(Number(item.price))")
        && featuredSource.includes("item.description")
        && featuredSource.includes("MenuItemIngredientPreview")
        && featuredSource.includes("NutritionSummary")
        && featuredSource.includes("formatPreparationEstimate"),
      "FeaturedDishes source checked"
    ));
    results.push(result(
      "food details panel keeps full ingredients, nutrition, and prep time available",
      foodInfoSource.includes("IngredientList")
        && foodInfoSource.includes("NutritionSummary")
        && foodInfoSource.includes("Estimated Preparation Time")
        && foodInfoSource.includes("effective_image_url"),
      "FoodInfoPanel source checked"
    ));
    results.push(result(
      "ingredient display remains individually stored and mobile-safe",
      ingredientSource.includes("MenuItemIngredientPreview")
        && ingredientSource.includes("clean.slice(0, 4)")
        && ingredientSource.includes("hiddenCount")
        && ingredientSource.includes("ingredient-check-list"),
      "IngredientList source checked"
    ));
    results.push(result(
      "nutrition display stays limited to public fields",
      ["calories", "protein_g", "carbohydrates_g", "fat_g"].every((field) => nutritionSource.includes(field))
        && !nutritionSource.includes("fiber_g")
        && !nutritionSource.includes("sugar_g")
        && !nutritionSource.includes("sodium_mg"),
      "NutritionSummary source checked"
    ));
    results.push(result(
      "customer menu components hide kitchen assignment",
      !/kitchen_station|station_id|Kitchen assignment/i.test(qrMenuComponents),
      "qr-menu component source checked"
    ));
    results.push(result(
      "no extra per-item data fetching added to menu presentation components",
      !/supabase\.|fetch\(/.test(menuCardSource + featuredSource + foodInfoSource + ingredientSource + nutritionSource),
      "presentation components remain render-only"
    ));

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL menu-intelligence-display-phase4d8-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS menu-intelligence-display-phase4d8-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL menu-intelligence-display-phase4d8-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await cleanup(client, ids).catch(() => {});
    await client.end().catch(() => {});
  }
}

main();
