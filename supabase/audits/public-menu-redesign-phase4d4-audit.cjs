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
  const hex = crypto.createHash("sha256").update(`serveflow-public-menu-redesign-phase4d4-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d4-redesign-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d4-redesign-%@example.test'").catch(() => {});
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
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d4-redesign-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d4-redesign-owner-b@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB]);
    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Phase4D4 Redesign A', 'phase4d4-redesign-a', 4, 4),
        ($2, 'Phase4D4 Redesign B', 'phase4d4-redesign-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Redesign Owner A', 'phase4d4-redesign-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Redesign Owner B', 'phase4d4-redesign-owner-b@example.test', true)
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
        ($1, $3, 'Traditional', 'https://example.com/beyaynetu.jpg'),
        ($2, $4, 'Tenant', 'https://example.com/tenant.jpg')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values ($1, $2, 1, 'Table 1', $3, '/r/phase4d4-redesign-a/order?t=1', '/r/phase4d4-redesign-a/order?t=1', true)
    `, [ids.tableA, ids.restaurantA, ids.tokenA]);

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (
        id,
        restaurant_id,
        category_id,
        name,
        description,
        ingredients,
        allergens,
        dietary_tags,
        spice_level,
        price,
        available,
        kitchen_station_id,
        preparation_time_minutes,
        calories,
        protein_g,
        carbohydrates_g,
        fat_g,
        fiber_g,
        sugar_g,
        sodium_mg
      )
      values (
        $1,
        $2,
        $3,
        'Beyaynetu',
        'Traditional Ethiopian mixed platter served with fresh injera.',
        array['injera', 'shiro', 'misir wot', 'gomen'],
        array['gluten', 'legumes'],
        array['traditional', 'high protein'],
        3,
        450,
        true,
        $4,
        25,
        820,
        42,
        95,
        28,
        12,
        9,
        740
      )
    `, [ids.itemA, ids.restaurantA, ids.categoryA, ids.stationA]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Tenant Hidden Item', 10, true, $4)
    `, [ids.itemB, ids.restaurantB, ids.categoryB, ids.stationB]);

    const publicMenu = await asRole(client, "anon", null, "select public.get_public_qr_menu($1) as menu", ["phase4d4-redesign-a"]);
    const payload = publicMenu.rows[0].menu;
    const item = payload.items.find((entry) => entry.id === ids.itemA);
    results.push(result(
      "live public menu payload supports image-first redesign",
      !!item
        && item.name === "Beyaynetu"
        && item.description.includes("Traditional Ethiopian")
        && Number(item.price) === 450
        && item.effective_image_url === "https://example.com/beyaynetu.jpg"
        && Array.isArray(item.ingredients)
        && Array.isArray(item.allergens)
        && Array.isArray(item.dietary_tags)
        && Number(item.spice_level) === 3
        && Number(item.fiber_g) === 12
        && Number(item.sugar_g) === 9
        && Number(item.sodium_mg) === 740,
      JSON.stringify(item ?? null)
    ));
    results.push(result(
      "tenant isolation remains intact",
      !payload.items.some((entry) => entry.id === ids.itemB || entry.name === "Tenant Hidden Item"),
      JSON.stringify(payload.items.map((entry) => entry.name))
    ));

    const orderResult = await asRole(client, "anon", null, `
      select public.create_public_qr_order($1, '1', $2, 'Redesign Guest', 'Cash', $3::jsonb) as payload
    `, ["phase4d4-redesign-a", ids.tokenA, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]);
    results.push(result(
      "QR add/order behavior remains unchanged",
      Boolean(orderResult.rows[0].payload.order_id) && Number(orderResult.rows[0].payload.total_price) === 450,
      JSON.stringify(orderResult.rows[0].payload)
    ));

    const root = path.join(__dirname, "..", "..");
    const cardSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "MenuItemCard.tsx"), "utf8");
    const infoSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "FoodInfoPanel.tsx"), "utf8");
    const nutritionSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "NutritionSummary.tsx"), "utf8");
    const pageSource = fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "pages", "QRMenuPage.tsx"), "utf8");
    const cssSource = fs.readFileSync(path.join(root, "src", "styles", "global.css"), "utf8");

    results.push(result(
      "menu card contains only image, name, short description, price, info, and add",
      cardSource.includes("menu-item-image")
        && cardSource.includes("loading=\"lazy\"")
        && cardSource.includes("decoding=\"async\"")
        && cardSource.includes("<h3>{item.name}</h3>")
        && cardSource.includes("item.description")
        && cardSource.includes("formatETBPrice(Number(item.price))")
        && cardSource.includes("food-info-icon-button")
        && cardSource.includes("menu-item-cart-button")
        && !cardSource.includes("NutritionSummary")
        && !cardSource.includes("Ingredient")
        && !cardSource.includes("preparation_time_minutes")
        && !cardSource.includes("allergens")
        && !cardSource.includes("dietary_tags")
        && !cardSource.includes("spice_level"),
      "MenuItemCard source checked"
    ));
    results.push(result(
      "info panel owns detailed food intelligence",
      infoSource.includes("IngredientList")
        && infoSource.includes("NutritionSummary")
        && infoSource.includes("scope=\"full\"")
        && infoSource.includes("Allergens")
        && infoSource.includes("SpiceLevel")
        && infoSource.includes("Preparation Time")
        && infoSource.includes("Dietary Info")
        && infoSource.includes("serving_size")
        && infoSource.includes("origin_country")
        && nutritionSource.includes("fiber_g")
        && nutritionSource.includes("sugar_g")
        && nutritionSource.includes("sodium_mg"),
      "FoodInfoPanel/NutritionSummary source checked"
    ));
    results.push(result(
      "featured carousel removed from public menu browse path",
      !pageSource.includes("FeaturedDishes"),
      "QRMenuPage source checked"
    ));
    results.push(result(
      "mobile-first one-card layout and sticky controls are enforced",
      cssSource.includes("Phase 4D.4 public QR menu redesign")
        && cssSource.includes("grid-template-columns: minmax(0, 1fr) !important")
        && cssSource.includes("position: sticky")
        && cssSource.includes("overflow-x: auto")
        && cssSource.includes("min-height: 44px")
        && cssSource.includes("min-height: 52px")
        && cssSource.includes("content-visibility: auto")
        && cssSource.includes("contain-intrinsic-size")
        && cssSource.includes("height: 100dvh")
        && cssSource.includes("foodInfoSlideUp"),
      "global.css source checked"
    ));
    results.push(result(
      "QR price format is ETB-first",
      fs.readFileSync(path.join(root, "src", "modules", "qr-menu", "components", "menuPresentation.ts"), "utf8").includes("`ETB ${"),
      "menuPresentation source checked"
    ));

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL public-menu-redesign-phase4d4-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS public-menu-redesign-phase4d4-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL public-menu-redesign-phase4d4-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await cleanup(client, ids).catch(() => {});
    await client.end().catch(() => {});
  }
}

main();
