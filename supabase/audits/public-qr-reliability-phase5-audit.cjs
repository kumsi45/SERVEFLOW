const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

const supabaseRoot = path.join(__dirname, "..");
const sourceRoot = path.join(supabaseRoot, "..");

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
  const env = readKeyValueFile(path.join(supabaseRoot, "connection.env"));
  if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return env.SUPABASE_DB_URL;
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-public-qr-phase5-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

function normalizePath(value) {
  try {
    const parsed = new URL(value, "https://phase5.invalid");
    return {
      origin: parsed.origin,
      pathname: parsed.pathname,
      tableNumber: parsed.searchParams.get("t") || parsed.searchParams.get("table") || "",
      qrToken: parsed.searchParams.get("qr") || "",
      extraParams: [...parsed.searchParams.keys()].filter((key) => key !== "t" && key !== "qr"),
    };
  } catch {
    return { origin: "", pathname: "", tableNumber: "", qrToken: "", extraParams: ["parse-error"] };
  }
}

async function asRole(client, role, userId, sql, params = []) {
  await client.query("reset role");
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
  const queryResult = await client.query(sql, params);
  await client.query("reset role");
  return queryResult;
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

function auditSource(results) {
  const appUrl = fs.readFileSync(path.join(sourceRoot, "src", "core", "config", "appUrl.ts"), "utf8");
  const qrContext = fs.readFileSync(path.join(sourceRoot, "src", "modules", "public-qr-ordering", "services", "publicQrContext.ts"), "utf8");
  const publicOrderService = fs.readFileSync(path.join(sourceRoot, "src", "modules", "public-qr-ordering", "services", "publicQrOrderService.ts"), "utf8");
  const qrMenuService = fs.readFileSync(path.join(sourceRoot, "src", "modules", "qr-menu", "services", "qrMenuService.ts"), "utf8");
  const ownerPage = fs.readFileSync(path.join(sourceRoot, "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
  const setupWizard = fs.readFileSync(path.join(sourceRoot, "src", "modules", "setup-wizard", "pages", "RestaurantSetupWizardPage.tsx"), "utf8");
  const migration = fs.readFileSync(path.join(supabaseRoot, "migrations", "064_public_qr_reliability_phase5.sql"), "utf8");

  results.push(result(
    "Database has the only QR URL builder",
    migration.includes("create or replace function public.build_public_order_url")
      && migration.includes("public.get_app_url() || public.build_public_order_path")
      && migration.includes("public.rebuild_public_qr_urls()")
      && !ownerPage.includes("getQrAppUrl")
      && !setupWizard.includes("getQrAppUrl")
      && !appUrl.includes("getQrAppUrl"),
    "Frontend QR renderers consume restaurant_tables.qr_url and do not rebuild QR URLs."
  ));

  results.push(result(
    "No production QR path falls back to localhost or browser origin",
    !appUrl.includes("http://localhost:5173")
      && !migration.includes("http://localhost:5173")
      && !ownerPage.includes("window.location.origin")
      && !setupWizard.includes("window.location.origin")
      && !qrContext.includes("serveflow.debugQr"),
    "No localhost/browser-origin fallback remains in the production QR path."
  ));

  results.push(result(
    "Owner regeneration rotates QR tokens and set_app_url only rebuilds URLs",
    migration.includes("qr_token = regenerated.new_token")
      && migration.includes("new_token uuid := gen_random_uuid()")
      && migration.includes("perform public.rebuild_public_qr_urls();"),
    "Explicit QR regeneration invalidates old QR tokens; app URL changes repair stored URLs."
  ));

  results.push(result(
    "Development-only QR diagnostics cover scan, menu, session, submit, and generated QR URL",
    qrContext.includes("!viteEnv?.DEV")
      && publicOrderService.includes("publicQrOrderService:sessionLookup")
      && publicOrderService.includes("publicQrOrderService:submit")
      && qrMenuService.includes("qrMenuService:menuLookup")
      && qrMenuService.includes("qrMenuService:scanLog")
      && ownerPage.includes("ownerDashboard:generatedQrUrl")
      && setupWizard.includes("setupWizard:generatedQrUrl"),
    "Diagnostics are gated on import.meta.env.DEV."
  ));
}

async function auditLiveDatabase(client, results) {
  const appUrl = await client.query("select public.get_app_url() as app_url");
  const configuredUrl = appUrl.rows[0]?.app_url ?? "";
  results.push(result(
    "Configured APP URL is absolute and not localhost",
    /^https?:\/\//.test(configuredUrl) && !/localhost|127\.0\.0\.1/i.test(configuredUrl),
    configuredUrl
  ));

  const badRows = await client.query(`
    select r.slug, rt.table_number, rt.qr_url, rt.qr_path
    from public.restaurant_tables rt
    join public.restaurants r on r.id = rt.restaurant_id
    where rt.active = true
      and (
        rt.qr_url is null
        or rt.qr_url !~ '^https?://'
        or rt.qr_url ~* 'localhost|127\\.0\\.0\\.1'
        or rt.qr_url is distinct from public.build_public_order_url(r.slug, rt.table_number, rt.qr_token)
        or rt.qr_path is distinct from public.build_public_order_path(r.slug, rt.table_number, rt.qr_token)
      )
    order by r.slug, rt.table_number
  `);
  results.push(result(
    "Every active live table QR URL matches the canonical builder",
    badRows.rowCount === 0,
    JSON.stringify(badRows.rows)
  ));

  const duplicateRows = await client.query(`
    select 'table_number' as check_name, restaurant_id::text || ':' || table_number::text as value, count(*)::int as count
    from public.restaurant_tables
    where active = true
    group by restaurant_id, table_number
    having count(*) > 1
    union all
    select 'qr_token', qr_token::text, count(*)::int
    from public.restaurant_tables
    group by qr_token
    having count(*) > 1
  `);
  results.push(result(
    "Live table numbers and QR tokens have no duplicates",
    duplicateRows.rowCount === 0,
    JSON.stringify(duplicateRows.rows)
  ));

  const orphanRows = await client.query(`
    select rt.id
    from public.restaurant_tables rt
    left join public.restaurants r on r.id = rt.restaurant_id
    where r.id is null
  `);
  results.push(result(
    "No restaurant table orphan rows exist",
    orphanRows.rowCount === 0,
    JSON.stringify(orphanRows.rows)
  ));
}

async function auditSyntheticEndToEnd(client, results) {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    kitchenA: uuid("kitchen-a"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    staffKitchenA: uuid("staff-kitchen-a"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    stationA: uuid("station-a"),
    stationB: uuid("station-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    itemA: uuid("item-a"),
    itemA2: uuid("item-a2"),
    itemB: uuid("item-b"),
  };

  await client.query("begin");
  try {
    await client.query("insert into public.application_settings (key, value) values ('app_url', 'https://phase5.example.test') on conflict (key) do update set value = excluded.value");
    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase5-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase5-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase5-cashier-a@example.test', '', now(), now(), now()),
        ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'phase5-kitchen-a@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA, ids.kitchenA]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Phase 5 QR A', 'phase5-qr-a', 10, 10),
        ($2, 'Phase 5 QR B', 'phase5-qr-b', 8, 8)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active, assigned_kitchen_station_id)
      values
        ($1, $5, $7, 'owner', 'Owner A', 'phase5-owner-a@example.test', true, null),
        ($2, $6, $8, 'owner', 'Owner B', 'phase5-owner-b@example.test', true, null),
        ($3, $5, $9, 'cashier', 'Cashier A', 'phase5-cashier-a@example.test', true, null),
        ($4, $5, $10, 'kitchen', 'Kitchen A', 'phase5-kitchen-a@example.test', true, null)
    `, [ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.staffKitchenA, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA, ids.kitchenA]);

    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, priority, active)
      values ($1, $3, 'Phase 5 Kitchen A', 1, true), ($2, $4, 'Phase 5 Kitchen B', 1, true)
    `, [ids.stationA, ids.stationB, ids.restaurantA, ids.restaurantB]);
    await client.query("update public.restaurant_staff set assigned_kitchen_station_id = $1 where id = $2", [ids.stationA, ids.staffKitchenA]);
    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values ($1, $3, 'Food'), ($2, $4, 'Food')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values
        ($1, $4, $6, 'Burger', 100, true, $8),
        ($2, $4, $6, 'Fries', 50, true, $8),
        ($3, $5, $7, 'Tenant Burger', 80, true, $9)
    `, [ids.itemA, ids.itemA2, ids.itemB, ids.restaurantA, ids.restaurantB, ids.categoryA, ids.categoryB, ids.stationA, ids.stationB]);

    const tablesA = await asRole(client, "authenticated", ids.ownerA, "select id, table_number, qr_token, qr_url, qr_path from public.sync_restaurant_tables($1, 10) order by table_number", [ids.restaurantA]);
    const tablesB = await asRole(client, "authenticated", ids.ownerB, "select id, table_number, qr_token, qr_url, qr_path from public.sync_restaurant_tables($1, 8) order by table_number", [ids.restaurantB]);
    const generatedRows = [...tablesA.rows.map((row) => ({ ...row, slug: "phase5-qr-a" })), ...tablesB.rows.map((row) => ({ ...row, slug: "phase5-qr-b" }))];
    results.push(result(
      "Synthetic generated QR rows use canonical absolute URLs",
      generatedRows.every((row) => {
        const parsed = normalizePath(row.qr_url);
        return row.qr_url.startsWith("https://phase5.example.test/r/")
          && row.qr_path === `/r/${row.slug}?t=${row.table_number}&qr=${row.qr_token}`
          && parsed.pathname === `/r/${row.slug}`
          && parsed.tableNumber === String(row.table_number)
          && parsed.qrToken === String(row.qr_token)
          && parsed.extraParams.length === 0;
      }),
      JSON.stringify(generatedRows.slice(0, 4))
    ));

    const tableChecks = [];
    for (const tableNumber of [1, 2, 3, 5, 10]) {
      const table = tablesA.rows.find((row) => row.table_number === tableNumber);
      const first = await asRole(client, "anon", null, "select public.create_public_qr_order($1, $2, $3, 'Phase5 Guest', 'Cash', $4::jsonb) as payload", ["phase5-qr-a", String(tableNumber), String(table.qr_token), JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]);
      const second = await asRole(client, "anon", null, "select public.create_public_qr_order($1, $2, $3, 'Phase5 Guest', 'Cash', $4::jsonb) as payload", ["phase5-qr-a", String(tableNumber), String(table.qr_token), JSON.stringify([{ menu_item_id: ids.itemA2, quantity: 1 }])]);
      const session = await asRole(client, "anon", null, "select public.get_public_qr_order_session($1, $2, $3) as session", ["phase5-qr-a", String(tableNumber), String(table.qr_token)]);
      tableChecks.push(first.rows[0].payload.session_action === "created"
        && second.rows[0].payload.session_action === "appended"
        && first.rows[0].payload.order_id === second.rows[0].payload.order_id
        && session.rows[0].session?.order_id === first.rows[0].payload.order_id);
    }
    for (const tableNumber of [1, 2, 5, 8]) {
      const table = tablesB.rows.find((row) => row.table_number === tableNumber);
      const first = await asRole(client, "anon", null, "select public.create_public_qr_order($1, $2, $3, 'Phase5 Guest', 'Cash', $4::jsonb) as payload", ["phase5-qr-b", String(tableNumber), String(table.qr_token), JSON.stringify([{ menu_item_id: ids.itemB, quantity: 1 }])]);
      const session = await asRole(client, "anon", null, "select public.get_public_qr_order_session($1, $2, $3) as session", ["phase5-qr-b", String(tableNumber), String(table.qr_token)]);
      tableChecks.push(first.rows[0].payload.session_action === "created"
        && session.rows[0].session?.order_id === first.rows[0].payload.order_id);
    }
    results.push(result(
      "Synthetic Restaurant A and B target tables load, order, append, and isolate sessions",
      tableChecks.length === 9 && tableChecks.every(Boolean),
      JSON.stringify(tableChecks)
    ));

    const cashierRows = await asRole(client, "authenticated", ids.cashierA, "select id from public.orders where restaurant_id = $1 and status = 'pending_payment' order by table_number::int", [ids.restaurantA]);
    const ownerRows = await asRole(client, "authenticated", ids.ownerA, "select count(*)::int as count from public.orders where restaurant_id = $1", [ids.restaurantA]);
    for (const order of cashierRows.rows) {
      await asRole(client, "authenticated", ids.cashierA, "select public.approve_order_payment($1)", [order.id]);
    }
    const kitchenRows = await asRole(client, "authenticated", ids.kitchenA, "select count(*)::int as count from public.order_items where restaurant_id = $1 and kitchen_status <> 'held'", [ids.restaurantA]);
    results.push(result(
      "Cashier, kitchen, and owner visibility still receive public QR orders",
      cashierRows.rowCount === 5
        && Number(kitchenRows.rows[0].count) === 10
        && Number(ownerRows.rows[0].count) === 5,
      JSON.stringify({ cashierPendingBeforeApproval: cashierRows.rowCount, kitchen: kitchenRows.rows[0], owner: ownerRows.rows[0] })
    ));

    const originalTable = tablesA.rows.find((row) => row.table_number === 1);
    const regenerated = await asRole(client, "authenticated", ids.ownerA, "select id, table_number, qr_token, qr_url from public.regenerate_restaurant_table_qr($1, $2)", [ids.restaurantA, originalTable.id]);
    results.push(result(
      "Single-table QR regeneration invalidates the old token",
      regenerated.rows[0].qr_token !== originalTable.qr_token
        && regenerated.rows[0].qr_url.includes(`t=1&qr=${regenerated.rows[0].qr_token}`),
      JSON.stringify({ before: originalTable.qr_token, after: regenerated.rows[0].qr_token })
    ));
    results.push(await expectReject(
      "Old QR token is rejected after regeneration",
      () => asRole(client, "anon", null, "select public.create_public_qr_order($1, '1', $2, 'Old Token', 'Cash', $3::jsonb)", ["phase5-qr-a", originalTable.qr_token, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]),
      /Invalid or expired table QR code/i
    ));

    await client.query("rollback");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function main() {
  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  auditSource(results);

  await client.connect();
  try {
    await auditLiveDatabase(client, results);
    await auditSyntheticEndToEnd(client, results);
  } finally {
    await client.end();
  }

  try {
    execSync("npm run build", { cwd: sourceRoot, stdio: "pipe" });
    results.push(result("Build passes", true));
  } catch (error) {
    results.push(result("Build passes", false, error.stdout?.toString() || error.message));
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}: ${entry.detail}`);
  }
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
