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
  const hex = crypto.createHash("sha256").update(`serveflow-table-qr-generation-audit-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('table-qr-audit-a','table-qr-audit-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'table-qr-audit-%@example.test'").catch(() => {});
}

function unique(values) {
  return new Set(values).size === values.length;
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
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "033_auto_table_qr_generation.sql"), "utf8"));
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "034_owner_qr_management.sql"), "utf8"));
    await cleanup(client, ids);

    for (const [id, email] of [
      [ids.ownerA, "table-qr-audit-owner-a@example.test"],
      [ids.ownerB, "table-qr-audit-owner-b@example.test"],
    ]) {
      await client.query(`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
      `, [id, email]);
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, table_count)
      values
        ($1, 'Table QR Audit A', 'table-qr-audit-a', 3),
        ($2, 'Table QR Audit B', 'table-qr-audit-b', 2)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Owner A', 'table-qr-audit-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Owner B', 'table-qr-audit-owner-b@example.test', true)
    `, [ids.staffA, ids.staffB, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB]);

    const createdTables = await client.query(`
      select table_number, active, qr_token, qr_path, qr_url, qr_created_at, qr_regenerated_at
      from public.restaurant_tables
      where restaurant_id = $1
      order by table_number
    `, [ids.restaurantA]);
    results.push({
      label: "Tables auto-create on restaurant insert",
      ok: createdTables.rowCount === 3 && createdTables.rows.every((row, index) => row.table_number === index + 1 && row.active === true),
      detail: JSON.stringify(createdTables.rows),
    });
    results.push({
      label: "QR metadata auto-generates for active tables",
      ok: createdTables.rows.every((row) =>
        row.qr_token &&
        row.qr_created_at &&
        row.qr_regenerated_at &&
        row.qr_url === row.qr_path &&
        row.qr_url.startsWith(`/r/table-qr-audit-a/order?t=${row.table_number}&qr=`)
      ) && unique(createdTables.rows.map((row) => row.qr_token)),
      detail: JSON.stringify(createdTables.rows),
    });

    await client.query("update public.restaurants set table_count = 2 where id = $1", [ids.restaurantA]);
    const decreasedTables = await client.query(`
      select table_number, active, qr_token
      from public.restaurant_tables
      where restaurant_id = $1
      order by table_number
    `, [ids.restaurantA]);
    results.push({
      label: "Table decrease archives extra tables without deleting history",
      ok: decreasedTables.rowCount === 3
        && decreasedTables.rows.filter((row) => row.active).length === 2
        && decreasedTables.rows.find((row) => row.table_number === 3)?.active === false,
      detail: JSON.stringify(decreasedTables.rows),
    });

    await client.query("update public.restaurants set total_tables = 4 where id = $1", [ids.restaurantA]);
    const increasedTables = await client.query(`
      select table_number, active, qr_token, qr_url
      from public.restaurant_tables
      where restaurant_id = $1
      order by table_number
    `, [ids.restaurantA]);
    results.push({
      label: "Table increase reactivates existing tables and creates missing tables",
      ok: increasedTables.rowCount === 4
        && increasedTables.rows.every((row, index) => row.table_number === index + 1 && row.active === true)
        && increasedTables.rows.find((row) => row.table_number === 3)?.qr_token === decreasedTables.rows.find((row) => row.table_number === 3)?.qr_token,
      detail: JSON.stringify(increasedTables.rows),
    });
    results.push({
      label: "Never duplicates tables per restaurant",
      ok: unique(increasedTables.rows.map((row) => row.table_number)) && unique(increasedTables.rows.map((row) => row.qr_token)),
      detail: JSON.stringify(increasedTables.rows),
    });

    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $2, 'Audit Menu')", [ids.categoryA, ids.restaurantA]);
    await client.query("insert into public.menu_items (id, restaurant_id, category_id, name, price, available) values ($1, $2, $3, 'Audit Item', 42, true)", [ids.itemA, ids.restaurantA, ids.categoryA]);

    const qrMenu = await asRole(client, "anon", null, "select public.get_public_qr_menu('table-qr-audit-a') as menu");
    const publicTables = qrMenu.rows[0].menu.tables;
    results.push({
      label: "Existing public QR menu returns active generated tables",
      ok: publicTables.length === 4 && publicTables.every((row) => row.qr_path && row.qr_path.includes("/r/table-qr-audit-a/order?t=")),
      detail: JSON.stringify(publicTables),
    });

    const firstQrUrl = new URL(`https://serveflow.test${increasedTables.rows[0].qr_url}`);
    const tableFromQr = firstQrUrl.searchParams.get("t");
    const tokenFromQr = firstQrUrl.searchParams.get("qr");
    const order = await asRole(
      client,
      "anon",
      null,
      "select public.create_public_qr_order('table-qr-audit-a', $1, $2, 'QR Guest', 'Cash', $3::jsonb) as created",
      [tableFromQr, tokenFromQr, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
    );
    results.push({
      label: "Existing QR ordering still works with generated QR URL",
      ok: order.rows[0].created.status === "pending_payment" && Number(order.rows[0].created.total_price) === 42 && order.rows[0].created.table_number === tableFromQr,
      detail: JSON.stringify(order.rows[0].created),
    });

    results.push(await expectReject(
      "Public QR ordering rejects missing QR token",
      () => asRole(
        client,
        "anon",
        null,
        "select public.create_public_qr_order('table-qr-audit-a', $1, 'QR Guest', 'Cash', $2::jsonb)",
        [tableFromQr, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
      ),
      /valid table QR code/i
    ));

    const ownerSync = await asRole(client, "authenticated", ids.ownerA, "select count(*)::int as active_count from public.sync_restaurant_tables($1, 4)", [ids.restaurantA]);
    results.push({
      label: "Restaurant owner can sync own generated tables",
      ok: ownerSync.rows[0].active_count === 4,
      detail: JSON.stringify(ownerSync.rows[0]),
    });

    const targetTable = increasedTables.rows[0];
    const regenerated = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      `select table_number, active, qr_token, qr_url, qr_path, qr_regenerated_at
       from public.regenerate_restaurant_table_qr($1, (select id from public.restaurant_tables where restaurant_id = $1 and table_number = 1))`,
      [ids.restaurantA]
    );
    results.push({
      label: "Owner regenerate RPC updates only backend QR token and URL",
      ok: regenerated.rows[0].qr_token !== targetTable.qr_token
        && regenerated.rows[0].qr_url === regenerated.rows[0].qr_path
        && regenerated.rows[0].qr_url.startsWith("/r/table-qr-audit-a/order?t=1&qr="),
      detail: JSON.stringify({ before: targetTable, after: regenerated.rows[0] }),
    });

    results.push(await expectReject(
      "Old QR token is rejected immediately after regeneration",
      () => asRole(
        client,
        "anon",
        null,
        "select public.create_public_qr_order('table-qr-audit-a', '1', $1, 'Old QR Guest', 'Cash', $2::jsonb)",
        [targetTable.qr_token, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
      ),
      /Invalid or expired table QR code/i
    ));

    const orderWithNewQr = await asRole(
      client,
      "anon",
      null,
      "select public.create_public_qr_order('table-qr-audit-a', '1', $1, 'New QR Guest', 'Cash', $2::jsonb) as created",
      [regenerated.rows[0].qr_token, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
    );
    results.push({
      label: "New QR token is accepted after regeneration",
      ok: orderWithNewQr.rows[0].created.status === "pending_payment"
        && orderWithNewQr.rows[0].created.table_number === "1"
        && Number(orderWithNewQr.rows[0].created.total_price) === 42,
      detail: JSON.stringify(orderWithNewQr.rows[0].created),
    });

    const disabled = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      `select table_number, active
       from public.set_restaurant_table_active($1, (select id from public.restaurant_tables where restaurant_id = $1 and table_number = 1), false)`,
      [ids.restaurantA]
    );
    const enabled = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      `select table_number, active
       from public.set_restaurant_table_active($1, (select id from public.restaurant_tables where restaurant_id = $1 and table_number = 1), true)`,
      [ids.restaurantA]
    );
    results.push({
      label: "Owner enable/disable RPC updates table active state",
      ok: disabled.rows[0].active === false && enabled.rows[0].active === true,
      detail: JSON.stringify({ disabled: disabled.rows[0], enabled: enabled.rows[0] }),
    });

    await asRole(
      client,
      "authenticated",
      ids.ownerA,
      `select public.set_restaurant_table_active($1, (select id from public.restaurant_tables where restaurant_id = $1 and table_number = 1), false)`,
      [ids.restaurantA]
    );
    results.push(await expectReject(
      "Disabled QR token cannot place orders",
      () => asRole(
        client,
        "anon",
        null,
        "select public.create_public_qr_order('table-qr-audit-a', '1', $1, 'Disabled QR Guest', 'Cash', $2::jsonb)",
        [regenerated.rows[0].qr_token, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
      ),
      /Invalid or expired table QR code/i
    ));
    await asRole(
      client,
      "authenticated",
      ids.ownerA,
      `select public.set_restaurant_table_active($1, (select id from public.restaurant_tables where restaurant_id = $1 and table_number = 1), true)`,
      [ids.restaurantA]
    );

    const preservedOrders = await client.query(
      "select id, customer_name, table_number, total_price from public.orders where restaurant_id = $1 and id in ($2, $3) order by created_at",
      [ids.restaurantA, order.rows[0].created.order_id, orderWithNewQr.rows[0].created.order_id]
    );
    results.push({
      label: "Historical orders remain unchanged after QR regeneration and disable",
      ok: preservedOrders.rowCount === 2
        && preservedOrders.rows.some((row) => row.customer_name === "QR Guest" && row.table_number === "1" && Number(row.total_price) === 42)
        && preservedOrders.rows.some((row) => row.customer_name === "New QR Guest" && row.table_number === "1" && Number(row.total_price) === 42),
      detail: JSON.stringify(preservedOrders.rows),
    });

    results.push(await expectReject(
      "Multi-tenant isolation blocks owner regenerating another restaurant table",
      () => asRole(
        client,
        "authenticated",
        ids.ownerB,
        `select public.regenerate_restaurant_table_qr($1, (select id from public.restaurant_tables where restaurant_id = $1 and table_number = 1))`,
        [ids.restaurantA]
      ),
      /Only restaurant owners/i
    ));

    results.push(await expectReject(
      "Multi-tenant isolation blocks owner toggling another restaurant table",
      () => asRole(
        client,
        "authenticated",
        ids.ownerB,
        `select public.set_restaurant_table_active($1, (select id from public.restaurant_tables where restaurant_id = $1 and table_number = 1), false)`,
        [ids.restaurantA]
      ),
      /Only restaurant owners/i
    ));

    results.push(await expectReject(
      "Multi-tenant isolation blocks owner syncing another restaurant",
      () => asRole(client, "authenticated", ids.ownerB, "select public.sync_restaurant_tables($1, 4)", [ids.restaurantA]),
      /Only restaurant owners/i
    ));

    results.push(await expectReject(
      "Anonymous users cannot execute table sync RPC",
      () => asRole(client, "anon", null, "select public.sync_restaurant_tables($1, 4)", [ids.restaurantA]),
      /permission denied|Authentication is required/i
    ));
  } finally {
    await cleanup(client, ids);
    await client.end();
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}: ${result.detail}`);
  console.log(`Passed: ${failed.length === 0 ? "all" : results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log("Warnings: 0");
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
