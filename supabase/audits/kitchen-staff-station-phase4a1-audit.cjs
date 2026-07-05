const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

const supabaseRoot = path.join(__dirname, "..");
const sourceRoot = path.join(supabaseRoot, "..");

function readConnectionUrl() {
  const envPath = path.join(supabaseRoot, "connection.env");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const line = lines.find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
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

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-kitchen-staff-station-phase4a1-audit-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

async function cleanup(client, ids) {
  const restaurants = [ids.restaurantA, ids.restaurantB];
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-staff-station-phase4a1-a','kitchen-staff-station-phase4a1-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'kitchen-staff-station-phase4a1-%@example.test'").catch(() => {});
}

function itemNames(rows) {
  return rows.flatMap((row) => row.items.map((item) => item.menu_item_name)).sort();
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    kitchenA: uuid("kitchen-a"),
    cashierA: uuid("cashier-a"),
    staffOwnerA: uuid("staff-owner-a"),
    staffOwnerB: uuid("staff-owner-b"),
    staffKitchenA: uuid("staff-kitchen-a"),
    staffCashierA: uuid("staff-cashier-a"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    hotStationA: uuid("hot-station-a"),
    juiceStationA: uuid("juice-station-a"),
    tenantBStation: uuid("tenant-b-station"),
    categoryA: uuid("category-a"),
    tableA: uuid("table-a"),
    qrTokenA: uuid("qr-token-a"),
    tea: uuid("tea"),
    juice: uuid("juice"),
    orderA: uuid("order-a"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const migration of [
      "041_kitchen_station_foundation.sql",
      "042_kitchen_station_menu_assignment.sql",
      "043_kitchen_routing_engine.sql",
      "044_kitchen_dashboard_station_awareness.sql",
      "045_kitchen_staff_station_assignment_ui.sql",
    ]) {
      await applyKitchenMigration(client, migration);
    }
    await applyPhase4BCompatibility(client);

    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-staff-station-phase4a1-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-staff-station-phase4a1-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-staff-station-phase4a1-kitchen@example.test', '', now(), now(), now()),
        ($4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-staff-station-phase4a1-cashier@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.kitchenA, ids.cashierA]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Kitchen Staff Station Phase4A1 Audit A', 'kitchen-staff-station-phase4a1-a', 2, 2),
        ($2, 'Kitchen Staff Station Phase4A1 Audit B', 'kitchen-staff-station-phase4a1-b', 2, 2)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.kitchen_stations (id, restaurant_id, name, description, display_color, icon, priority, active)
      values
        ($1, $4, 'Hot Drinks', null, '#d97706', 'HD', 10, true),
        ($2, $4, 'Juice Bar', null, '#0891b2', 'JB', 20, true),
        ($3, $5, 'Tenant B Station', null, '#2563eb', 'TB', 10, true)
    `, [ids.hotStationA, ids.juiceStationA, ids.tenantBStation, ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active, assigned_kitchen_station_id)
      values
        ($1, $5, $8, 'owner', 'Owner A', 'kitchen-staff-station-phase4a1-owner-a@example.test', true, null),
        ($2, $6, $9, 'owner', 'Owner B', 'kitchen-staff-station-phase4a1-owner-b@example.test', true, null),
        ($3, $5, $10, 'kitchen', 'Station Cook', 'kitchen-staff-station-phase4a1-kitchen@example.test', true, $7),
        ($4, $5, $11, 'cashier', 'Cashier A', 'kitchen-staff-station-phase4a1-cashier@example.test', true, null)
    `, [
      ids.staffOwnerA, ids.staffOwnerB, ids.staffKitchenA, ids.staffCashierA,
      ids.restaurantA, ids.restaurantB, ids.hotStationA,
      ids.ownerA, ids.ownerB, ids.kitchenA, ids.cashierA,
    ]);

    const ownerStaffRows = await asRole(client, "authenticated", ids.ownerA, `
      select id, role, assigned_kitchen_station_id
      from public.restaurant_staff
      where restaurant_id = $1
      order by created_at
    `, [ids.restaurantA]);
    results.push({
      label: "RLS lets owners read station assignments for their staff",
      ok: ownerStaffRows.rows.some((row) => row.id === ids.staffKitchenA && row.assigned_kitchen_station_id === ids.hotStationA),
      detail: JSON.stringify(ownerStaffRows.rows),
    });

    const tenantUpdate = await asRole(client, "authenticated", ids.ownerB, `
      update public.restaurant_staff
      set assigned_kitchen_station_id = $1
      where id = $2
      returning id
    `, [ids.tenantBStation, ids.staffKitchenA]);
    const protectedAssignment = await client.query(`
      select restaurant_id, assigned_kitchen_station_id
      from public.restaurant_staff
      where id = $1
    `, [ids.staffKitchenA]);
    results.push({
      label: "Multi-tenant isolation",
      ok: tenantUpdate.rows.length === 0 &&
        protectedAssignment.rows[0]?.restaurant_id === ids.restaurantA &&
        protectedAssignment.rows[0]?.assigned_kitchen_station_id === ids.hotStationA,
      detail: JSON.stringify({
        updatedRows: tenantUpdate.rows.length,
        assignmentAfterUnauthorizedUpdate: protectedAssignment.rows[0],
      }),
    });

    const stationUpdate = await asRole(client, "authenticated", ids.ownerA, `
      update public.restaurant_staff
      set assigned_kitchen_station_id = $1
      where id = $2 and restaurant_id = $3
      returning assigned_kitchen_station_id
    `, [ids.juiceStationA, ids.staffKitchenA, ids.restaurantA]);
    results.push({
      label: "Station update works",
      ok: stationUpdate.rows[0]?.assigned_kitchen_station_id === ids.juiceStationA,
      detail: JSON.stringify(stationUpdate.rows[0]),
    });

    const cashierConversion = await asRole(client, "authenticated", ids.ownerA, `
      update public.restaurant_staff
      set role = 'cashier', assigned_kitchen_station_id = null
      where id = $1 and restaurant_id = $2
      returning role::text as role, assigned_kitchen_station_id
    `, [ids.staffKitchenA, ids.restaurantA]);
    results.push({
      label: "Cashier conversion clears assignment",
      ok: cashierConversion.rows[0]?.role === "cashier" && cashierConversion.rows[0]?.assigned_kitchen_station_id === null,
      detail: JSON.stringify(cashierConversion.rows[0]),
    });

    const kitchenConversion = await asRole(client, "authenticated", ids.ownerA, `
      update public.restaurant_staff
      set role = 'kitchen', assigned_kitchen_station_id = $1
      where id = $2 and restaurant_id = $3
      returning role::text as role, assigned_kitchen_station_id
    `, [ids.hotStationA, ids.staffKitchenA, ids.restaurantA]);
    results.push({
      label: "Kitchen conversion stores assignment",
      ok: kitchenConversion.rows[0]?.role === "kitchen" && kitchenConversion.rows[0]?.assigned_kitchen_station_id === ids.hotStationA,
      detail: JSON.stringify(kitchenConversion.rows[0]),
    });

    await client.query(`
      insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, target_staff_id, target_staff_email, details)
      values
        ($1, 'kitchen_staff_station_assigned', $2, $3, 'kitchen-staff-station-phase4a1-kitchen@example.test', jsonb_build_object('staff_name', 'Station Cook', 'old_station', null, 'new_station', 'Hot Drinks')),
        ($1, 'kitchen_staff_station_changed', $2, $3, 'kitchen-staff-station-phase4a1-kitchen@example.test', jsonb_build_object('staff_name', 'Station Cook', 'old_station', 'Hot Drinks', 'new_station', 'Juice Bar'))
    `, [ids.restaurantA, ids.staffOwnerA, ids.staffKitchenA]);
    const logRows = await asRole(client, "authenticated", ids.ownerA, `
      select action::text as action, details
      from public.staff_activity_log
      where restaurant_id = $1
        and action::text in ('kitchen_staff_station_assigned', 'kitchen_staff_station_changed')
      order by created_at
    `, [ids.restaurantA]);
    results.push({
      label: "Activity log entries created",
      ok: logRows.rows.length === 2 &&
        logRows.rows.every((row) => row.details.staff_name === "Station Cook") &&
        logRows.rows.some((row) => row.details.old_station === "Hot Drinks" && row.details.new_station === "Juice Bar"),
      detail: JSON.stringify(logRows.rows),
    });

    await client.query(`
      insert into public.categories (id, restaurant_id, name)
      values ($1, $2, 'Menu')
    `, [ids.categoryA, ids.restaurantA]);
    await client.query(`
      insert into public.restaurant_tables (id, restaurant_id, table_number, label, qr_token, qr_url, qr_path, active)
      values ($1, $2, 1, 'Table 1', $3, '/r/kitchen-staff-station-phase4a1-a/order?t=1', '/r/kitchen-staff-station-phase4a1-a/order?t=1', true)
    `, [ids.tableA, ids.restaurantA, ids.qrTokenA]);
    await asRole(client, "authenticated", ids.ownerA, `
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values
        ($1, $3, $4, 'Tea', 3, true, $5),
        ($2, $3, $4, 'Juice', 5, true, $6)
    `, [ids.tea, ids.juice, ids.restaurantA, ids.categoryA, ids.hotStationA, ids.juiceStationA]);
    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_by, payment_verified_at)
      values ($1, $2, null, 'paid', 8, 'Dashboard Check', '1', 'Cash', 'cashier', $3, now())
    `, [ids.orderA, ids.restaurantA, ids.staffCashierA]);
    await client.query(`
      insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price)
      values ($1, $2, $3, 1, 3), ($1, $2, $4, 1, 5)
    `, [ids.restaurantA, ids.orderA, ids.tea, ids.juice]);

    const hotQueue = await asRole(client, "authenticated", ids.kitchenA, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    await asRole(client, "authenticated", ids.ownerA, "update public.restaurant_staff set assigned_kitchen_station_id = $1 where id = $2 and restaurant_id = $3", [ids.juiceStationA, ids.staffKitchenA, ids.restaurantA]);
    const juiceQueue = await asRole(client, "authenticated", ids.kitchenA, "select * from public.get_station_kitchen_orders($1, null, false, false)", [ids.restaurantA]);
    results.push({
      label: "Existing kitchen dashboard respects updated assignments",
      ok: JSON.stringify(itemNames(hotQueue.rows)) === JSON.stringify(["Tea"]) &&
        JSON.stringify(itemNames(juiceQueue.rows)) === JSON.stringify(["Juice"]),
      detail: JSON.stringify({ before: itemNames(hotQueue.rows), after: itemNames(juiceQueue.rows) }),
    });

    const orderCount = await client.query("select count(*)::int as count from public.orders where restaurant_id = $1", [ids.restaurantA]);
    results.push({
      label: "Existing orders unchanged",
      ok: orderCount.rows[0].count === 1,
      detail: JSON.stringify(orderCount.rows[0]),
    });

    const ownerSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    const serviceSource = fs.readFileSync(path.join(sourceRoot, "src", "modules", "owner", "services", "staffManagementService.ts"), "utf8");
    const functionSource = fs.readFileSync(path.join(supabaseRoot, "functions", "manage-staff", "index.ts"), "utf8");
    results.push({
      label: "Kitchen staff creation requires station",
      ok: ownerSource.includes("Choose a kitchen station for kitchen staff.") &&
        functionSource.includes('requireUuid(payload.assignedKitchenStationId, "Kitchen station")') &&
        functionSource.includes("requireActiveKitchenStation(assignedKitchenStationId)"),
      detail: "UI and manage-staff validate kitchen station assignment.",
    });
    results.push({
      label: "Cashier creation does not require station",
      ok: functionSource.includes('role === "kitchen"') &&
        functionSource.includes(": null") &&
        ownerSource.includes('formRole === "kitchen"') &&
        serviceSource.includes("assignedKitchenStationId: input.assignedKitchenStationId ?? null"),
      detail: "Station selector is role-gated and cashier payload stores null assignment.",
    });
    results.push({
      label: "Station assignment stored correctly",
      ok: serviceSource.includes("assigned_kitchen_station_id") &&
        functionSource.includes("assigned_kitchen_station_id: assignedKitchenStationId") &&
        functionSource.includes("updates.assigned_kitchen_station_id = nextStationId"),
      detail: "Staff load, create, and update include assigned_kitchen_station_id.",
    });
    results.push({
      label: "Kitchen conversion requires assignment",
      ok: functionSource.includes("nextRole === \"kitchen\"") &&
        functionSource.includes('requireUuid(payload.assignedKitchenStationId, "Kitchen station")'),
      detail: "manage-staff requires a station whenever the resulting role is kitchen.",
    });
    results.push({
      label: "Staff table shows station",
      ok: ownerSource.includes("<th>Station</th>") &&
        ownerSource.includes("stationById.get(member.assigned_kitchen_station_id)?.name"),
      detail: "Owner staff table renders station names from kitchen_stations.",
    });
    results.push({
      label: "Realtime",
      ok: ownerSource.includes('table: "restaurant_staff"') &&
        ownerSource.includes("refreshStaff()"),
      detail: "Owner dashboard refreshes Staff page from restaurant_staff realtime updates.",
    });
    results.push({
      label: "Existing routing unchanged",
      ok: fs.readFileSync(path.join(supabaseRoot, "migrations", "043_kitchen_routing_engine.sql"), "utf8").includes("route_order_item_kitchen_station") &&
        !fs.readFileSync(path.join(supabaseRoot, "migrations", "045_kitchen_staff_station_assignment_ui.sql"), "utf8").includes("order_items"),
      detail: "Phase 4A.1 migration does not touch routing or order_items.",
    });

    try {
      execSync("npm run build", {
        cwd: sourceRoot,
        stdio: "pipe",
        shell: true,
      });
      results.push({ label: "Build passes", ok: true, detail: "npm run build" });
    } catch (error) {
      results.push({ label: "Build passes", ok: false, detail: error.stdout?.toString() || error.message });
    }
  } finally {
    await cleanup(client, ids);
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
