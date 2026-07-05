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
  const hex = crypto.createHash("sha256").update(`serveflow-qr-management-audit-${label}`).digest("hex").slice(0, 32);
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
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('qr-management-audit-a','qr-management-audit-b')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'qr-management-audit-%@example.test'").catch(() => {});
}

function sourceIncludes(source, snippets) {
  return snippets.every((snippet) => source.includes(snippet));
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
      [ids.ownerA, "qr-management-audit-owner-a@example.test"],
      [ids.ownerB, "qr-management-audit-owner-b@example.test"],
    ]) {
      await client.query(`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
      `, [id, email]);
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, table_count, branding)
      values
        ($1, 'QR Management Audit A', 'qr-management-audit-a', 2, '{"logo_url":"https://example.test/logo-a.png"}'::jsonb),
        ($2, 'QR Management Audit B', 'qr-management-audit-b', 1, '{"logo_url":"https://example.test/logo-b.png"}'::jsonb)
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $3, $5, 'owner', 'Owner A', 'qr-management-audit-owner-a@example.test', true),
        ($2, $4, $6, 'owner', 'Owner B', 'qr-management-audit-owner-b@example.test', true)
    `, [ids.staffA, ids.staffB, ids.restaurantA, ids.restaurantB, ids.ownerA, ids.ownerB]);

    const tables = await client.query(`
      select id, table_number, active, qr_token, qr_url, qr_path
      from public.restaurant_tables
      where restaurant_id = $1
      order by table_number
    `, [ids.restaurantA]);
    results.push({
      label: "Automatic table creation",
      ok: tables.rowCount === 2 && tables.rows.every((row, index) => row.table_number === index + 1 && row.active === true),
      detail: JSON.stringify(tables.rows),
    });
    results.push({
      label: "QR generation",
      ok: tables.rows.every((row) => row.qr_token && row.qr_url === row.qr_path && row.qr_url.includes(`t=${row.table_number}&qr=${row.qr_token}`)),
      detail: JSON.stringify(tables.rows),
    });

    const originalToken = tables.rows[0].qr_token;
    const regenerated = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      "select qr_token, qr_url, qr_path from public.regenerate_restaurant_table_qr($1, $2)",
      [ids.restaurantA, tables.rows[0].id]
    );
    results.push({
      label: "QR regeneration",
      ok: regenerated.rows[0].qr_token !== originalToken && regenerated.rows[0].qr_url === regenerated.rows[0].qr_path,
      detail: JSON.stringify({ before: originalToken, after: regenerated.rows[0] }),
    });

    const afterBranding = await client.query(
      `update public.restaurants
       set name = 'QR Management Audit Renamed',
           branding = jsonb_build_object('logo_url', 'https://example.test/logo-renamed.png')
       where id = $1
       returning name, branding`,
      [ids.restaurantA]
    );
    const unchangedQr = await client.query("select qr_token, qr_url from public.restaurant_tables where id = $1", [tables.rows[0].id]);
    results.push({
      label: "Printable assets update from restaurant name and logo without manual regeneration",
      ok: afterBranding.rows[0].name === "QR Management Audit Renamed"
        && afterBranding.rows[0].branding.logo_url === "https://example.test/logo-renamed.png"
        && unchangedQr.rows[0].qr_token === regenerated.rows[0].qr_token,
      detail: JSON.stringify({ restaurant: afterBranding.rows[0], table: unchangedQr.rows[0] }),
    });

    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $2, 'Audit Menu')", [ids.categoryA, ids.restaurantA]);
    await client.query("insert into public.menu_items (id, restaurant_id, category_id, name, price, available) values ($1, $2, $3, 'Audit Item', 42, true)", [ids.itemA, ids.restaurantA, ids.categoryA]);

    await asRole(
      client,
      "anon",
      null,
      "select public.log_public_qr_scan('qr-management-audit-a', '1', $1)",
      [regenerated.rows[0].qr_token]
    );

    const order = await asRole(
      client,
      "anon",
      null,
      "select public.create_public_qr_order('qr-management-audit-a', '1', $1, 'QR Guest', 'Cash', $2::jsonb) as created",
      [regenerated.rows[0].qr_token, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
    );
    results.push({
      label: "Public ordering still works",
      ok: order.rows[0].created.status === "pending_payment" && Number(order.rows[0].created.total_price) === 42,
      detail: JSON.stringify(order.rows[0].created),
    });

    const stats = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      "select * from public.get_owner_table_qr_stats($1) where table_number = 1",
      [ids.restaurantA]
    );
    results.push({
      label: "Statistics",
      ok: stats.rowCount === 1
        && stats.rows[0].orders_today >= 1
        && stats.rows[0].last_scan_at
        && stats.rows[0].last_order_at
        && stats.rows[0].scan_count >= 1,
      detail: JSON.stringify(stats.rows[0]),
    });

    results.push(await expectReject(
      "Multi-tenant isolation",
      () => asRole(client, "authenticated", ids.ownerB, "select * from public.get_owner_table_qr_stats($1)", [ids.restaurantA]),
      /Only restaurant owners/i
    ));

    results.push(await expectReject(
      "Old QR token rejected after regeneration",
      () => asRole(
        client,
        "anon",
        null,
        "select public.create_public_qr_order('qr-management-audit-a', '1', $1, 'Old QR Guest', 'Cash', $2::jsonb)",
        [originalToken, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
      ),
      /Invalid or expired table QR code/i
    ));

    const ownerSource = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "owner", "pages", "OwnerDashboardPage.tsx"), "utf8");
    results.push({
      label: "Printing",
      ok: sourceIncludes(ownerSource, ["function printQrCards", "qr-logo", "window.print()", "restaurantConfig?.name ?? restaurantName"]),
      detail: "Owner QR print cards use current restaurant name/logo.",
    });
    results.push({
      label: "Downloads",
      ok: sourceIncludes(ownerSource, ["downloadQrPng", "downloadQrSvg", "downloadQrPdf", "createQrCardCanvas({ restaurantName, logoUrl"]),
      detail: "Owner QR downloads generate branded PNG, SVG, and PDF assets.",
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
