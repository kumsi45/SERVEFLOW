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
  const envPath = path.join(__dirname, "..", "connection.env");
  const env = readKeyValueFile(envPath);
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-category-hero-phase4d3-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

function hasHttpsUrl(value) {
  return typeof value === "string" && /^https:\/\//.test(value);
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
  const restaurants = [ids.restaurantA];
  await client.query("delete from public.restaurant_starter_template_imports where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_invoices where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug like 'phase4d3-hero-%'", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'phase4d3-hero-%@example.test'").catch(() => {});
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    staffA: uuid("staff-a"),
    restaurantA: uuid("restaurant-a"),
    stationA: uuid("station-a"),
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
    ]) {
      await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", migration), "utf8"));
    }

    await cleanup(client, ids);

    const columns = await client.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('categories', 'restaurant_starter_template_categories')
        and column_name = 'hero_image_url'
    `);
    results.push(result("category hero image columns exist", columns.rowCount === 2, JSON.stringify(columns.rows)));

    const missingTemplateImages = await client.query(`
      select templates.template_key, categories.name
      from public.restaurant_starter_templates templates
      join public.restaurant_starter_template_categories categories on categories.template_id = templates.id
      where templates.active = true
        and nullif(btrim(coalesce(categories.hero_image_url, '')), '') is null
      limit 5
    `);
    results.push(result("all active starter categories have hero images", missingTemplateImages.rowCount === 0, JSON.stringify(missingTemplateImages.rows)));

    const starterTemplates = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      "select public.get_restaurant_starter_templates($1) as templates",
      ["International Restaurant"]
    );
    const pizzaCategory = starterTemplates.rows[0].templates
      .flatMap((template) => template.categories)
      .find((category) => category.name === "Pizza");
    results.push(result(
      "starter template export includes category hero image",
      !!pizzaCategory && hasHttpsUrl(pizzaCategory.hero_image_url),
      JSON.stringify(pizzaCategory ?? null)
    ));

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase4d3-hero-owner@example.test', '', now(), now(), now())
    `, [ids.ownerA]);
    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values ($1, 'Phase4D3 Hero Restaurant', 'phase4d3-hero-restaurant', 3, 3)
    `, [ids.restaurantA]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values ($1, $2, $3, 'owner', 'Phase4D3 Owner', 'phase4d3-hero-owner@example.test', true)
    `, [ids.staffA, ids.restaurantA, ids.ownerA]);
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values ($1, $2, 'Main Kitchen', 'Main station', '#0f766e', 'MK', 1, true)
    `, [ids.stationA, ids.restaurantA]);

    const importResult = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      "select public.import_restaurant_starter_templates($1, $2::text[]) as payload",
      [ids.restaurantA, ["international_pizza_pasta"]]
    );
    results.push(result(
      "starter import creates category-owned hero images",
      Number(importResult.rows[0].payload.categories_created) === 2 && Number(importResult.rows[0].payload.items_created) === 7,
      JSON.stringify(importResult.rows[0].payload)
    ));

    const importedPizza = await client.query(`
      select categories.hero_image_url, menu_items.image_url
      from public.menu_items
      join public.categories on categories.id = menu_items.category_id
      where menu_items.restaurant_id = $1
        and menu_items.name = 'Margherita Pizza'
      limit 1
    `, [ids.restaurantA]);
    results.push(result(
      "imported item does not require an item image",
      importedPizza.rowCount === 1 && importedPizza.rows[0].image_url === null && hasHttpsUrl(importedPizza.rows[0].hero_image_url),
      JSON.stringify(importedPizza.rows[0] ?? null)
    ));

    const publicMenu = await asRole(
      client,
      "anon",
      null,
      "select public.get_public_qr_menu($1) as menu",
      ["phase4d3-hero-restaurant"]
    );
    const menuPayload = publicMenu.rows[0].menu;
    const publicPizzaCategory = menuPayload.categories.find((category) => category.name === "Pizza");
    const publicPizzaItem = menuPayload.items.find((item) => item.name === "Margherita Pizza");
    results.push(result(
      "public menu exposes category hero image",
      !!publicPizzaCategory && hasHttpsUrl(publicPizzaCategory.hero_image_url),
      JSON.stringify(publicPizzaCategory ?? null)
    ));
    results.push(result(
      "public menu item falls back to category hero image",
      !!publicPizzaItem
        && publicPizzaItem.image_url === null
        && publicPizzaItem.effective_image_url === publicPizzaCategory.hero_image_url
        && publicPizzaItem.category_image_url === publicPizzaCategory.hero_image_url,
      JSON.stringify(publicPizzaItem ?? null)
    ));

    const overrideUrl = "https://example.com/item-override.jpg";
    await client.query(`
      update public.menu_items
      set image_url = $1
      where restaurant_id = $2
        and name = 'Margherita Pizza'
    `, [overrideUrl, ids.restaurantA]);

    const overrideMenu = await asRole(
      client,
      "anon",
      null,
      "select public.get_public_qr_menu($1) as menu",
      ["phase4d3-hero-restaurant"]
    );
    const overriddenPizzaItem = overrideMenu.rows[0].menu.items.find((item) => item.name === "Margherita Pizza");
    results.push(result(
      "item image override wins over category hero image",
      !!overriddenPizzaItem
        && overriddenPizzaItem.image_url === overrideUrl
        && overriddenPizzaItem.effective_image_url === overrideUrl
        && overriddenPizzaItem.category_image_url === publicPizzaCategory.hero_image_url,
      JSON.stringify(overriddenPizzaItem ?? null)
    ));

    const manualCategory = await client.query(`
      insert into public.categories (restaurant_id, name)
      values ($1, 'Chef Specials')
      returning public.resolve_menu_category_hero_image(name) as resolved_hero_image
    `, [ids.restaurantA]);
    results.push(result(
      "manual categories receive a resolvable hero fallback",
      hasHttpsUrl(manualCategory.rows[0]?.resolved_hero_image),
      JSON.stringify(manualCategory.rows[0] ?? null)
    ));

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }

    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL category-hero-images-phase4d3-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS category-hero-images-phase4d3-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL category-hero-images-phase4d3-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await cleanup(client, ids).catch(() => {});
    await client.end().catch(() => {});
  }
}

main();
