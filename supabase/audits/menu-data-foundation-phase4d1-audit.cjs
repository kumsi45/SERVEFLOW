const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

const MENU_FOUNDATION_FIELDS = [
  "ingredients",
  "allergens",
  "preparation_time_minutes",
  "spice_level",
  "dietary_tags",
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
  const hex = crypto.createHash("sha256").update(`serveflow-menu-data-foundation-phase4d1-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

function hasEveryField(value, fields = MENU_FOUNDATION_FIELDS) {
  return fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function missingFields(value, fields = MENU_FOUNDATION_FIELDS) {
  return fields.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
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
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d1-menu-%'", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_starter_templates where template_key = 'phase4d1_audit_template'").catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d1-menu-%@example.test'").catch(() => {});
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    staffA: uuid("staff-a"),
    staffB: uuid("staff-b"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    stationA: uuid("station-a"),
    stationB: uuid("station-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    itemA: uuid("item-a"),
    itemB: uuid("item-b"),
    tableA: uuid("table-a"),
    tokenA: uuid("token-a"),
    template: uuid("template"),
    templateCategory: uuid("template-category"),
    templateItem: uuid("template-item"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "054_restaurant_starter_templates_phase4d.sql"), "utf8"));
    await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "055_menu_data_foundation_phase4d1.sql"), "utf8"));
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d1-menu-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d1-menu-owner-b@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Phase 4D1 Menu A', 'phase4d1-menu-a', 4, 4),
        ($2, 'Phase 4D1 Menu B', 'phase4d1-menu-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Owner A', 'phase4d1-menu-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Owner B', 'phase4d1-menu-owner-b@example.test', true)
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
        ($1, $3, 'Menu'),
        ($2, $4, 'Menu')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values ($1, $2, 1, 'Table 1', $3, '/r/phase4d1-menu-a/order?t=1', '/r/phase4d1-menu-a/order?t=1', true)
    `, [ids.tableA, ids.restaurantA, ids.tokenA]);

    const columns = await client.query(`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'menu_items'
        and column_name = any($1::text[])
      order by column_name
    `, [["description", ...MENU_FOUNDATION_FIELDS]]);
    results.push(result(
      "Nullable menu metadata columns exist",
      columns.rowCount === 13 && columns.rows.every((row) => row.is_nullable === "YES"),
      JSON.stringify(columns.rows)
    ));

    const rpcDefinitions = await client.query(`
      select proname, pg_get_functiondef(p.oid) as definition
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any($1::text[])
    `, [["get_public_qr_menu", "get_restaurant_starter_templates", "import_restaurant_starter_templates"]]);
    const rpcCoverage = Object.fromEntries(rpcDefinitions.rows.map((row) => [
      row.proname,
      MENU_FOUNDATION_FIELDS.filter((field) => !row.definition.includes(field)),
    ]));
    results.push(result(
      "Active menu RPC definitions include every foundation field",
      rpcDefinitions.rowCount === 3 && Object.values(rpcCoverage).every((missing) => missing.length === 0),
      JSON.stringify(rpcCoverage)
    ));

    const menuCrudRpcs = await client.query(`
      select proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and proname ~ '(create|update|upsert).*menu.*item'
      order by proname
    `);
    results.push(result(
      "No create/update menu CRUD RPCs exist outside direct owner table writes",
      menuCrudRpcs.rowCount === 0,
      JSON.stringify(menuCrudRpcs.rows)
    ));

    const ownerSource = fs.readFileSync(path.join(__dirname, "..", "..", "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    const managerSourcePaths = [
      path.join(__dirname, "..", "..", "src", "modules", "manager"),
      path.join(__dirname, "..", "..", "src", "modules", "manager-dashboard"),
    ];
    const ownerMissingFields = MENU_FOUNDATION_FIELDS.filter((field) => !ownerSource.includes(field));
    results.push(result(
      "Owner menu retrieval path includes every foundation field",
      ownerMissingFields.length === 0,
      JSON.stringify(ownerMissingFields)
    ));
    results.push(result(
      "No separate manager menu retrieval path exists",
      managerSourcePaths.every((sourcePath) => !fs.existsSync(sourcePath)),
      JSON.stringify(managerSourcePaths.filter((sourcePath) => fs.existsSync(sourcePath)))
    ));

    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Minimal Burger', 100, true, $4)
    `, [ids.itemA, ids.restaurantA, ids.categoryA, ids.stationA]);
    const minimal = await client.query("select * from public.menu_items where id = $1", [ids.itemA]);
    results.push(result(
      "Existing minimal menu item insert remains valid",
      minimal.rowCount === 1
        && minimal.rows[0].ingredients === null
        && minimal.rows[0].allergens === null
        && minimal.rows[0].calories === null,
      JSON.stringify({ ingredients: minimal.rows[0]?.ingredients, allergens: minimal.rows[0]?.allergens, calories: minimal.rows[0]?.calories })
    ));

    await asRole(client, "authenticated", ids.ownerA, `
      update public.menu_items
      set
        description = 'A complete international menu metadata row.',
        ingredients = array['beef', 'bun', 'lettuce']::text[],
        allergens = array['gluten']::text[],
        preparation_time_minutes = 12,
        spice_level = 2,
        dietary_tags = array['halal']::text[],
        calories = 650,
        protein_g = 32.5,
        carbohydrates_g = 48,
        fat_g = 28.25,
        fiber_g = 4,
        sugar_g = 6.5,
        sodium_mg = 920
      where id = $1 and restaurant_id = $2
    `, [ids.itemA, ids.restaurantA]);
    const updated = await client.query(`
      select description, ingredients, allergens, preparation_time_minutes, spice_level, dietary_tags,
             calories, protein_g, carbohydrates_g, fat_g, fiber_g, sugar_g, sodium_mg
      from public.menu_items
      where id = $1
    `, [ids.itemA]);
    results.push(result(
      "Owner can store all foundation fields",
      updated.rows[0].description
        && updated.rows[0].ingredients.includes("beef")
        && updated.rows[0].allergens.includes("gluten")
        && updated.rows[0].preparation_time_minutes === 12
        && updated.rows[0].spice_level === 2
        && updated.rows[0].dietary_tags.includes("halal")
        && Number(updated.rows[0].calories) === 650
        && Number(updated.rows[0].protein_g) === 32.5,
      JSON.stringify(updated.rows[0])
    ));

    const publicMenu = await asRole(client, "anon", null, "select public.get_public_qr_menu($1) as menu", ["phase4d1-menu-a"]);
    const publicItem = publicMenu.rows[0].menu.items.find((item) => item.id === ids.itemA);
    results.push(result(
      "Public menu RPC returns metadata without changing ordering payload shape",
      publicItem
        && hasEveryField(publicItem)
        && publicItem.name === "Minimal Burger"
        && publicItem.ingredients.includes("beef")
        && publicItem.allergens.includes("gluten")
        && publicItem.calories === 650
        && publicItem.price === 100,
      JSON.stringify({ missing: publicItem ? missingFields(publicItem) : MENU_FOUNDATION_FIELDS, item: publicItem })
    ));

    const orderResult = await asRole(client, "anon", null, `
      select public.create_public_qr_order($1, '1', $2, 'Metadata Guest', 'Cash', $3::jsonb) as payload
    `, ["phase4d1-menu-a", ids.tokenA, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]);
    results.push(result(
      "QR ordering still accepts metadata-backed menu item",
      Boolean(orderResult.rows[0].payload.order_id) && Number(orderResult.rows[0].payload.total_price) === 100,
      JSON.stringify(orderResult.rows[0].payload)
    ));

    await client.query(`
      insert into public.restaurant_starter_templates (id, template_key, restaurant_type, name, description, display_order, active)
      values ($1, 'phase4d1_audit_template', 'Cafe', 'Phase 4D1 Audit Template', 'Temporary audit template.', 999, true)
    `, [ids.template]);
    await client.query(`
      insert into public.restaurant_starter_template_categories (id, template_id, name, description, display_order)
      values ($1, $2, 'Audit Drinks', 'Temporary audit drinks.', 1)
    `, [ids.templateCategory, ids.template]);
    await client.query(`
      insert into public.restaurant_starter_template_items (
        id,
        template_id,
        template_category_id,
        name,
        description,
        ingredients,
        allergens,
        preparation_time_minutes,
        spice_level,
        dietary_tags,
        calories,
        protein_g,
        carbohydrates_g,
        fat_g,
        fiber_g,
        sugar_g,
        sodium_mg,
        suggested_station,
        available,
        price,
        image_url,
        display_order
      )
      values (
        $1,
        $2,
        $3,
        'Phase 4D1 Audit Latte',
        'Temporary audit latte.',
        array['espresso', 'milk']::text[],
        array['milk']::text[],
        6,
        0,
        array['vegetarian']::text[],
        120,
        6,
        10,
        5,
        0,
        8,
        80,
        'beverage',
        true,
        0,
        null,
        1
      )
    `, [ids.templateItem, ids.template, ids.templateCategory]);

    const templates = await asRole(client, "authenticated", ids.ownerB, "select public.get_restaurant_starter_templates($1) as templates", ["Cafe"]);
    const coffeeTemplate = templates.rows[0].templates.flatMap((template) => template.categories).flatMap((category) => category.items).find((item) => item.name === "Phase 4D1 Audit Latte");
    results.push(result(
      "Starter template RPC returns metadata fields",
      coffeeTemplate
        && hasEveryField(coffeeTemplate)
        && coffeeTemplate.ingredients.includes("espresso")
        && coffeeTemplate.allergens.includes("milk")
        && coffeeTemplate.dietary_tags.includes("vegetarian")
        && coffeeTemplate.calories === 120,
      JSON.stringify({ missing: coffeeTemplate ? missingFields(coffeeTemplate) : MENU_FOUNDATION_FIELDS, item: coffeeTemplate })
    ));

    await asRole(client, "authenticated", ids.ownerB, "select public.import_restaurant_starter_templates($1, $2::text[])", [ids.restaurantB, ["phase4d1_audit_template"]]);
    const imported = await client.query(`
      select ingredients, allergens, preparation_time_minutes, spice_level, dietary_tags,
             calories, protein_g, carbohydrates_g, fat_g, fiber_g, sugar_g, sodium_mg
      from public.menu_items
      where restaurant_id = $1 and name = 'Phase 4D1 Audit Latte'
      limit 1
    `, [ids.restaurantB]);
    results.push(result(
      "Starter template import copies metadata fields",
      imported.rowCount === 1
        && imported.rows[0].ingredients.includes("espresso")
        && imported.rows[0].allergens.includes("milk")
        && imported.rows[0].preparation_time_minutes === 6
        && imported.rows[0].spice_level === 0
        && imported.rows[0].dietary_tags.includes("vegetarian")
        && Number(imported.rows[0].calories) === 120
        && Number(imported.rows[0].protein_g) === 6
        && Number(imported.rows[0].carbohydrates_g) === 10
        && Number(imported.rows[0].fat_g) === 5
        && Number(imported.rows[0].fiber_g) === 0
        && Number(imported.rows[0].sugar_g) === 8
        && Number(imported.rows[0].sodium_mg) === 80,
      JSON.stringify(imported.rows[0])
    ));

    results.push(await expectReject(
      "Spice level constraint rejects invalid values",
      () => asRole(client, "authenticated", ids.ownerA, "update public.menu_items set spice_level = 9 where id = $1", [ids.itemA]),
      /spice_level|constraint/i
    ));

    results.push(await expectReject(
      "Nutrition constraints reject negative values",
      () => asRole(client, "authenticated", ids.ownerA, "update public.menu_items set calories = -1 where id = $1", [ids.itemA]),
      /nutrition|constraint/i
    ));

    const crossTenantUpdate = await asRole(client, "authenticated", ids.ownerB, "update public.menu_items set calories = 1 where id = $1 and restaurant_id = $2", [ids.itemA, ids.restaurantA]);
    results.push(result(
      "RLS still prevents cross-tenant menu edits",
      crossTenantUpdate.rowCount === 0,
      JSON.stringify({ rowCount: crossTenantUpdate.rowCount })
    ));

    const crossTenant = await client.query("select calories from public.menu_items where id = $1", [ids.itemA]);
    results.push(result(
      "Cross-tenant edit did not change owner item",
      Number(crossTenant.rows[0].calories) === 650,
      JSON.stringify(crossTenant.rows[0])
    ));

    try {
      execSync("npm run build", { cwd: path.join(__dirname, "..", ".."), stdio: "pipe" });
      results.push(result("Build passes", true));
    } catch (error) {
      results.push(result("Build passes", false, error.stdout?.toString() || error.message));
    }
  } finally {
    await cleanup(client, ids);
    await client.end();
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}: ${entry.detail}`);
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
