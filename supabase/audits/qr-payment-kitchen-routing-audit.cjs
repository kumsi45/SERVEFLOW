const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

const supabaseRoot = __dirname;
const sourceRoot = path.join(__dirname, "..");

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
  const hex = crypto.createHash("sha256").update(`serveflow-qr-payment-kitchen-routing-audit-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function itemNames(rows) {
  return rows.flatMap((row) => row.items ?? []).map((item) => item.menu_item_name).sort();
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
  await client.query("delete from public.kitchen_order_station_progress where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cash_reconciliations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cashier_shifts where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('qr-payment-kitchen-routing-a','qr-payment-kitchen-routing-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'qr-payment-kitchen-routing-%@example.test'").catch(() => {});
}

async function startRealtimeProbe(ids) {
  const appEnv = readKeyValueFile(path.join(sourceRoot, ".env.local"));
  const supabaseUrl = appEnv.VITE_SUPABASE_URL;
  const serviceRoleKey = appEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { events: [], stop: async () => {}, ready: false, detail: ".env.local missing Supabase URL or service role key" };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const events = [];
  const channel = supabase.channel(`qr-payment-kitchen-routing-audit-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${ids.restaurantA}` }, (payload) => events.push({ table: "orders", event: payload.eventType }))
    .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${ids.restaurantA}` }, (payload) => events.push({ table: "order_items", event: payload.eventType }))
    .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_order_station_progress", filter: `restaurant_id=eq.${ids.restaurantA}` }, (payload) => events.push({ table: "kitchen_order_station_progress", event: payload.eventType }));

  const ready = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve(true);
      }
    });
  });

  return {
    events,
    ready,
    detail: ready ? "subscribed" : "subscription timeout",
    stop: async () => {
      await supabase.removeChannel(channel);
    },
  };
}

async function waitForRealtime(events) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    const tables = new Set(events.map((event) => event.table));
    if (tables.has("orders") && tables.has("kitchen_order_station_progress")) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    cashierA: uuid("cashier-a"),
    mainKitchenUser: uuid("main-kitchen-user"),
    beverageKitchenUser: uuid("beverage-kitchen-user"),
    tenantKitchenUser: uuid("tenant-kitchen-user"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffCashierA: uuid("staff-cashier-a"),
    staffMainKitchen: uuid("staff-main-kitchen"),
    staffBeverageKitchen: uuid("staff-beverage-kitchen"),
    staffTenantKitchen: uuid("staff-tenant-kitchen"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    mainStationA: uuid("main-station-a"),
    beverageStationA: uuid("beverage-station-a"),
    tenantStationB: uuid("tenant-station-b"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    tableA: uuid("table-a"),
    tableB: uuid("table-b"),
    qrTokenA: uuid("qr-token-a"),
    qrTokenB: uuid("qr-token-b"),
    burger: uuid("burger"),
    pizza: uuid("pizza"),
    coffee: uuid("coffee"),
    juice: uuid("juice"),
    tenantItem: uuid("tenant-item"),
  };
  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  let realtimeProbe = null;

  await client.connect();
  try {
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-payment-kitchen-routing-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-payment-kitchen-routing-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-payment-kitchen-routing-cashier-a@example.test', '', now(), now(), now()),
        ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-payment-kitchen-routing-main@example.test', '', now(), now(), now()),
        ($5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-payment-kitchen-routing-beverage@example.test', '', now(), now(), now()),
        ($6, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qr-payment-kitchen-routing-tenant@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA, ids.mainKitchenUser, ids.beverageKitchenUser, ids.tenantKitchenUser]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'QR Payment Kitchen Routing A', 'qr-payment-kitchen-routing-a', 2, 2),
        ($2, 'QR Payment Kitchen Routing B', 'qr-payment-kitchen-routing-b', 2, 2)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values
        ($1, $4, 'Main Kitchen', null, '#0f766e', 'MK', 1, true),
        ($2, $4, 'Beverage Kitchen', null, '#0891b2', 'BK', 2, true),
        ($3, $5, 'Tenant B Station', null, '#2563eb', 'TB', 1, true)
    `, [ids.mainStationA, ids.beverageStationA, ids.tenantStationB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active, assigned_kitchen_station_id)
      values
        ($1, $7, $9, 'owner', 'Owner A', 'qr-payment-kitchen-routing-owner-a@example.test', true, null),
        ($2, $8, $10, 'owner', 'Owner B', 'qr-payment-kitchen-routing-owner-b@example.test', true, null),
        ($3, $7, $11, 'cashier', 'Cashier A', 'qr-payment-kitchen-routing-cashier-a@example.test', true, null),
        ($4, $7, $12, 'kitchen', 'Main Cook', 'qr-payment-kitchen-routing-main@example.test', true, $15),
        ($5, $7, $13, 'kitchen', 'Beverage Cook', 'qr-payment-kitchen-routing-beverage@example.test', true, $16),
        ($6, $8, $14, 'kitchen', 'Tenant Cook', 'qr-payment-kitchen-routing-tenant@example.test', true, $17)
    `, [
      ids.staffOwnerA, ids.staffOwnerB, ids.staffCashierA, ids.staffMainKitchen, ids.staffBeverageKitchen, ids.staffTenantKitchen,
      ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA, ids.mainKitchenUser, ids.beverageKitchenUser, ids.tenantKitchenUser,
      ids.mainStationA, ids.beverageStationA, ids.tenantStationB,
    ]);
    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $3, 'Menu'), ($2, $4, 'Menu')", [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values
        ($1, $3, 1, 'Table 1', $5, '/r/qr-payment-kitchen-routing-a/order?t=1', '/r/qr-payment-kitchen-routing-a/order?t=1', true),
        ($2, $4, 1, 'Table 1', $6, '/r/qr-payment-kitchen-routing-b/order?t=1', '/r/qr-payment-kitchen-routing-b/order?t=1', true)
      on conflict (restaurant_id, table_number)
      do update set
        label = excluded.label,
        qr_token = excluded.qr_token,
        qr_url = excluded.qr_url,
        qr_path = excluded.qr_path,
        active = excluded.active,
        updated_at = now()
    `, [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, ids.qrTokenA, ids.qrTokenB]);
    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values
        ($1, $5, $6, 'Burger', 250, true, $7),
        ($2, $5, $6, 'Pizza', 300, true, $7),
        ($3, $5, $6, 'Coffee', 100, true, $8),
        ($4, $5, $6, 'Juice', 100, true, $8)
    `, [
      ids.burger, ids.pizza, ids.coffee, ids.juice, ids.restaurantA, ids.categoryA,
      ids.mainStationA, ids.beverageStationA,
    ]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Tenant Item', 10, true, $4)
    `, [
      ids.tenantItem, ids.restaurantB, ids.categoryB, ids.tenantStationB,
    ]);

    await asRole(client, "authenticated", ids.cashierA, "select id from public.open_cashier_shift($1, 100, 'qr payment routing audit')", [ids.restaurantA]);

    const posCreated = await asRole(client, "authenticated", ids.cashierA, "select public.create_cashier_order($1, '1', 'Cash', $2::jsonb) as created", [
      ids.restaurantA,
      JSON.stringify([{ menu_item_id: ids.burger, quantity: 1 }, { menu_item_id: ids.coffee, quantity: 1 }]),
    ]);
    const posOrder = posCreated.rows[0].created;
    const posProgress = await client.query("select kitchen_station_id, station_status from public.kitchen_order_station_progress where order_id = $1 order by kitchen_station_id", [posOrder.order_id]);
    const posMainQueue = await asRole(client, "authenticated", ids.mainKitchenUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    const posBeverageQueue = await asRole(client, "authenticated", ids.beverageKitchenUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result(
      "POS Cashier Order -> Kitchen",
      posOrder.status === "paid" &&
        posProgress.rows.length === 2 &&
        posMainQueue.rows.some((row) => row.id === posOrder.order_id && itemNames([row]).includes("Burger")) &&
        posBeverageQueue.rows.some((row) => row.id === posOrder.order_id && itemNames([row]).includes("Coffee")),
      JSON.stringify({ order: posOrder, progress: posProgress.rows })
    ));

    const qrCreated = await asRole(client, "anon", null, "select public.create_public_qr_order($1, '1', $2, 'QR Guest', 'Cash', $3::jsonb) as created", [
      "qr-payment-kitchen-routing-a",
      ids.qrTokenA,
      JSON.stringify([{ menu_item_id: ids.burger, quantity: 1 }, { menu_item_id: ids.coffee, quantity: 1 }, { menu_item_id: ids.juice, quantity: 1 }]),
    ]);
    const qrOrder = qrCreated.rows[0].created;
    results.push(result("QR order created", qrOrder.status === "pending_payment" && Number(qrOrder.total_price) === 450, JSON.stringify(qrOrder)));

    const qrItemsBeforePayment = await client.query(`
      select menu_items.name, order_items.kitchen_station_id
      from public.order_items
      join public.menu_items on menu_items.restaurant_id = order_items.restaurant_id and menu_items.id = order_items.menu_item_id
      where order_items.order_id = $1
      order by menu_items.name
    `, [qrOrder.order_id]);
    results.push(result(
      "Kitchen routing executed",
      qrItemsBeforePayment.rows.length === 3 &&
        qrItemsBeforePayment.rows.some((row) => row.name === "Burger" && row.kitchen_station_id === ids.mainStationA) &&
        qrItemsBeforePayment.rows.some((row) => row.name === "Coffee" && row.kitchen_station_id === ids.beverageStationA) &&
        qrItemsBeforePayment.rows.some((row) => row.name === "Juice" && row.kitchen_station_id === ids.beverageStationA),
      JSON.stringify(qrItemsBeforePayment.rows)
    ));

    realtimeProbe = await startRealtimeProbe(ids);
    const approved = await asRole(client, "authenticated", ids.cashierA, "select row_to_json(approved_order) as approved from public.approve_order_payment($1) approved_order", [qrOrder.order_id]);
    const approvedOrder = approved.rows[0].approved;
    const realtimeReceived = realtimeProbe.ready ? await waitForRealtime(realtimeProbe.events) : false;

    results.push(result(
      "Cashier verifies payment",
      approvedOrder.id === qrOrder.order_id && approvedOrder.status === "paid",
      JSON.stringify({ approved: approvedOrder })
    ));

    const storedPayment = await client.query("select status::text, payment_verified_at is not null as payment_saved, payment_verified_by from public.orders where id = $1", [qrOrder.order_id]);
    results.push(result(
      "Payment stored",
      storedPayment.rows[0]?.payment_saved === true && storedPayment.rows[0]?.payment_verified_by === ids.staffCashierA,
      JSON.stringify(storedPayment.rows[0])
    ));
    results.push(result("Order status updated", storedPayment.rows[0]?.status === "paid", JSON.stringify(storedPayment.rows[0])));

    const qrProgress = await client.query("select kitchen_station_id, station_status, item_count, ready_count, completed_count from public.kitchen_order_station_progress where order_id = $1 order by kitchen_station_id", [qrOrder.order_id]);
    results.push(result(
      "Station progress created",
      qrProgress.rows.length === 2 &&
        qrProgress.rows.some((row) => row.kitchen_station_id === ids.mainStationA && row.station_status === "waiting" && row.item_count === 1) &&
        qrProgress.rows.some((row) => row.kitchen_station_id === ids.beverageStationA && row.station_status === "waiting" && row.item_count === 2),
      JSON.stringify(qrProgress.rows)
    ));

    const mainQueue = await asRole(client, "authenticated", ids.mainKitchenUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    const beverageQueue = await asRole(client, "authenticated", ids.beverageKitchenUser, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push(result(
      "Main Kitchen receives burger",
      mainQueue.rows.some((row) => row.id === qrOrder.order_id && JSON.stringify(itemNames([row])) === JSON.stringify(["Burger"])),
      JSON.stringify(mainQueue.rows.filter((row) => row.id === qrOrder.order_id).map((row) => ({ id: row.id, status: row.status, items: itemNames([row]) })))
    ));
    results.push(result(
      "Beverage Kitchen receives drinks",
      beverageQueue.rows.some((row) => row.id === qrOrder.order_id && JSON.stringify(itemNames([row])) === JSON.stringify(["Coffee", "Juice"])),
      JSON.stringify(beverageQueue.rows.filter((row) => row.id === qrOrder.order_id).map((row) => ({ id: row.id, status: row.status, items: itemNames([row]) })))
    ));
    results.push(result(
      "Mixed orders split correctly",
      mainQueue.rows.some((row) => row.id === qrOrder.order_id && itemNames([row]).length === 1) &&
        beverageQueue.rows.some((row) => row.id === qrOrder.order_id && itemNames([row]).length === 2),
      JSON.stringify({ main: itemNames(mainQueue.rows.filter((row) => row.id === qrOrder.order_id)), beverage: itemNames(beverageQueue.rows.filter((row) => row.id === qrOrder.order_id)) })
    ));

    const parentAfterPayment = await client.query("select status::text, ready_marked_at, completed_at from public.orders where id = $1", [qrOrder.order_id]);
    results.push(result(
      "Parent order untouched until station completion",
      parentAfterPayment.rows[0]?.status === "paid" && parentAfterPayment.rows[0]?.ready_marked_at === null && parentAfterPayment.rows[0]?.completed_at === null,
      JSON.stringify(parentAfterPayment.rows[0])
    ));

    const duplicateRouting = await client.query(`
      select
        count(*)::int as row_count,
        count(distinct menu_item_id)::int as distinct_item_count,
        count(*) filter (where kitchen_station_id is null)::int as unrouted_count
      from public.order_items
      where order_id = $1
    `, [qrOrder.order_id]);
    results.push(result(
      "No duplicate routing",
      duplicateRouting.rows[0]?.row_count === 3 && duplicateRouting.rows[0]?.distinct_item_count === 3 && duplicateRouting.rows[0]?.unrouted_count === 0,
      JSON.stringify(duplicateRouting.rows[0])
    ));

    const realtimePublication = await client.query(`
      select tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename
    `, [["orders", "order_items", "kitchen_order_station_progress", "restaurant_staff", "kitchen_stations"]]);
    const realtimeTables = realtimePublication.rows.map((row) => row.tablename);
    results.push(result(
      "Realtime publication configured",
      ["orders", "order_items", "kitchen_order_station_progress", "restaurant_staff", "kitchen_stations"].every((table) => realtimeTables.includes(table)),
      JSON.stringify(realtimeTables)
    ));
    results.push(result(
      "Realtime received",
      realtimeReceived,
      JSON.stringify({ subscribed: realtimeProbe.ready, detail: realtimeProbe.detail, events: realtimeProbe.events })
    ));

    results.push(await expectReject(
      "Tenant isolation",
      () => asRole(client, "authenticated", ids.ownerB, "select * from public.get_station_kitchen_orders($1, null, true, false)", [ids.restaurantA]),
      /Only active kitchen staff and owners|view kitchen orders/i
    ));

    const beverageRls = await asRole(client, "authenticated", ids.beverageKitchenUser, `
      select distinct kitchen_station_id
      from public.order_items
      where restaurant_id = $1 and order_id = $2
      order by kitchen_station_id
    `, [ids.restaurantA, qrOrder.order_id]);
    results.push(result(
      "RLS",
      beverageRls.rows.length === 1 && beverageRls.rows[0].kitchen_station_id === ids.beverageStationA,
      JSON.stringify(beverageRls.rows)
    ));

    const approveSource = await client.query("select pg_get_functiondef('public.approve_order_payment(uuid)'::regprocedure) as source");
    results.push(result(
      "Payment verification uses kitchen derivation pipeline",
      approveSource.rows[0].source.includes("derive_order_status_from_items"),
      "approve_order_payment must call derive_order_status_from_items after pending_payment -> paid"
    ));

    try {
      execSync("npm run build", { cwd: sourceRoot, stdio: "pipe", shell: true });
      results.push(result("Build passes", true, "npm run build"));
    } catch (error) {
      results.push(result("Build passes", false, error.stdout?.toString() || error.message));
    }
  } finally {
    if (realtimeProbe) await realtimeProbe.stop();
    await cleanup(client, ids);
    await client.end();
  }

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}${entry.detail ? `: ${entry.detail}` : ""}`);
  }
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
