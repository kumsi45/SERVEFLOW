const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

function readConnectionUrl() {
  const envPath = path.join(__dirname, "connection.env");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const line = lines.find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-kitchen-stations-phase1-audit-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.kitchen_stations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('kitchen-stations-audit-a','kitchen-stations-audit-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'kitchen-stations-audit-%@example.test'").catch(() => {});
}

function rpc(action, restaurantId, fields = {}) {
  return [
    `select public.manage_kitchen_station($1, $2, $3, $4, $5, $6, $7, $8, $9) as result`,
    [
      restaurantId,
      action,
      fields.stationId ?? null,
      fields.name ?? null,
      fields.description ?? null,
      fields.color ?? "#0f766e",
      fields.icon ?? "MK",
      fields.priority ?? 100,
      fields.active ?? true,
    ],
  ];
}

async function ownerRpc(client, ownerId, action, restaurantId, fields = {}) {
  const [sql, params] = rpc(action, restaurantId, fields);
  return asRole(client, "authenticated", ownerId, sql, params);
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    staffA: uuid("staff-a"),
    staffB: uuid("staff-b"),
    cashierA: uuid("cashier-a"),
    cashierStaffA: uuid("cashier-staff-a"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    categoryA: uuid("category-a"),
    referencedItem: uuid("referenced-item"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "041_kitchen_station_foundation.sql"), "utf8"));
    await cleanup(client, ids);

    await client.query(`
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values
        ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-stations-audit-owner-a@example.test', '', now(), now(), now()),
        ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-stations-audit-owner-b@example.test', '', now(), now(), now()),
        ($3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kitchen-stations-audit-cashier-a@example.test', '', now(), now(), now())
    `, [ids.ownerA, ids.ownerB, ids.cashierA]);

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Kitchen Stations Audit A', 'kitchen-stations-audit-a', 5, 5),
        ($2, 'Kitchen Stations Audit B', 'kitchen-stations-audit-b', 5, 5)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $4, $6, 'owner', 'Owner A', 'kitchen-stations-audit-owner-a@example.test', true),
        ($2, $5, $7, 'owner', 'Owner B', 'kitchen-stations-audit-owner-b@example.test', true),
        ($3, $4, $8, 'cashier', 'Cashier A', 'kitchen-stations-audit-cashier-a@example.test', true)
    `, [ids.staffA, ids.staffB, ids.cashierStaffA, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB, ids.cashierA]);

    const firstLoad = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_owner_kitchen_stations($1)", [ids.restaurantA]);
    const mainKitchenRows = firstLoad.rows.filter((row) => row.name === "Main Kitchen");
    results.push({ label: "Default Main Kitchen created", ok: mainKitchenRows.length === 1, detail: JSON.stringify(firstLoad.rows) });

    const realtimePublication = await client.query(`
      select count(*)::int as count
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'kitchen_stations'
    `);
    results.push({ label: "Realtime publication includes kitchen_stations", ok: realtimePublication.rows[0].count === 1, detail: JSON.stringify(realtimePublication.rows[0]) });

    await asRole(client, "authenticated", ids.ownerA, "select public.ensure_default_kitchen_station($1)", [ids.restaurantA]);
    const mainKitchenCount = await client.query("select count(*)::int as count from public.kitchen_stations where restaurant_id = $1 and lower(btrim(name)) = 'main kitchen' and archived_at is null", [ids.restaurantA]);
    results.push({ label: "No duplicate Main Kitchen", ok: mainKitchenCount.rows[0].count === 1, detail: JSON.stringify(mainKitchenCount.rows[0]) });

    const createResult = await ownerRpc(client, ids.ownerA, "create", ids.restaurantA, { name: "Grill", description: "Grill station", color: "#2563eb", icon: "GR", priority: 20 });
    const stationId = createResult.rows[0].result.station_id;
    const created = await client.query("select * from public.kitchen_stations where id = $1", [stationId]);
    results.push({ label: "Create station", ok: created.rows[0]?.name === "Grill", detail: JSON.stringify(created.rows[0]) });

    await ownerRpc(client, ids.ownerA, "update", ids.restaurantA, { stationId, name: "Grill Updated", description: "Updated", color: "#dc2626", icon: "GR", priority: 15 });
    const edited = await client.query("select name, description, display_color, priority from public.kitchen_stations where id = $1", [stationId]);
    results.push({ label: "Edit station", ok: edited.rows[0].name === "Grill Updated" && edited.rows[0].priority === 15, detail: JSON.stringify(edited.rows[0]) });

    await ownerRpc(client, ids.ownerA, "disable", ids.restaurantA, { stationId });
    const disabled = await client.query("select active from public.kitchen_stations where id = $1", [stationId]);
    results.push({ label: "Disable station", ok: disabled.rows[0].active === false, detail: JSON.stringify(disabled.rows[0]) });

    await ownerRpc(client, ids.ownerA, "enable", ids.restaurantA, { stationId });
    const enabled = await client.query("select active from public.kitchen_stations where id = $1", [stationId]);
    results.push({ label: "Enable station", ok: enabled.rows[0].active === true, detail: JSON.stringify(enabled.rows[0]) });

    const unused = await ownerRpc(client, ids.ownerA, "create", ids.restaurantA, { name: "Unused", icon: "DS", priority: 30 });
    const unusedId = unused.rows[0].result.station_id;
    await ownerRpc(client, ids.ownerA, "delete", ids.restaurantA, { stationId: unusedId });
    const deletedUnused = await client.query("select count(*)::int as count from public.kitchen_stations where id = $1", [unusedId]);
    results.push({ label: "Delete unused station", ok: deletedUnused.rows[0].count === 0, detail: JSON.stringify(deletedUnused.rows[0]) });

    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $2, 'Kitchen Stations Audit')", [ids.categoryA, ids.restaurantA]);
    await client.query(`
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available, kitchen_station_id)
      values ($1, $2, $3, 'Referenced Item', 10, true, $4)
    `, [ids.referencedItem, ids.restaurantA, ids.categoryA, stationId]);
    results.push(await expectReject(
      "Reject delete when referenced",
      () => ownerRpc(client, ids.ownerA, "delete", ids.restaurantA, { stationId }),
      /currently in use/i
    ));

    results.push(await expectReject(
      "Station name required",
      () => ownerRpc(client, ids.ownerA, "create", ids.restaurantA, { name: "   " }),
      /Station name is required/i
    ));
    results.push(await expectReject(
      "Duplicate names rejected",
      () => ownerRpc(client, ids.ownerA, "create", ids.restaurantA, { name: "Grill Updated" }),
      /unique inside this restaurant/i
    ));
    results.push(await expectReject(
      "Priority cannot be negative",
      () => ownerRpc(client, ids.ownerA, "create", ids.restaurantA, { name: "Negative Priority", priority: -1 }),
      /Priority must be between 0 and 10000/i
    ));

    const inactive = await ownerRpc(client, ids.ownerA, "create", ids.restaurantA, { name: "Inactive Unique", active: false, priority: 40 });
    const inactiveId = inactive.rows[0].result.station_id;
    results.push(await expectReject(
      "Inactive stations cannot become duplicated",
      () => ownerRpc(client, ids.ownerA, "update", ids.restaurantA, { stationId: inactiveId, name: "Grill Updated", active: false }),
      /unique inside this restaurant/i
    ));

    await ownerRpc(client, ids.ownerB, "create", ids.restaurantB, { name: "Tenant B Station", icon: "BR" });
    const tenantCounts = await client.query("select restaurant_id, count(*)::int as count from public.kitchen_stations where restaurant_id in ($1, $2) group by restaurant_id", [ids.restaurantA, ids.restaurantB]);
    results.push({
      label: "Multi-tenant isolation",
      ok: tenantCounts.rows.some((row) => row.restaurant_id === ids.restaurantA && row.count >= 3) && tenantCounts.rows.some((row) => row.restaurant_id === ids.restaurantB && row.count === 2),
      detail: JSON.stringify(tenantCounts.rows),
    });
    results.push(await expectReject(
      "Multi-tenant owner cannot manage another restaurant",
      () => ownerRpc(client, ids.ownerB, "create", ids.restaurantA, { name: "Wrong Tenant" }),
      /Only restaurant owners may manage kitchen stations/i
    ));

    const logs = await client.query(`
      select action::text, count(*)::int as count
      from public.staff_activity_log
      where restaurant_id = $1
        and action::text like 'kitchen_station_%'
      group by action::text
      order by action::text
    `, [ids.restaurantA]);
    const actionCounts = new Map(logs.rows.map((row) => [row.action, row.count]));
    results.push({
      label: "Activity logs created",
      ok: ["kitchen_station_created", "kitchen_station_updated", "kitchen_station_disabled", "kitchen_station_enabled", "kitchen_station_deleted"].every((action) => (actionCounts.get(action) ?? 0) > 0),
      detail: JSON.stringify(logs.rows),
    });

    results.push(await expectReject(
      "RLS enforced for browser-side station writes",
      () => asRole(client, "authenticated", ids.ownerA, "insert into public.kitchen_stations (restaurant_id, name) values ($1, 'Direct Insert')", [ids.restaurantA]),
      /permission denied|violates row-level security/i
    ));
    const ownerSelect = await asRole(client, "authenticated", ids.ownerA, "select count(*)::int as count from public.kitchen_stations where restaurant_id = $1", [ids.restaurantA]);
    const crossSelect = await asRole(client, "authenticated", ids.ownerA, "select count(*)::int as count from public.kitchen_stations where restaurant_id = $1", [ids.restaurantB]);
    results.push({ label: "RLS enforced for tenant reads", ok: ownerSelect.rows[0].count > 0 && crossSelect.rows[0].count === 0, detail: JSON.stringify({ own: ownerSelect.rows[0], other: crossSelect.rows[0] }) });

    results.push(await expectReject(
      "Owner RPC permissions reject cashier",
      () => ownerRpc(client, ids.cashierA, "create", ids.restaurantA, { name: "Cashier Station" }),
      /Only restaurant owners may manage kitchen stations/i
    ));
    const [anonSql, anonParams] = rpc("create", ids.restaurantA, { name: "Anon Station" });
    results.push(await expectReject(
      "Owner RPC permissions reject anon",
      () => asRole(client, "anon", null, anonSql, anonParams),
      /permission denied|Only restaurant owners may manage kitchen stations/i
    ));
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
