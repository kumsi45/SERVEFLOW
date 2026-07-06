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
  const hex = crypto.createHash("sha256").update(`serveflow-app-url-configuration-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

async function applyMigration(client) {
  await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "061_app_url_configuration.sql"), "utf8"));
  await client.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "064_public_qr_reliability_phase5.sql"), "utf8"));
}

async function asRoleInOpenTransaction(client, role, userId, sql, params = []) {
  await client.query("reset role");
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
  if (userId) {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  } else {
    await client.query("select set_config('request.jwt.claim.sub', '', true)");
  }
  const queryResult = await client.query(sql, params);
  await client.query("reset role");
  return queryResult;
}

async function main() {
  const ids = {
    ownerUser: uuid("owner-user"),
    cashierUser: uuid("cashier-user"),
    kitchenUser: uuid("kitchen-user"),
    ownerStaff: uuid("owner-staff"),
    cashierStaff: uuid("cashier-staff"),
    kitchenStaff: uuid("kitchen-staff"),
    restaurant: uuid("restaurant"),
    station: uuid("station"),
    category: uuid("category"),
    item: uuid("item"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  const root = path.join(__dirname, "..", "..");

  await client.connect();
  try {
    await applyMigration(client);

    await client.query("begin");
    try {
      await client.query("insert into public.application_settings (key, value) values ('app_url', 'https://app-url-audit.example.test') on conflict (key) do update set value = excluded.value");
      await client.query(`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values
          ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'app-url-owner@example.test', '', now(), now(), now()),
          ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'app-url-cashier@example.test', '', now(), now(), now()),
          ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'app-url-kitchen@example.test', '', now(), now(), now())
      `, [ids.ownerUser, ids.cashierUser, ids.kitchenUser]);
      await client.query(`
        insert into public.restaurants (id, name, slug, total_tables, table_count)
        values ($1, 'App URL Audit', 'app-url-audit', 2, 2)
      `, [ids.restaurant]);
      await client.query(`
        insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
        values
          ($1, $4, $5, 'owner', 'App URL Owner', 'app-url-owner@example.test', true),
          ($2, $4, $6, 'cashier', 'App URL Cashier', 'app-url-cashier@example.test', true),
          ($3, $4, $7, 'kitchen', 'App URL Kitchen', 'app-url-kitchen@example.test', true)
      `, [ids.ownerStaff, ids.cashierStaff, ids.kitchenStaff, ids.restaurant, ids.ownerUser, ids.cashierUser, ids.kitchenUser]);
      const existingStation = await client.query(
        "select id from public.kitchen_stations where restaurant_id = $1 and lower(name) = lower('Main Kitchen') limit 1",
        [ids.restaurant]
      );
      const stationId = existingStation.rows[0]?.id ?? ids.station;
      if (existingStation.rowCount === 0) {
        await client.query("insert into public.kitchen_stations (id, restaurant_id, name, priority, active) values ($1, $2, 'Main Kitchen', 1, true)", [stationId, ids.restaurant]);
      }
      await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $2, 'Food')", [ids.category, ids.restaurant]);
      await client.query(`
        insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
        values ($1, $2, $3, 'Burger', 450, true, $4)
      `, [ids.item, ids.restaurant, ids.category, stationId]);

      const initialTables = await asRoleInOpenTransaction(
        client,
        "authenticated",
        ids.ownerUser,
        "select id, table_number, qr_token, qr_path, qr_url from public.sync_restaurant_tables($1, 2) order by table_number",
        [ids.restaurant]
      );
      results.push(result(
        "QR uses configured APP_URL",
        initialTables.rows.length === 2
          && initialTables.rows.every((row) => row.qr_url.startsWith("https://app-url-audit.example.test/r/app-url-audit?t="))
          && initialTables.rows.every((row) => row.qr_path.startsWith("/r/app-url-audit?t=")),
        JSON.stringify(initialTables.rows)
      ));

      const before = new Map(initialTables.rows.map((row) => [row.table_number, { id: row.id, token: row.qr_token }]));

      const lanUrl = await asRoleInOpenTransaction(client, "authenticated", ids.ownerUser, "select public.set_app_url($1) as app_url", ["http://10.61.145.181:5173"]);
      const lanTables = await client.query("select id, table_number, qr_token, qr_url from public.restaurant_tables where restaurant_id = $1 order by table_number", [ids.restaurant]);
      results.push(result(
        "LAN IP APP_URL works and preserves identifiers",
        lanUrl.rows[0].app_url === "http://10.61.145.181:5173"
          && lanTables.rows.every((row) => row.qr_url.startsWith("http://10.61.145.181:5173/r/app-url-audit?t="))
          && lanTables.rows.every((row) => before.get(row.table_number).id === row.id && before.get(row.table_number).token === row.qr_token),
        JSON.stringify(lanTables.rows)
      ));

      const productionUrl = await asRoleInOpenTransaction(client, "authenticated", ids.ownerUser, "select public.set_app_url($1) as app_url", ["https://yourdomain.com"]);
      const productionTables = await client.query("select id, table_number, qr_token, qr_path, qr_url from public.restaurant_tables where restaurant_id = $1 order by table_number", [ids.restaurant]);
      results.push(result(
        "Production APP_URL works",
        productionUrl.rows[0].app_url === "https://yourdomain.com"
          && productionTables.rows.every((row) => row.qr_url.startsWith("https://yourdomain.com/r/app-url-audit?t="))
          && productionTables.rows.every((row) => row.qr_path.startsWith("/r/app-url-audit?t=")),
        JSON.stringify(productionTables.rows)
      ));

      const regenerated = await asRoleInOpenTransaction(
        client,
        "authenticated",
        ids.ownerUser,
        "select id, table_number, qr_token, qr_url from public.regenerate_all_restaurant_table_qr($1) order by table_number",
        [ids.restaurant]
      );
      results.push(result(
        "Regenerated QR rotates tokens and preserves table IDs",
        regenerated.rows.length === 2
          && regenerated.rows.every((row) => row.qr_url.startsWith("https://yourdomain.com/r/app-url-audit?t="))
          && regenerated.rows.every((row) => before.get(row.table_number).id === row.id && before.get(row.table_number).token !== row.qr_token),
        JSON.stringify(regenerated.rows)
      ));

      const singleBefore = regenerated.rows[0];
      const single = await asRoleInOpenTransaction(
        client,
        "authenticated",
        ids.ownerUser,
        "select id, table_number, qr_token, qr_url from public.regenerate_restaurant_table_qr($1, $2)",
        [ids.restaurant, singleBefore.id]
      );
      results.push(result(
        "Single QR regenerate rotates token",
        single.rows[0].id === singleBefore.id
          && single.rows[0].qr_token !== singleBefore.qr_token
          && single.rows[0].qr_url.startsWith("https://yourdomain.com/r/app-url-audit?t=1"),
        JSON.stringify(single.rows[0])
      ));

      const qrOrder = await asRoleInOpenTransaction(
        client,
        "anon",
        null,
        "select public.create_public_qr_order($1, '1', $2, 'App URL Guest', 'Cash', $3::jsonb) as payload",
        ["app-url-audit", single.rows[0].qr_token, JSON.stringify([{ menu_item_id: ids.item, quantity: 1 }])]
      );
      results.push(result(
        "No ordering regression",
        qrOrder.rows[0].payload.status === "pending_payment" && Number(qrOrder.rows[0].payload.total_price) === 450,
        JSON.stringify(qrOrder.rows[0].payload)
      ));

      const cashierQueue = await asRoleInOpenTransaction(
        client,
        "authenticated",
        ids.cashierUser,
        "select id, status, total_price from public.orders where restaurant_id = $1 and status = 'pending_payment'",
        [ids.restaurant]
      );
      results.push(result(
        "No cashier regression",
        cashierQueue.rowCount === 1 && Number(cashierQueue.rows[0].total_price) === 450,
        JSON.stringify(cashierQueue.rows)
      ));

      const kitchenSource = fs.readFileSync(path.join(root, "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx"), "utf8");
      const cashierSource = fs.readFileSync(path.join(root, "src", "modules", "cashier", "pages", "CashierDashboardPage.tsx"), "utf8");
      results.push(result(
        "No kitchen regression",
        !kitchenSource.includes("get_app_url")
          && !kitchenSource.includes("set_app_url")
          && !kitchenSource.includes("regenerate_all_restaurant_table_qr"),
        "KitchenDashboardPage does not depend on APP_URL configuration."
      ));
      results.push(result(
        "Cashier module remains APP_URL-free",
        !cashierSource.includes("get_app_url")
          && !cashierSource.includes("set_app_url")
          && !cashierSource.includes("regenerate_all_restaurant_table_qr"),
        "CashierDashboardPage does not depend on APP_URL configuration."
      ));

      const appUrlSource = fs.readFileSync(path.join(root, "src", "core", "config", "appUrl.ts"), "utf8");
      const ownerSource = fs.readFileSync(path.join(root, "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
      results.push(result(
        "No automatic IP or browser origin detection",
        !appUrlSource.includes("window.location.origin")
          && !appUrlSource.includes("getBrowserOrigin")
          && !appUrlSource.includes("isLoopbackOrigin")
          && appUrlSource.includes("DEFAULT_APP_ORIGIN")
          && ownerSource.includes("Application URL")
          && ownerSource.includes("Regenerate All QR Codes"),
        "source checked"
      ));

      await client.query("rollback");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }

    const failed = results.filter((check) => !check.ok);
    for (const check of results) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` :: ${check.detail}` : ""}`);
    }
    if (failed.length > 0) {
      process.exitCode = 1;
      console.error(`\nFAIL app-url-configuration-audit: ${failed[0].label}`);
    } else {
      console.log("\nPASS app-url-configuration-audit");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL app-url-configuration-audit :: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
