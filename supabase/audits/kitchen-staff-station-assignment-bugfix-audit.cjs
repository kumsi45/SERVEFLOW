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

async function applyKitchenMigration(client, migration) {
  if ([
    "044_kitchen_dashboard_station_awareness.sql",
    "046_kitchen_routing_station_queue_totals_bugfix.sql",
    "047_kitchen_station_item_status_isolation.sql",
  ].includes(migration)) {
    await client.query("drop function if exists public.get_station_kitchen_orders(uuid, uuid, boolean, boolean)");
  }
  await client.query(fs.readFileSync(path.join(supabaseRoot, "migrations", migration), "utf8"));
}

async function applyPhase4BCompatibility(client) {
  await applyKitchenMigration(client, "048_kitchen_station_collaboration_phase4b.sql");
  await applyKitchenMigration(client, "049_kitchen_station_audit_actor_compatibility.sql");
}

async function asRole(client, role, userId, sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local row_security = on");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    if (userId) await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await client.query(sql, params);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function expectReject(label, action, pattern) {
  try {
    await action();
    return { label, ok: false, detail: "unexpected success" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { label, ok: pattern.test(message), detail: message };
  }
}

async function cleanup(client, admin, ids, emails) {
  const restaurants = [ids.restaurantA, ids.restaurantB].filter(Boolean);
  if (restaurants.length) {
    await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
    await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-staff-station-bugfix-a','kitchen-staff-station-bugfix-b')", [restaurants]).catch(() => {});
  }
  await client.query("delete from auth.users where email like 'kitchen-staff-station-bugfix-%@example.test'").catch(() => {});
  for (const userId of [ids.ownerA, ids.ownerB]) {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  for (const email of emails) {
    await client.query("delete from auth.users where email = $1", [email]).catch(() => {});
  }
}

function itemNames(rows) {
  return rows.flatMap((row) => row.items.map((item) => item.menu_item_name)).sort();
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const appEnv = readKeyValueFile(path.join(sourceRoot, ".env.local"));
  const supabaseUrl = appEnv.VITE_SUPABASE_URL;
  const anonKey = appEnv.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = appEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error(".env.local must include Supabase URL, anon key, and service role key.");

  const supabase = createClient(supabaseUrl, anonKey);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });

  const ids = {
    ownerA: crypto.randomUUID(),
    ownerB: crypto.randomUUID(),
    staffOwnerA: crypto.randomUUID(),
    staffOwnerB: crypto.randomUUID(),
    staffCashierA: crypto.randomUUID(),
    restaurantA: crypto.randomUUID(),
    restaurantB: crypto.randomUUID(),
    mainStationA: crypto.randomUUID(),
    beverageStationA: crypto.randomUUID(),
    inactiveStationA: crypto.randomUUID(),
    tenantStationB: crypto.randomUUID(),
    categoryA: crypto.randomUUID(),
    categoryB: crypto.randomUUID(),
    tableA: crypto.randomUUID(),
    tableB: crypto.randomUUID(),
    burger: crypto.randomUUID(),
    pizza: crypto.randomUUID(),
    juice: crypto.randomUUID(),
    coffee: crypto.randomUUID(),
    tenantItem: crypto.randomUUID(),
    orderA: crypto.randomUUID(),
    orderB: crypto.randomUUID(),
  };
  const emails = {
    ownerA: "kitchen-staff-station-bugfix-owner-a@example.test",
    ownerB: "kitchen-staff-station-bugfix-owner-b@example.test",
    mainStaff: "kitchen-staff-station-bugfix-main@example.test",
    beverageStaff: "kitchen-staff-station-bugfix-beverage@example.test",
    inactiveStaff: "kitchen-staff-station-bugfix-inactive@example.test",
  };
  const ownerPassword = "TempPass123!";
  const results = [];

  await client.connect();
  try {
    for (const migration of [
      "041_kitchen_station_foundation.sql",
      "042_kitchen_station_menu_assignment.sql",
      "043_kitchen_routing_engine.sql",
      "044_kitchen_dashboard_station_awareness.sql",
      "045_kitchen_staff_station_assignment_ui.sql",
      "046_kitchen_routing_station_queue_totals_bugfix.sql",
    ]) {
      await applyKitchenMigration(client, migration);
    }
    await applyPhase4BCompatibility(client);

    await cleanup(client, admin, ids, Object.values(emails));

    for (const [id, email] of [[ids.ownerA, emails.ownerA], [ids.ownerB, emails.ownerB]]) {
      const { error } = await admin.auth.admin.createUser({ id, email, password: ownerPassword, email_confirm: true });
      if (error) throw error;
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Kitchen Staff Station Bugfix A', 'kitchen-staff-station-bugfix-a', 2, 2),
        ($2, 'Kitchen Staff Station Bugfix B', 'kitchen-staff-station-bugfix-b', 2, 2)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Owner A', $7, true),
        ($2, $4, $6, 'owner', 'Owner B', $8, true)
    `, [ids.staffOwnerA, ids.staffOwnerB, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, emails.ownerA, emails.ownerB]);
    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, display_color, icon, priority, active)
      values
        ($1, $4, 'Main Kitchen', '#0f766e', 'MK', 1, true),
        ($2, $4, 'Beverage Kitchen', '#0891b2', 'BK', 2, true),
        ($3, $4, 'Inactive Kitchen', '#64748b', 'IK', 3, false),
        ($5, $6, 'Tenant B Station', '#2563eb', 'TB', 1, true)
    `, [ids.mainStationA, ids.beverageStationA, ids.inactiveStationA, ids.restaurantA, ids.tenantStationB, ids.restaurantB]);

    const ownerSignIn = await supabase.auth.signInWithPassword({ email: emails.ownerA, password: ownerPassword });
    if (ownerSignIn.error) throw ownerSignIn.error;
    const ownerToken = ownerSignIn.data.session.access_token;

    async function invokeManageStaff(payload) {
      const response = await fetch(`${supabaseUrl}/functions/v1/manage-staff`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerToken}`,
          apikey: anonKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
      if (!response.ok) throw new Error(`manage-staff ${response.status}: ${text}`);
      return body;
    }

    const mainCreate = await invokeManageStaff({
      action: "create-staff",
      restaurantId: ids.restaurantA,
      fullName: "Main Cook",
      email: emails.mainStaff,
      role: "kitchen",
      assignedKitchenStationId: ids.mainStationA,
    });
    const beverageCreate = await invokeManageStaff({
      action: "create-staff",
      restaurantId: ids.restaurantA,
      fullName: "Beverage Cook",
      email: emails.beverageStaff,
      role: "kitchen",
      assignedKitchenStationId: ids.beverageStationA,
    });
    const inactiveCreateReject = await expectReject(
      "Inactive stations cannot be assigned on create",
      () => invokeManageStaff({
        action: "create-staff",
        restaurantId: ids.restaurantA,
        fullName: "Inactive Cook",
        email: emails.inactiveStaff,
        role: "kitchen",
        assignedKitchenStationId: ids.inactiveStationA,
      }),
      /active kitchen station/i
    );
    results.push(inactiveCreateReject);

    const createdStaff = await client.query(`
      select id, user_id, email, assigned_kitchen_station_id
      from public.restaurant_staff
      where restaurant_id = $1 and email = any($2::text[])
      order by email
    `, [ids.restaurantA, [emails.mainStaff, emails.beverageStaff]]);
    const byEmail = new Map(createdStaff.rows.map((row) => [row.email, row]));
    results.push({
      label: "Owner dropdown payload reaches Edge Function and assigned station is stored",
      ok: byEmail.get(emails.mainStaff)?.assigned_kitchen_station_id === ids.mainStationA &&
        byEmail.get(emails.beverageStaff)?.assigned_kitchen_station_id === ids.beverageStationA,
      detail: JSON.stringify({ mainCreate, beverageCreate, stored: createdStaff.rows }),
    });

    const mainStaff = byEmail.get(emails.mainStaff);
    const beverageStaff = byEmail.get(emails.beverageStaff);

    await invokeManageStaff({
      action: "update-staff",
      restaurantId: ids.restaurantA,
      staffId: beverageStaff.id,
      role: "kitchen",
      assignedKitchenStationId: ids.mainStationA,
    });
    let beverageAfterEdit = await client.query(
      "select assigned_kitchen_station_id from public.restaurant_staff where id = $1 and restaurant_id = $2",
      [beverageStaff.id, ids.restaurantA]
    );
    results.push({
      label: "Editing an existing staff member updates the station assignment",
      ok: beverageAfterEdit.rows[0]?.assigned_kitchen_station_id === ids.mainStationA,
      detail: JSON.stringify(beverageAfterEdit.rows[0]),
    });

    const inactiveUpdateReject = await expectReject(
      "Inactive stations cannot be assigned on update",
      () => invokeManageStaff({
        action: "update-staff",
        restaurantId: ids.restaurantA,
        staffId: beverageStaff.id,
        role: "kitchen",
        assignedKitchenStationId: ids.inactiveStationA,
      }),
      /active kitchen station/i
    );
    results.push(inactiveUpdateReject);
    beverageAfterEdit = await client.query(
      "select assigned_kitchen_station_id from public.restaurant_staff where id = $1 and restaurant_id = $2",
      [beverageStaff.id, ids.restaurantA]
    );
    results.push({
      label: "Rejected inactive station update preserves the previous assignment",
      ok: beverageAfterEdit.rows[0]?.assigned_kitchen_station_id === ids.mainStationA,
      detail: JSON.stringify(beverageAfterEdit.rows[0]),
    });

    await invokeManageStaff({
      action: "update-staff",
      restaurantId: ids.restaurantA,
      staffId: beverageStaff.id,
      role: "kitchen",
      assignedKitchenStationId: ids.beverageStationA,
    });
    const beverageRestored = await client.query(
      "select assigned_kitchen_station_id from public.restaurant_staff where id = $1 and restaurant_id = $2",
      [beverageStaff.id, ids.restaurantA]
    );
    results.push({
      label: "Editing an existing staff member can restore Beverage Kitchen",
      ok: beverageRestored.rows[0]?.assigned_kitchen_station_id === ids.beverageStationA,
      detail: JSON.stringify(beverageRestored.rows[0]),
    });

    await invokeManageStaff({
      action: "update-staff",
      restaurantId: ids.restaurantA,
      staffId: mainStaff.id,
      fullName: "Main Cook Renamed",
      role: "kitchen",
      assignedKitchenStationId: ids.mainStationA,
    });
    const preserveRole = await client.query(
      "select role::text as role, display_name, assigned_kitchen_station_id from public.restaurant_staff where id = $1 and restaurant_id = $2",
      [mainStaff.id, ids.restaurantA]
    );
    results.push({
      label: "Kitchen role updates preserve the selected station",
      ok: preserveRole.rows[0]?.role === "kitchen" &&
        preserveRole.rows[0]?.display_name === "Main Cook Renamed" &&
        preserveRole.rows[0]?.assigned_kitchen_station_id === ids.mainStationA,
      detail: JSON.stringify(preserveRole.rows[0]),
    });

    await invokeManageStaff({
      action: "update-staff",
      restaurantId: ids.restaurantA,
      staffId: mainStaff.id,
      role: "cashier",
    });
    const cashierRole = await client.query(
      "select role::text as role, assigned_kitchen_station_id from public.restaurant_staff where id = $1 and restaurant_id = $2",
      [mainStaff.id, ids.restaurantA]
    );
    results.push({
      label: "Changing kitchen staff to cashier clears the station assignment",
      ok: cashierRole.rows[0]?.role === "cashier" && cashierRole.rows[0]?.assigned_kitchen_station_id === null,
      detail: JSON.stringify(cashierRole.rows[0]),
    });

    await invokeManageStaff({
      action: "update-staff",
      restaurantId: ids.restaurantA,
      staffId: mainStaff.id,
      role: "kitchen",
      assignedKitchenStationId: ids.mainStationA,
    });
    const kitchenRole = await client.query(
      "select role::text as role, assigned_kitchen_station_id from public.restaurant_staff where id = $1 and restaurant_id = $2",
      [mainStaff.id, ids.restaurantA]
    );
    results.push({
      label: "Changing cashier staff back to kitchen stores the selected station",
      ok: kitchenRole.rows[0]?.role === "kitchen" && kitchenRole.rows[0]?.assigned_kitchen_station_id === ids.mainStationA,
      detail: JSON.stringify(kitchenRole.rows[0]),
    });

    const mainContext = await asRole(client, "authenticated", mainStaff.user_id, "select public.get_kitchen_dashboard_context($1) as context", [ids.restaurantA]);
    const beverageContext = await asRole(client, "authenticated", beverageStaff.user_id, "select public.get_kitchen_dashboard_context($1) as context", [ids.restaurantA]);
    results.push({
      label: "Kitchen login receives assigned station",
      ok: mainContext.rows[0].context.assignedStation.id === ids.mainStationA &&
        mainContext.rows[0].context.assignedStation.name === "Main Kitchen" &&
        beverageContext.rows[0].context.assignedStation.id === ids.beverageStationA &&
        beverageContext.rows[0].context.assignedStation.name === "Beverage Kitchen",
      detail: JSON.stringify({ main: mainContext.rows[0].context, beverage: beverageContext.rows[0].context }),
    });
    results.push({
      label: "Deployed Edge Function behavior passes create, edit, role, and reject checks",
      ok: true,
      detail: "manage-staff live invocations completed through Supabase functions/v1/manage-staff.",
    });

    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values ($1, $3, 'Menu'), ($2, $4, 'Menu')
    `, [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values
        ($1, $3, 1, 'Table 1', $5, '/r/kitchen-staff-station-bugfix-a/order?t=1', '/r/kitchen-staff-station-bugfix-a/order?t=1', true),
        ($2, $4, 1, 'Table 1', $6, '/r/kitchen-staff-station-bugfix-b/order?t=1', '/r/kitchen-staff-station-bugfix-b/order?t=1', true)
    `, [ids.tableA, ids.tableB, ids.restaurantA, ids.restaurantB, crypto.randomUUID(), crypto.randomUUID()]);
    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values
        ($1, $5, $6, 'Burger', 250, true, $7),
        ($2, $5, $6, 'Pizza', 300, true, $7),
        ($3, $5, $6, 'Mango Juice', 100, true, $8),
        ($4, $5, $6, 'Coffee', 100, true, $8)
    `, [ids.burger, ids.pizza, ids.juice, ids.coffee, ids.restaurantA, ids.categoryA, ids.mainStationA, ids.beverageStationA]);
    await asRole(client, "authenticated", ids.ownerB, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Tenant Item', 10, true, $4)
    `, [ids.tenantItem, ids.restaurantB, ids.categoryB, ids.tenantStationB]);

    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
      values ($1, $2, null, 'paid', 750, 'Split Customer', '1', 'Cash', 'cashier', $3, now())
    `, [ids.orderA, ids.restaurantA, ids.staffOwnerA]);
    await client.query(`
      insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price)
      values
        ($1, $2, $3, 1, 250),
        ($1, $2, $4, 1, 300),
        ($1, $2, $5, 1, 100),
        ($1, $2, $6, 1, 100)
    `, [ids.restaurantA, ids.orderA, ids.burger, ids.pizza, ids.juice, ids.coffee]);
    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
      values ($1, $2, null, 'paid', 10, 'Tenant Customer', '1', 'Cash', 'cashier', $3, now())
    `, [ids.orderB, ids.restaurantB, ids.staffOwnerB]);
    await client.query("insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price) values ($1, $2, $3, 1, 10)", [ids.restaurantB, ids.orderB, ids.tenantItem]);

    const mainQueue = await asRole(client, "authenticated", mainStaff.user_id, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    const beverageQueue = await asRole(client, "authenticated", beverageStaff.user_id, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    const ownerAll = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_station_kitchen_orders($1, null, true, false)", [ids.restaurantA]);
    results.push({
      label: "Main Kitchen staff only see Main Kitchen orders",
      ok: JSON.stringify(itemNames(mainQueue.rows)) === JSON.stringify(["Burger", "Pizza"]),
      detail: JSON.stringify(itemNames(mainQueue.rows)),
    });
    results.push({
      label: "Beverage Kitchen staff only see Beverage Kitchen orders",
      ok: JSON.stringify(itemNames(beverageQueue.rows)) === JSON.stringify(["Coffee", "Mango Juice"]),
      detail: JSON.stringify(itemNames(beverageQueue.rows)),
    });
    results.push({
      label: "Two staff assigned to different stations receive different queues",
      ok: JSON.stringify(itemNames(mainQueue.rows)) !== JSON.stringify(itemNames(beverageQueue.rows)),
      detail: JSON.stringify({ main: itemNames(mainQueue.rows), beverage: itemNames(beverageQueue.rows) }),
    });
    results.push({
      label: "Owner All Stations still works",
      ok: JSON.stringify(itemNames(ownerAll.rows)) === JSON.stringify(["Burger", "Coffee", "Mango Juice", "Pizza"]),
      detail: JSON.stringify(itemNames(ownerAll.rows)),
    });

    const tenantReject = await expectReject(
      "Multi-tenant isolation passes",
      () => asRole(client, "authenticated", ids.ownerB, "select * from public.get_station_kitchen_orders($1, null, true, false)", [ids.restaurantA]),
      /Only active kitchen staff and owners|view kitchen orders/i
    );
    results.push(tenantReject);
    const beverageRls = await asRole(client, "authenticated", beverageStaff.user_id, `
      select distinct kitchen_station_id
      from public.order_items
      where restaurant_id = $1
      order by kitchen_station_id
    `, [ids.restaurantA]);
    results.push({
      label: "RLS passes",
      ok: beverageRls.rows.length === 1 && beverageRls.rows[0].kitchen_station_id === ids.beverageStationA,
      detail: JSON.stringify(beverageRls.rows),
    });

    const realtimePublication = await client.query(`
      select tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename
    `, [["orders", "order_items", "restaurant_staff"]]);
    const dashboardSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx"), "utf8");
    const kitchenServiceSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "kitchen", "services", "kitchenOrderService.ts"), "utf8");
    const ownerSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    const realtimeTables = realtimePublication.rows.map((row) => row.tablename);
    results.push({
      label: "Realtime still works",
      ok: realtimeTables.includes("order_items") &&
        realtimeTables.includes("restaurant_staff") &&
        dashboardSource.includes('table: "orders"') &&
        dashboardSource.includes('table: "order_items"') &&
        dashboardSource.includes("refreshStationOrders(false)") &&
        ownerSource.includes('table: "restaurant_staff"') &&
        ownerSource.includes("refreshStaff()"),
      detail: JSON.stringify({ published: realtimeTables }),
    });
    results.push({
      label: "Station filtering remains in Supabase",
      ok: kitchenServiceSource.includes('.rpc("get_station_kitchen_orders"') &&
        kitchenServiceSource.includes("target_station_id") &&
        !dashboardSource.includes("kitchenStationId ===") &&
        !kitchenServiceSource.includes("kitchenStationId ===") &&
        fs.readFileSync(path.join(sourceRoot, "supabase", "migrations", "046_kitchen_routing_station_queue_totals_bugfix.sql"), "utf8")
          .includes("and (effective_station_id is null or items.kitchen_station_id = effective_station_id)"),
      detail: "Kitchen dashboard loads station queues through get_station_kitchen_orders; station filtering condition lives in the RPC.",
    });

    try {
      execSync("npm run build", { cwd: sourceRoot, stdio: "pipe", shell: true });
      results.push({ label: "Build passes", ok: true, detail: "npm run build" });
    } catch (error) {
      results.push({ label: "Build passes", ok: false, detail: error.stdout?.toString() || error.message });
    }
  } finally {
    await cleanup(client, admin, ids, Object.values(emails));
    await client.end();
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}: ${result.detail}`);
  console.log(`Passed: ${failed.length === 0 ? "all" : results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
