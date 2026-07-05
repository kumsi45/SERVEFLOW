const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const REQUIRED_METADATA_FIELDS = [
  "description",
  "ingredients",
  "allergens",
  "preparation_time_minutes",
  "spice_level",
  "dietary_tags",
];

const NUTRITION_FIELDS = [
  "calories",
  "protein_g",
  "carbohydrates_g",
  "fat_g",
  "fiber_g",
  "sugar_g",
  "sodium_mg",
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
  const hex = crypto.createHash("sha256").update(`serveflow-starter-template-phase4d2-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasToken(rows, pattern) {
  return rows.some((row) => pattern.test(`${row.template_name} ${row.category_name} ${row.item_name}`));
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
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_invoices where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d2-starter-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d2-starter-%@example.test'").catch(() => {});
}

async function seedRestaurant(client, ids, suffix, withBeverage) {
  const ownerId = ids[`owner${suffix}`];
  const staffId = ids[`staff${suffix}`];
  const restaurantId = ids[`restaurant${suffix}`];

  await client.query(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
    on conflict (id) do nothing
  `, [ownerId, `phase4d2-starter-owner-${suffix.toLowerCase()}@example.test`]);

  await client.query(`
    insert into public.restaurants (id, name, slug, total_tables, table_count, setup_status)
    values ($1, $2, $3, 4, 4, '{"completed": false}'::jsonb)
  `, [restaurantId, `Phase4D2 Starter ${suffix}`, `phase4d2-starter-${suffix.toLowerCase()}`]);

  await client.query(`
    insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
    values ($1, $2, $3, 'owner', $4, $5, true)
  `, [staffId, restaurantId, ownerId, `Owner ${suffix}`, `phase4d2-starter-owner-${suffix.toLowerCase()}@example.test`]);

  await client.query(`
    insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
    values ($1, $2, 'Main Kitchen', 'Main station', '#0f766e', 'MK', 1, true)
  `, [ids[`mainStation${suffix}`], restaurantId]);

  if (withBeverage) {
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values ($1, $2, 'Beverage Kitchen', 'Beverage station', '#2563eb', 'BK', 2, true)
    `, [ids[`beverageStation${suffix}`], restaurantId]);
  }
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    staffA: uuid("staff-a"),
    staffB: uuid("staff-b"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    mainStationA: uuid("main-station-a"),
    beverageStationA: uuid("beverage-station-a"),
    mainStationB: uuid("main-station-b"),
    beverageStationB: uuid("beverage-station-b"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "054_restaurant_starter_templates_phase4d.sql"), "utf8"));
    await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "055_menu_data_foundation_phase4d1.sql"), "utf8"));
    await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "056_starter_template_upgrade_phase4d2.sql"), "utf8"));

    await cleanup(client, ids);
    await seedRestaurant(client, ids, "A", true);
    await seedRestaurant(client, ids, "B", false);

    const allItems = await client.query(`
      select
        templates.name as template_name,
        templates.restaurant_type,
        categories.name as category_name,
        items.name as item_name,
        items.description,
        items.ingredients,
        items.allergens,
        items.preparation_time_minutes,
        items.spice_level,
        items.dietary_tags,
        items.calories,
        items.protein_g,
        items.carbohydrates_g,
        items.fat_g,
        items.fiber_g,
        items.sugar_g,
        items.sodium_mg
      from public.restaurant_starter_templates templates
      join public.restaurant_starter_template_categories categories on categories.template_id = templates.id
      join public.restaurant_starter_template_items items on items.template_category_id = categories.id
      where templates.active = true
      order by templates.restaurant_type, templates.name, categories.display_order, items.display_order
    `);

    results.push(result("starter template items exist", allItems.rowCount > 0, `items=${allItems.rowCount}`));

    const missingMetadata = allItems.rows.filter((item) => {
      return !hasText(item.description)
        || !hasArray(item.ingredients)
        || !hasArray(item.allergens)
        || item.preparation_time_minutes === null
        || item.spice_level === null
        || Number(item.spice_level) < 0
        || Number(item.spice_level) > 5
        || !hasArray(item.dietary_tags);
    });
    results.push(result(
      "every starter item has Phase 4D.2 metadata",
      missingMetadata.length === 0,
      missingMetadata.slice(0, 5).map((item) => `${item.template_name}/${item.category_name}/${item.item_name}`).join(", ")
    ));

    const withNutrition = allItems.rows.filter((item) => NUTRITION_FIELDS.some((field) => item[field] !== null));
    results.push(result(
      "starter templates do not include calories or nutrition yet",
      withNutrition.length === 0,
      withNutrition.slice(0, 5).map((item) => `${item.template_name}/${item.item_name}`).join(", ")
    ));

    results.push(result("international pizza template coverage", hasToken(allItems.rows, /pizza/i)));
    results.push(result("international burger template coverage", hasToken(allItems.rows, /burger/i)));
    results.push(result("international pasta template coverage", hasToken(allItems.rows, /pasta|spaghetti|penne/i)));
    results.push(result("international coffee template coverage", hasToken(allItems.rows, /coffee|espresso|macchiato|latte|cappuccino/i)));
    results.push(result("international drinks template coverage", hasToken(allItems.rows, /drink|cola|soda|water/i)));

    const ethiopianRows = allItems.rows.filter((row) => row.restaurant_type === "Ethiopian Restaurant");
    results.push(result("ethiopian shiro coverage", hasToken(ethiopianRows, /shiro/i)));
    results.push(result("ethiopian tibs coverage", hasToken(ethiopianRows, /tibs/i)));
    results.push(result("ethiopian kitfo coverage", hasToken(ethiopianRows, /kitfo/i)));
    results.push(result("ethiopian firfir coverage", hasToken(ethiopianRows, /firfir/i)));
    results.push(result("ethiopian beyaynetu coverage", hasToken(ethiopianRows, /beyaynetu/i)));
    results.push(result("ethiopian doro wot coverage", hasToken(ethiopianRows, /doro wot/i)));
    results.push(result("ethiopian fish coverage", hasToken(ethiopianRows, /fish|asa|perch/i)));
    results.push(result("ethiopian juice coverage", hasToken(ethiopianRows, /juice|mango|avocado/i)));
    results.push(result("ethiopian tea coverage", hasToken(ethiopianRows, /tea/i)));
    results.push(result("ethiopian coffee coverage", hasToken(ethiopianRows, /coffee|macchiato/i)));

    const exportedTemplates = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      "select public.get_restaurant_starter_templates($1) as templates",
      ["Ethiopian Restaurant"]
    );
    const exportPayload = exportedTemplates.rows[0].templates;
    const exportedItem = exportPayload
      .flatMap((template) => template.categories)
      .flatMap((category) => category.items)
      .find((item) => item.name === "Ethiopian Coffee");

    results.push(result(
      "starter template export includes Phase 4D.2 metadata",
      !!exportedItem
        && REQUIRED_METADATA_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(exportedItem, field))
        && Array.isArray(exportedItem.ingredients)
        && exportedItem.ingredients.includes("ethiopian coffee")
        && Array.isArray(exportedItem.dietary_tags)
        && exportedItem.dietary_tags.includes("beverage"),
      JSON.stringify(exportedItem ?? null)
    ));
    results.push(result(
      "starter template export keeps calories empty",
      !!exportedItem && NUTRITION_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(exportedItem, field) && exportedItem[field] === null),
      JSON.stringify(exportedItem ?? null)
    ));

    const importResult = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      "select public.import_restaurant_starter_templates($1, $2::text[]) as payload",
      [ids.restaurantA, ["ethiopian_fish_juice_tea_coffee"]]
    );
    const importPayload = importResult.rows[0].payload;
    results.push(result(
      "starter template import created categories and menu items",
      Number(importPayload.categories_created) === 4 && Number(importPayload.items_created) === 8,
      JSON.stringify(importPayload)
    ));

    const importedItems = await client.query(`
      select
        menu_items.name,
        menu_items.description,
        menu_items.ingredients,
        menu_items.allergens,
        menu_items.preparation_time_minutes,
        menu_items.spice_level,
        menu_items.dietary_tags,
        menu_items.calories,
        menu_items.protein_g,
        menu_items.carbohydrates_g,
        menu_items.fat_g,
        menu_items.fiber_g,
        menu_items.sugar_g,
        menu_items.sodium_mg,
        kitchen_stations.name as station_name
      from public.menu_items
      left join public.kitchen_stations on kitchen_stations.id = menu_items.kitchen_station_id
      where menu_items.restaurant_id = $1
        and menu_items.name in ('Asa Tibs', 'Ethiopian Coffee')
      order by menu_items.name
    `, [ids.restaurantA]);

    const importedFish = importedItems.rows.find((item) => item.name === "Asa Tibs");
    const importedCoffee = importedItems.rows.find((item) => item.name === "Ethiopian Coffee");
    results.push(result(
      "starter import copies enriched item metadata",
      !!importedFish
        && hasText(importedFish.description)
        && importedFish.ingredients.includes("fish")
        && importedFish.allergens.includes("fish")
        && Number(importedFish.spice_level) === 2
        && importedFish.dietary_tags.includes("ethiopian"),
      JSON.stringify(importedFish ?? null)
    ));
    results.push(result(
      "starter import copies no calories or nutrition",
      importedItems.rows.length === 2 && importedItems.rows.every((item) => NUTRITION_FIELDS.every((field) => item[field] === null)),
      JSON.stringify(importedItems.rows)
    ));
    results.push(result(
      "starter import maps beverage items to Beverage Kitchen",
      !!importedCoffee && importedCoffee.station_name === "Beverage Kitchen",
      JSON.stringify(importedCoffee ?? null)
    ));

    await asRole(
      client,
      "authenticated",
      ids.ownerB,
      "select public.import_restaurant_starter_templates($1, $2::text[])",
      [ids.restaurantB, ["ethiopian_fish_juice_tea_coffee"]]
    );
    const fallbackStation = await client.query(`
      select kitchen_stations.name as station_name
      from public.menu_items
      join public.kitchen_stations on kitchen_stations.id = menu_items.kitchen_station_id
      where menu_items.restaurant_id = $1
        and menu_items.name = 'Ethiopian Coffee'
      limit 1
    `, [ids.restaurantB]);
    results.push(result(
      "beverage template items fall back to Main Kitchen",
      fallbackStation.rows[0]?.station_name === "Main Kitchen",
      JSON.stringify(fallbackStation.rows[0] ?? null)
    ));

    const duplicateImport = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      "select public.import_restaurant_starter_templates($1, $2::text[]) as payload",
      [ids.restaurantA, ["ethiopian_fish_juice_tea_coffee"]]
    );
    results.push(result(
      "duplicate starter imports are prevented",
      Number(duplicateImport.rows[0].payload.skipped_templates) === 1 && Number(duplicateImport.rows[0].payload.items_created) === 0,
      JSON.stringify(duplicateImport.rows[0].payload)
    ));

    const anonSelect = await expectReject(
      "template tables remain read-protected from anon",
      () => asRole(client, "anon", null, "select count(*) from public.restaurant_starter_template_items"),
      /permission denied|violates row-level security|not permitted/i
    );
    results.push(anonSelect);

    const unauthorizedImport = await expectReject(
      "starter imports remain owner-only",
      () => asRole(client, "authenticated", ids.ownerB, "select public.import_restaurant_starter_templates($1, $2::text[])", [ids.restaurantA, ["coffee_tea"]]),
      /Only restaurant owners|permission denied|not authorized/i
    );
    results.push(unauthorizedImport);

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL starter-template-upgrade-phase4d2-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS starter-template-upgrade-phase4d2-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL starter-template-upgrade-phase4d2-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await cleanup(client, ids).catch(() => {});
    await client.end().catch(() => {});
  }
}

main();
