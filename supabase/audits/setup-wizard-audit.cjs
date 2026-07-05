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
  const hex = crypto.createHash("sha256").update(`serveflow-setup-wizard-audit-${label}`).digest("hex").slice(0, 32);
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
  const restaurants = [ids.restaurantA, ids.restaurantB, ids.existingRestaurant];
  await client.query("delete from public.restaurant_table_qr_scans where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('setup-wizard-audit-a','setup-wizard-audit-b','setup-wizard-existing')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'setup-wizard-audit-%@example.test'").catch(() => {});
}

async function main() {
  const ids = {
    ownerA: uuid("owner-a"),
    ownerB: uuid("owner-b"),
    existingOwner: uuid("existing-owner"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    existingRestaurant: uuid("existing-restaurant"),
    staffA: uuid("staff-a"),
    staffB: uuid("staff-b"),
    existingStaff: uuid("existing-staff"),
    categoryA: uuid("category-a"),
    itemA: uuid("item-a"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "033_auto_table_qr_generation.sql"), "utf8"));
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "034_owner_qr_management.sql"), "utf8"));
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "035_restaurant_setup_wizard.sql"), "utf8"));
    await cleanup(client, ids);

    for (const [id, email] of [
      [ids.ownerA, "setup-wizard-audit-owner-a@example.test"],
      [ids.ownerB, "setup-wizard-audit-owner-b@example.test"],
      [ids.existingOwner, "setup-wizard-audit-existing@example.test"],
    ]) {
      await client.query(`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
      `, [id, email]);
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, table_count, setup_status)
      values
        ($1, 'Setup Wizard Audit A', 'setup-wizard-audit-a', 2, '{"completed": false}'::jsonb),
        ($2, 'Setup Wizard Audit B', 'setup-wizard-audit-b', 1, '{"completed": false}'::jsonb),
        ($3, 'Setup Wizard Existing', 'setup-wizard-existing', 3, '{"completed": true, "legacy_completed": true}'::jsonb)
    `, [ids.restaurantA, ids.restaurantB, ids.existingRestaurant]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $4, $7, 'owner', 'Owner A', 'setup-wizard-audit-owner-a@example.test', true),
        ($2, $5, $8, 'owner', 'Owner B', 'setup-wizard-audit-owner-b@example.test', true),
        ($3, $6, $9, 'owner', 'Existing Owner', 'setup-wizard-audit-existing@example.test', true)
    `, [ids.staffA, ids.staffB, ids.existingStaff, ids.restaurantA, ids.restaurantB, ids.existingRestaurant, ids.ownerA, ids.ownerB, ids.existingOwner]);

    const firstLoginState = await asRole(client, "authenticated", ids.ownerA, "select setup_status from public.restaurants where id = $1", [ids.restaurantA]);
    results.push({
      label: "First login launches wizard",
      ok: firstLoginState.rows[0].setup_status.completed === false,
      detail: JSON.stringify(firstLoginState.rows[0].setup_status),
    });

    const beforeOrder = await client.query(`
      insert into public.orders (restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source)
      values ($1, null, 'pending_payment', 12, 'Historical Guest', '1', 'Cash', 'public_qr')
      returning id
    `, [ids.restaurantA]);

    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $2, 'Audit Menu')", [ids.categoryA, ids.restaurantA]);
    await client.query("insert into public.menu_items (id, restaurant_id, category_id, name, price, available) values ($1, $2, $3, 'Audit Item', 42, true)", [ids.itemA, ids.restaurantA, ids.categoryA]);

    const completed = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      `select public.complete_restaurant_setup(
        $1,
        $2::jsonb,
        $3::jsonb,
        $4::jsonb,
        $5::jsonb,
        $6::jsonb,
        $7::jsonb
      ) as payload`,
      [
        ids.restaurantA,
        JSON.stringify({ restaurant_name: "Setup Wizard Audit A Ready", restaurant_type: "Cafe", currency: "ETB", timezone: "Africa/Nairobi", phone: "+251900000000", address: "Bole", description: "Audit cafe" }),
        JSON.stringify({ logo_url: "https://example.test/logo.png", cover_url: "https://example.test/cover.png", tin_vat: "TIN-1", receipt_footer: "Thanks", social_links: { instagram: "setupcafe" } }),
        JSON.stringify({ table_count: 10 }),
        JSON.stringify({ opens_at: "07:00", closes_at: "21:00", closed_days: ["Sunday"] }),
        JSON.stringify({ mode: "single", skipped: false }),
        JSON.stringify([]),
      ]
    );
    const payload = completed.rows[0].payload;
    results.push({
      label: "Skipping optional steps works",
      ok: payload.restaurant.setup_status.completed === true
        && payload.restaurant.setup_status.staff_invited_count === 0
        && payload.restaurant.kitchen_settings.mode === "single",
      detail: JSON.stringify(payload.restaurant.setup_status),
    });
    results.push({
      label: "Returning owners never see wizard again",
      ok: payload.restaurant.setup_status.completed === true,
      detail: JSON.stringify(payload.restaurant.setup_status),
    });
    results.push({
      label: "Canonical setup configuration stored",
      ok: payload.restaurant.profile.restaurant_type === "Cafe"
        && payload.restaurant.profile.currency === "ETB"
        && payload.restaurant.profile.phone === "+251900000000"
        && payload.restaurant.profile.description === "Audit cafe"
        && payload.restaurant.branding.logo_url === "https://example.test/logo.png"
        && payload.restaurant.branding.cover_url === "https://example.test/cover.png"
        && payload.restaurant.business_hours.schedules[0].closed_days.includes("Sunday"),
      detail: JSON.stringify(payload.restaurant),
    });
    results.push({
      label: "QR generation still works",
      ok: Array.isArray(payload.tables)
        && payload.tables.length === 10
        && payload.tables.every((table) => table.qr_url && table.qr_url.includes("/r/setup-wizard-audit-a/order?t=")),
      detail: JSON.stringify(payload.tables.slice(0, 2)),
    });

    const repeated = await asRole(
      client,
      "authenticated",
      ids.ownerA,
      `select public.complete_restaurant_setup(
        $1,
        $2::jsonb,
        $3::jsonb,
        $4::jsonb,
        $5::jsonb,
        $6::jsonb,
        $7::jsonb
      ) as payload`,
      [
        ids.restaurantA,
        JSON.stringify({ restaurant_name: "Setup Wizard Audit A Ready", restaurant_type: "Cafe", currency: "ETB", timezone: "Africa/Nairobi", phone: "+251900000000", address: "Bole", description: "Audit cafe" }),
        JSON.stringify({ logo_url: "https://example.test/logo.png", cover_url: "https://example.test/cover.png", tin_vat: "TIN-1", receipt_footer: "Thanks", social_links: { instagram: "setupcafe" } }),
        JSON.stringify({ table_count: 10 }),
        JSON.stringify({ opens_at: "07:00", closes_at: "21:00", closed_days: ["Sunday"] }),
        JSON.stringify({ mode: "single", skipped: false }),
        JSON.stringify([]),
      ]
    );
    const repeatedPayload = repeated.rows[0].payload;
    const tableState = (tables) => tables.map((table) => ({
      id: table.id,
      table_number: table.table_number,
      qr_url: table.qr_url,
      active: table.active,
    }));
    results.push({
      label: "Repeated setup submission is idempotent",
      ok: JSON.stringify(repeatedPayload.restaurant.setup_status) === JSON.stringify(payload.restaurant.setup_status)
        && JSON.stringify(tableState(repeatedPayload.tables)) === JSON.stringify(tableState(payload.tables)),
      detail: JSON.stringify({ setup_status: repeatedPayload.restaurant.setup_status, tables: tableState(repeatedPayload.tables).slice(0, 2) }),
    });

    const tableCountAfterRepeat = await client.query(
      "select count(*)::integer as total, count(*) filter (where active)::integer as active from public.restaurant_tables where restaurant_id = $1",
      [ids.restaurantA]
    );
    results.push({
      label: "Repeated setup creates no duplicate tables",
      ok: tableCountAfterRepeat.rows[0].total === 10 && tableCountAfterRepeat.rows[0].active === 10,
      detail: JSON.stringify(tableCountAfterRepeat.rows[0]),
    });

    const newToken = payload.tables[0].qr_url.split("qr=")[1];
    const publicOrder = await asRole(
      client,
      "anon",
      null,
      "select public.create_public_qr_order('setup-wizard-audit-a', '1', $1, 'QR Guest', 'Cash', $2::jsonb) as created",
      [newToken, JSON.stringify([{ menu_item_id: ids.itemA, quantity: 1 }])]
    );
    results.push({
      label: "Public ordering still works after setup",
      ok: publicOrder.rows[0].created.status === "pending_payment" && Number(publicOrder.rows[0].created.total_price) === 42,
      detail: JSON.stringify(publicOrder.rows[0].created),
    });

    const historicalOrder = await client.query("select id, customer_name, total_price from public.orders where id = $1", [beforeOrder.rows[0].id]);
    results.push({
      label: "Existing data remains intact",
      ok: historicalOrder.rowCount === 1 && historicalOrder.rows[0].customer_name === "Historical Guest" && Number(historicalOrder.rows[0].total_price) === 12,
      detail: JSON.stringify(historicalOrder.rows),
    });

    const existingState = await asRole(client, "authenticated", ids.existingOwner, "select setup_status from public.restaurants where id = $1", [ids.existingRestaurant]);
    results.push({
      label: "Existing restaurants are unaffected",
      ok: existingState.rows[0].setup_status.completed === true,
      detail: JSON.stringify(existingState.rows[0].setup_status),
    });

    results.push(await expectReject(
      "Multi-tenant isolation",
      () => asRole(
        client,
        "authenticated",
        ids.ownerB,
        "select public.complete_restaurant_setup($1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb)",
        [ids.restaurantA]
      ),
      /Only restaurant owners/i
    ));

    try {
      execSync("npm run build", { cwd: path.join(__dirname, ".."), stdio: "pipe", shell: true });
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
