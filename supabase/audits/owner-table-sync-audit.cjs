const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { Client } = require("pg");

function readConnectionUrl() {
  const envPath = path.join(__dirname, "connection.env");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const line = lines.find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

function uuid(label) {
  const hex = crypto.createHash("sha256").update(`serveflow-owner-table-sync-audit-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurant_table_qr_scans where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('owner-table-sync-audit-a','owner-table-sync-audit-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'owner-table-sync-audit-%@example.test'").catch(() => {});
}

function unique(values) {
  return new Set(values).size === values.length;
}

function expectedNumbers(rows, count) {
  return rows.length === count && rows.every((row, index) => row.table_number === index + 1);
}

async function loadTables(client, restaurantId) {
  const result = await client.query(`
    select id, table_number, active, qr_token, qr_url, qr_path, qr_regenerated_at
    from public.restaurant_tables
    where restaurant_id = $1
    order by table_number
  `, [restaurantId]);
  return result.rows;
}

async function updateSettingsTableCount(client, restaurantId, tableCount, ownerId, name = "Owner Table Sync Audit A") {
  return asRole(
    client,
    "authenticated",
    ownerId,
    `select *
     from public.update_restaurant_configuration(
       $1, $2, $3,
       '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
     )`,
    [restaurantId, name, tableCount]
  );
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    staffA: uuid("staff-a"),
    staffB: uuid("staff-b"),
    categoryA: uuid("category-a"),
    itemA: uuid("item-a"),
    activeOrder: uuid("active-order"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "039_single_source_restaurant_table_creation.sql"), "utf8"));
    await cleanup(client, ids);

    for (const [id, email] of [
      [ids.ownerA, "owner-table-sync-audit-owner-a@example.test"],
      [ids.ownerB, "owner-table-sync-audit-owner-b@example.test"],
    ]) {
      await client.query(`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
      `, [id, email]);
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables, table_count)
      values
        ($1, 'Owner Table Sync Audit A', 'owner-table-sync-audit-a', 10, 10),
        ($2, 'Owner Table Sync Audit B', 'owner-table-sync-audit-b', 4, 4)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Owner A', 'owner-table-sync-audit-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Owner B', 'owner-table-sync-audit-owner-b@example.test', true)
    `, [ids.staffA, ids.staffB, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB]);

    await asRole(client, "authenticated", ids.ownerA, "select public.sync_restaurant_tables($1, 10)", [ids.restaurantA]);
    await asRole(client, "authenticated", ids.ownerB, "select public.sync_restaurant_tables($1, 4)", [ids.restaurantB]);

    const initialTables = await loadTables(client, ids.restaurantA);
    const originalQrByTable = new Map(initialTables.map((row) => [row.table_number, row.qr_token]));
    results.push({
      label: "Initial tables are numbered 1..10 with QR metadata",
      ok: expectedNumbers(initialTables, 10) && initialTables.every((row) => row.qr_token && row.qr_url === row.qr_path),
      detail: JSON.stringify(initialTables),
    });
    await client.query("delete from public.staff_activity_log where restaurant_id = $1", [ids.restaurantA]);

    await updateSettingsTableCount(client, ids.restaurantA, 15, ids.ownerA);
    const increasedTables = await loadTables(client, ids.restaurantA);
    results.push({
      label: "10 -> 15 creates Tables 11-15 through Owner Settings RPC",
      ok: expectedNumbers(increasedTables, 15)
        && increasedTables.slice(10).every((row) => row.active && row.qr_token && row.qr_url.includes(`/r/owner-table-sync-audit-a/order?t=${row.table_number}&qr=`)),
      detail: JSON.stringify(increasedTables.slice(10)),
    });
    results.push({
      label: "Existing QR codes remain unchanged on increase",
      ok: increasedTables.slice(0, 10).every((row) => originalQrByTable.get(row.table_number) === row.qr_token),
      detail: JSON.stringify(increasedTables.slice(0, 10)),
    });
    results.push({
      label: "No duplicate table numbers or QR tokens after increase",
      ok: unique(increasedTables.map((row) => row.table_number)) && unique(increasedTables.map((row) => row.qr_token)),
      detail: JSON.stringify(increasedTables.map((row) => ({ table_number: row.table_number, qr_token: row.qr_token }))),
    });

    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source)
      values ($1, $2, null, 'preparing', 25, 'Active Guest', '15', 'Cash', 'cashier')
    `, [ids.activeOrder, ids.restaurantA]);
    results.push(await expectReject(
      "Active tables cannot be removed",
      () => updateSettingsTableCount(client, ids.restaurantA, 10, ids.ownerA),
      /Cannot reduce restaurant to 10 tables because Table 15 currently has an active order/i
    ));

    const afterRejectedConfig = await client.query("select total_tables, table_count from public.restaurants where id = $1", [ids.restaurantA]);
    const afterRejectedTables = await loadTables(client, ids.restaurantA);
    results.push({
      label: "Rejected reduction is atomic",
      ok: Number(afterRejectedConfig.rows[0].table_count) === 15 && afterRejectedTables.length === 15,
      detail: JSON.stringify({ config: afterRejectedConfig.rows[0], table_count: afterRejectedTables.length }),
    });

    await client.query("update public.orders set status = 'completed', completed_at = now(), completed_by = $2 where id = $1", [ids.activeOrder, ids.staffA]);
    await updateSettingsTableCount(client, ids.restaurantA, 10, ids.ownerA);
    const decreasedTables = await loadTables(client, ids.restaurantA);
    const decreasedConfig = await client.query("select total_tables, table_count from public.restaurants where id = $1", [ids.restaurantA]);
    results.push({
      label: "15 -> 10 removes only safe tables",
      ok: expectedNumbers(decreasedTables, 10) && Number(decreasedConfig.rows[0].table_count) === 10,
      detail: JSON.stringify({ config: decreasedConfig.rows[0], tables: decreasedTables }),
    });
    results.push({
      label: "Existing QR codes remain unchanged on decrease",
      ok: decreasedTables.every((row) => originalQrByTable.get(row.table_number) === row.qr_token),
      detail: JSON.stringify(decreasedTables),
    });

    const beforeNoopLogs = await client.query("select count(*)::int as count from public.staff_activity_log where restaurant_id = $1", [ids.restaurantA]);
    await asRole(client, "authenticated", ids.ownerA, "select count(*)::int as count from public.sync_restaurant_tables($1, 10)", [ids.restaurantA]);
    const afterNoopLogs = await client.query("select count(*)::int as count from public.staff_activity_log where restaurant_id = $1", [ids.restaurantA]);
    results.push({
      label: "10 -> 10 direct sync is idempotent",
      ok: beforeNoopLogs.rows[0].count === afterNoopLogs.rows[0].count,
      detail: JSON.stringify({ before: beforeNoopLogs.rows[0], after: afterNoopLogs.rows[0] }),
    });

    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $2, 'Audit Menu')", [ids.categoryA, ids.restaurantA]);
    await client.query("insert into public.menu_items (id, restaurant_id, category_id, name, price, available) values ($1, $2, $3, 'Audit Item', 42, true)", [ids.itemA, ids.restaurantA, ids.categoryA]);
    const tableOneUrl = new URL(`https://serveflow.test${decreasedTables[0].qr_url}`);
    const qrOrder = await asRole(
      client,
      "anon",
      null,
      "select public.create_public_qr_order('owner-table-sync-audit-a', $1, $2, 'QR Guest', 'Cash', $3::jsonb) as created",
      [tableOneUrl.searchParams.get("t"), tableOneUrl.searchParams.get("qr"), JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
    );
    results.push({
      label: "Existing QR ordering still works",
      ok: qrOrder.rows[0].created.status === "pending_payment" && qrOrder.rows[0].created.table_number === "1",
      detail: JSON.stringify(qrOrder.rows[0].created),
    });

    const stats = await asRole(client, "authenticated", ids.ownerA, "select * from public.get_owner_table_qr_stats($1) order by table_number", [ids.restaurantA]);
    results.push({
      label: "QR statistics initialize for synchronized tables",
      ok: stats.rowCount === 10 && expectedNumbers(stats.rows, 10),
      detail: JSON.stringify(stats.rows),
    });

    const restaurantB = await client.query("select table_count from public.restaurants where id = $1", [ids.restaurantB]);
    const restaurantBTables = await loadTables(client, ids.restaurantB);
    results.push({
      label: "Multi-tenant isolation keeps Restaurant B unchanged",
      ok: Number(restaurantB.rows[0].table_count) === 4 && restaurantBTables.length === 4,
      detail: JSON.stringify({ config: restaurantB.rows[0], tables: restaurantBTables }),
    });

    results.push(await expectReject(
      "Multi-tenant isolation blocks another owner changing table count",
      () => updateSettingsTableCount(client, ids.restaurantA, 12, ids.ownerB),
      /Only restaurant owners may update settings/i
    ));
    results.push(await expectReject(
      "RLS blocks browser-side restaurant table inserts",
      () => asRole(
        client,
        "authenticated",
        ids.ownerA,
        "insert into public.restaurant_tables (restaurant_id, table_number, label, qr_path, qr_token, qr_url) values ($1, 99, 'Table 99', '/x', gen_random_uuid(), '/x')",
        [ids.restaurantA]
      ),
      /permission denied|violates row-level security/i
    ));

    const logs = await client.query(`
      select action::text, count(*)::int as count
      from public.staff_activity_log
      where restaurant_id = $1
        and action::text in ('tables_created', 'tables_removed', 'table_synchronization_performed')
      group by action::text
      order by action::text
    `, [ids.restaurantA]);
    results.push({
      label: "Audit log records created, removed, and synchronization actions once per successful change",
      ok: logs.rows.some((row) => row.action === "tables_created" && row.count === 1)
        && logs.rows.some((row) => row.action === "tables_removed" && row.count === 1)
        && logs.rows.some((row) => row.action === "table_synchronization_performed" && row.count === 2),
      detail: JSON.stringify(logs.rows),
    });

    const ownerSource = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    results.push({
      label: "Owner Dashboard refreshes QR Management and table cards after settings save",
      ok: ownerSource.includes("onSettingsChanged={refreshRestaurantConfig}") && ownerSource.includes('table: "restaurant_tables"'),
      detail: "Settings save callback and restaurant_tables realtime subscription are present.",
    });

    try {
      execSync("npm run build", {
        cwd: path.join(__dirname, ".."),
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
