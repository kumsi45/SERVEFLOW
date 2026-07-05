const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

const SUPPORTED_TYPES = [
  "Ethiopian Restaurant",
  "International Restaurant",
  "Cafe",
  "Hotel Restaurant",
  "Fast Food",
  "Bakery",
  "Juice Bar",
  "Fine Dining",
  "Mixed Restaurant",
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
  const envPath = [path.join(__dirname, "..", "connection.env"), path.join(__dirname, "connection.env")]
    .find((candidate) => fs.existsSync(candidate));
  if (!envPath) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  const env = readKeyValueFile(envPath);
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-phase4d-starter-template-${label}`).digest("hex").slice(0, 32);
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
  const restaurants = [ids.restaurantA, ids.restaurantB, ids.restaurantC];
  await client.query("delete from public.restaurant_starter_template_imports where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d-starter-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d-starter-%@example.test'").catch(() => {});
}

async function seedRestaurant(client, ids, key, ownerId, staffId, restaurantId, withBeverage) {
  await client.query(`
    insert into public.restaurants (id, name, slug, total_tables, table_count, setup_status)
    values ($1, $2, $3, 4, 4, '{"completed": false}'::jsonb)
  `, [restaurantId, `Phase4D Starter ${key}`, `phase4d-starter-${key}`]);

  await client.query(`
    insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
    values ($1, $2, $3, 'owner', $4, $5, true)
  `, [staffId, restaurantId, ownerId, `Owner ${key}`, `phase4d-starter-owner-${key}@example.test`]);

  await client.query(`
    insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
    values ($1, $2, 'Main Kitchen', 'Main station', '#0f766e', 'MK', 1, true)
  `, [ids[`mainStation${key}`], restaurantId]);

  if (withBeverage) {
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values ($1, $2, 'Beverage Kitchen', 'Beverage station', '#2563eb', 'BK', 2, true)
    `, [ids[`beverageStation${key}`], restaurantId]);
  }
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    ownerC: uuid("owner-c"),
    staffA: uuid("staff-a"),
    staffB: uuid("staff-b"),
    staffC: uuid("staff-c"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    restaurantC: uuid("restaurant-c"),
    mainStationA: uuid("main-station-a"),
    beverageStationA: uuid("beverage-station-a"),
    mainStationB: uuid("main-station-b"),
    beverageStationB: uuid("beverage-station-b"),
    mainStationC: uuid("main-station-c"),
    beverageStationC: uuid("beverage-station-c"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "054_restaurant_starter_templates_phase4d.sql"), "utf8"));
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d-starter-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d-starter-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d-starter-owner-c@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.ownerC]);

    await seedRestaurant(client, ids, "A", ids.ownerA, ids.staffA, ids.restaurantA, true);
    await seedRestaurant(client, ids, "B", ids.ownerB, ids.staffB, ids.restaurantB, false);
    await seedRestaurant(client, ids, "C", ids.ownerC, ids.staffC, ids.restaurantC, true);

    const templateTypes = await client.query(`
      select restaurant_type, count(*)::integer as templates
      from public.restaurant_starter_templates
      where active = true
      group by restaurant_type
    `);
    const typeMap = new Map(templateTypes.rows.map((row) => [row.restaurant_type, row.templates]));
    results.push(result(
      "Every supported restaurant type has templates",
      SUPPORTED_TYPES.every((type) => (typeMap.get(type) ?? 0) > 0),
      JSON.stringify(Object.fromEntries(typeMap))
    ));

    const templatePayload = await asRole(client, "authenticated", ids.ownerA, "select public.get_restaurant_starter_templates($1) as templates", ["Fast Food"]);
    const fetchedTemplates = templatePayload.rows[0].templates;
    results.push(result(
      "Owner flow reads starter templates from database",
      Array.isArray(fetchedTemplates) && fetchedTemplates.some((template) => template.template_key === "burgers_fast_food") && fetchedTemplates.some((template) => template.template_key === "mixed_restaurant_starter"),
      JSON.stringify(fetchedTemplates.map((template) => template.template_key))
    ));

    const setup = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      `select public.complete_restaurant_setup(
        $1,
        $2::jsonb,
        $3::jsonb,
        $4::jsonb,
        $5::jsonb,
        $6::jsonb,
        $7::jsonb,
        $8::text[]
      ) as payload`,
      [
        ids.restaurantA,
        JSON.stringify({ restaurant_name: "Phase4D Starter A Ready", restaurant_type: "Fast Food", currency: "ETB", timezone: "Africa/Nairobi" }),
        JSON.stringify({ logo_url: "", cover_url: "", tin_vat: "", receipt_footer: "", social_links: {} }),
        JSON.stringify({ table_count: 4 }),
        JSON.stringify({ opens_at: "08:00", closes_at: "22:00", closed_days: [] }),
        JSON.stringify({ mode: "single", skipped: false }),
        JSON.stringify([]),
        ["burgers_fast_food", "coffee_tea"],
      ]
    );
    const setupPayload = setup.rows[0].payload;
    results.push(result(
      "Restaurant setup imports selected templates in creation flow",
      setupPayload.restaurant.setup_status.menu_status === "starter_imported"
        && setupPayload.starter_templates.imported_templates === 2
        && setupPayload.starter_templates.items_created > 0,
      JSON.stringify(setupPayload.starter_templates)
    ));

    const copied = await client.query(`
      select
        categories.name as category_name,
        items.name as item_name,
        items.description,
        items.price,
        items.available,
        items.preparation_time_minutes,
        stations.name as station_name
      from public.menu_items items
      join public.categories categories on categories.restaurant_id = items.restaurant_id and categories.id = items.category_id
      left join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
      where items.restaurant_id = $1
      order by categories.name, items.name
    `, [ids.restaurantA]);
    const copiedNames = new Set(copied.rows.map((row) => row.item_name));
    results.push(result(
      "Categories and menu items copied",
      copied.rows.some((row) => row.category_name === "Burger") && copiedNames.has("Classic Burger") && copiedNames.has("Macchiato"),
      JSON.stringify(copied.rows.map((row) => ({ category: row.category_name, item: row.item_name })))
    ));
    results.push(result(
      "Prices, descriptions, prep times, availability copied",
      copied.rows.every((row) => Number(row.price) === 0 && row.description && row.available === true && Number(row.preparation_time_minutes) >= 0),
      JSON.stringify(copied.rows.slice(0, 4))
    ));
    results.push(result(
      "Kitchen stations mapped to Main and Beverage",
      copied.rows.some((row) => row.item_name === "Classic Burger" && row.station_name === "Main Kitchen")
        && copied.rows.some((row) => row.item_name === "Macchiato" && row.station_name === "Beverage Kitchen"),
      JSON.stringify(copied.rows.filter((row) => ["Classic Burger", "Macchiato"].includes(row.item_name)))
    ));

    const duplicateBefore = await client.query("select count(*)::integer as items from public.menu_items where restaurant_id = $1", [ids.restaurantA]);
    const duplicateImport = await asRole(client, "authenticated", ids.ownerA, "select public.import_restaurant_starter_templates($1, $2::text[]) as payload", [ids.restaurantA, ["burgers_fast_food"]]);
    const duplicateAfter = await client.query("select count(*)::integer as items from public.menu_items where restaurant_id = $1", [ids.restaurantA]);
    results.push(result(
      "Duplicate import prevented",
      duplicateBefore.rows[0].items === duplicateAfter.rows[0].items && duplicateImport.rows[0].payload.skipped_templates === 1,
      JSON.stringify({ before: duplicateBefore.rows[0], after: duplicateAfter.rows[0], payload: duplicateImport.rows[0].payload })
    ));

    await asRole(client, "authenticated", ids.ownerB, "select public.import_restaurant_starter_templates($1, $2::text[]) as payload", [ids.restaurantB, ["fresh_juices"]]);
    const fallback = await client.query(`
      select items.name, stations.name as station_name
      from public.menu_items items
      left join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
      where items.restaurant_id = $1 and items.name = 'Mango Juice'
    `, [ids.restaurantB]);
    results.push(result(
      "Beverage fallback uses Main Kitchen",
      fallback.rowCount === 1 && fallback.rows[0].station_name === "Main Kitchen",
      JSON.stringify(fallback.rows)
    ));

    const rollbackResult = await expectReject(
      "Rollback rejects invalid template set",
      () => asRole(client, "authenticated", ids.ownerC, "select public.import_restaurant_starter_templates($1, $2::text[])", [ids.restaurantC, ["coffee_tea", "missing_template"]]),
      /does not exist/i
    );
    results.push(rollbackResult);
    const rollbackState = await client.query(`
      select
        (select count(*) from public.restaurant_starter_template_imports where restaurant_id = $1)::integer as imports,
        (select count(*) from public.categories where restaurant_id = $1)::integer as categories,
        (select count(*) from public.menu_items where restaurant_id = $1)::integer as items
    `, [ids.restaurantC]);
    results.push(result(
      "Rollback leaves no partial import",
      rollbackState.rows[0].imports === 0 && rollbackState.rows[0].categories === 0 && rollbackState.rows[0].items === 0,
      JSON.stringify(rollbackState.rows[0])
    ));

    const templateBefore = await client.query("select id, name, price from public.restaurant_starter_template_items where name = 'Classic Burger' limit 1");
    await asRole(client, "authenticated", ids.ownerA, `
      update public.menu_items
      set name = 'Classic Burger Edited', price = 99
      where restaurant_id = $1 and name = 'Classic Burger'
    `, [ids.restaurantA]);
    const templateAfterEdit = await client.query("select name, price from public.restaurant_starter_template_items where id = $1", [templateBefore.rows[0]?.id ?? null]);
    results.push(result(
      "Owner edits do not modify templates",
      templateBefore.rowCount === 1 && templateAfterEdit.rowCount === 1 && templateAfterEdit.rows[0].name === "Classic Burger" && Number(templateAfterEdit.rows[0].price) === 0,
      JSON.stringify({ before: templateBefore.rows, after: templateAfterEdit.rows })
    ));

    const templateCountBeforeDelete = await client.query("select count(*)::integer as total from public.restaurant_starter_template_items");
    await asRole(client, "authenticated", ids.ownerA, "delete from public.menu_items where restaurant_id = $1 and name = 'Cheese Burger'", [ids.restaurantA]);
    const templateCountAfterDelete = await client.query("select count(*)::integer as total from public.restaurant_starter_template_items");
    results.push(result(
      "Deleting restaurant menu rows does not affect templates",
      templateCountBeforeDelete.rows[0].total === templateCountAfterDelete.rows[0].total,
      JSON.stringify({ before: templateCountBeforeDelete.rows[0], after: templateCountAfterDelete.rows[0] })
    ));

    results.push(await expectReject(
      "Multi-tenant isolation blocks other owner import",
      () => asRole(client, "authenticated", ids.ownerB, "select public.import_restaurant_starter_templates($1, $2::text[])", [ids.restaurantA, ["fresh_juices"]]),
      /only restaurant owners/i
    ));

    results.push(await expectReject(
      "Templates are read-only through RLS",
      () => asRole(client, "authenticated", ids.ownerA, "update public.restaurant_starter_templates set name = name where template_key = 'coffee_tea'"),
      /permission denied|violates row-level security/i
    ));

    results.push(await expectReject(
      "Anon cannot read starter templates directly",
      () => asRole(client, "anon", null, "select * from public.restaurant_starter_templates limit 1"),
      /permission denied|violates row-level security/i
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
