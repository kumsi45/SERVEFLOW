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
  const hex = crypto.createHash("sha256").update(`serveflow-cashier-pos-audit-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function asRole(client, role, userId, sql, params = []) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
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
  await client.query("delete from public.staff_activity_log where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.cash_reconciliations where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.cashier_shifts where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.restaurants where id in ($1, $2) or slug in ('cashier-pos-audit-a', 'cashier-pos-audit-b')", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from auth.users where id in ($1, $2, $3, $4)", [ids.ownerUser, ids.cashierUser, ids.kitchenUser, ids.otherCashierUser]).catch(() => {});
}

async function main() {
  const ids = {
    ownerUser: uuid("owner-user"),
    cashierUser: uuid("cashier-user"),
    kitchenUser: uuid("kitchen-user"),
    otherCashierUser: uuid("other-cashier-user"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    ownerStaff: uuid("owner-staff"),
    cashierStaff: uuid("cashier-staff"),
    kitchenStaff: uuid("kitchen-staff"),
    otherCashierStaff: uuid("other-cashier-staff"),
    categoryA: uuid("category-a"),
    categoryB: uuid("category-b"),
    burger: uuid("burger"),
    tea: uuid("tea"),
    water: uuid("water"),
    cola: uuid("cola"),
    pizza: uuid("pizza"),
    otherItem: uuid("other-item"),
  };
  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "031_cashier_pos_order_entry.sql"), "utf8"));
    await cleanup(client, ids);

    for (const [id, email] of [
      [ids.ownerUser, "cashier-pos-owner@example.test"],
      [ids.cashierUser, "cashier-pos-cashier@example.test"],
      [ids.kitchenUser, "cashier-pos-kitchen@example.test"],
      [ids.otherCashierUser, "cashier-pos-other@example.test"],
    ]) {
      await client.query(`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
      `, [id, email]);
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables)
      values ($1, 'Cashier POS Audit A', 'cashier-pos-audit-a', 4), ($2, 'Cashier POS Audit B', 'cashier-pos-audit-b', 4)
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $5, $7, 'owner', 'Audit Owner', 'cashier-pos-owner@example.test', true),
        ($2, $5, $8, 'cashier', 'Audit Cashier', 'cashier-pos-cashier@example.test', true),
        ($3, $5, $9, 'kitchen', 'Audit Kitchen', 'cashier-pos-kitchen@example.test', true),
        ($4, $6, $10, 'cashier', 'Other Cashier', 'cashier-pos-other@example.test', true)
    `, [ids.ownerStaff, ids.cashierStaff, ids.kitchenStaff, ids.otherCashierStaff, ids.restaurantA, ids.restaurantB, ids.ownerUser, ids.cashierUser, ids.kitchenUser, ids.otherCashierUser]);
    await client.query(`
      insert into public.restaurant_tables (restaurant_id, table_number, label, qr_path, active)
      values
        ($1, 1, 'Table 1', '/r/cashier-pos-audit-a/order?table=1', true),
        ($1, 2, 'Table 2', '/r/cashier-pos-audit-a/order?table=2', true),
        ($2, 1, 'Table 1', '/r/cashier-pos-audit-b/order?table=1', true)
      on conflict (restaurant_id, table_number) do update set active = excluded.active
    `, [ids.restaurantA, ids.restaurantB]);
    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $3, 'Food'), ($2, $4, 'Other')", [ids.categoryA, ids.categoryB, ids.restaurantA, ids.restaurantB]);
    await client.query(`
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available)
      values
        ($1, $7, $8, 'Burger', 100, true),
        ($2, $7, $8, 'Tea', 20, true),
        ($3, $7, $8, 'Water', 15, true),
        ($4, $7, $8, 'Coca Cola', 30, true),
        ($5, $7, $8, 'Pizza', 150, true),
        ($6, $9, $10, 'Other Tenant Item', 999, true)
    `, [ids.burger, ids.tea, ids.water, ids.cola, ids.pizza, ids.otherItem, ids.restaurantA, ids.categoryA, ids.restaurantB, ids.categoryB]);

    await asRole(client, "authenticated", ids.cashierUser, "select id from public.open_cashier_shift($1, 100, 'pos audit')", [ids.restaurantA]);

    const created = await asRole(client, "authenticated", ids.cashierUser, "select public.create_cashier_order($1, '1', 'Cash', $2::jsonb) as order", [
      ids.restaurantA,
      JSON.stringify([
        { menu_item_id: ids.burger, quantity: 2, notes: "No onions" },
        { menu_item_id: ids.tea, quantity: 1 },
        { menu_item_id: ids.water, quantity: 1 },
      ]),
    ]);
    const order = created.rows[0].order;
    results.push({ label: "1. Cashier POS order creation works", ok: order.status === "paid" && Number(order.total_price) === 235, detail: JSON.stringify(order) });

    const kitchenRows = await asRole(client, "authenticated", ids.kitchenUser, `
      select o.id, o.status, count(oi.id) as item_rows
      from public.orders o join public.order_items oi on oi.order_id = o.id and oi.restaurant_id = o.restaurant_id
      where o.id = $1 and o.status in ('paid', 'preparing', 'ready')
      group by o.id, o.status
    `, [order.order_id]);
    results.push({ label: "2. Kitchen receives cashier orders", ok: kitchenRows.rowCount === 1 && Number(kitchenRows.rows[0].item_rows) === 3, detail: JSON.stringify(kitchenRows.rows[0]) });

    const itemPreviewSource = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "cashier", "pages", "CashierDashboardPage.tsx"), "utf8");
    results.push({ label: "3. Item preview renders from loaded order_items", ok: /getOrderItemPreview\(order\.items\)/.test(itemPreviewSource) && /preview\.hiddenCount/.test(itemPreviewSource), detail: "card preview uses order.items and +N more" });

    const active = await asRole(client, "authenticated", ids.cashierUser, "select id from public.orders where restaurant_id = $1 and table_number = '1' and status in ('pending_payment','paid','preparing','ready')", [ids.restaurantA]);
    results.push({ label: "4. Active order detection works", ok: active.rowCount === 1 && active.rows[0].id === order.order_id, detail: `${active.rowCount} active order for table 1` });

    const appended = await asRole(client, "authenticated", ids.cashierUser, "select public.append_items_to_order($1, $2::jsonb) as result", [
      order.order_id,
      JSON.stringify([{ menu_item_id: ids.cola, quantity: 1 }, { menu_item_id: ids.water, quantity: 1 }]),
    ]);
    const appendResult = appended.rows[0].result;
    const orderCount = await client.query("select count(*) from public.orders where restaurant_id = $1 and table_number = '1'", [ids.restaurantA]);
    results.push({ label: "5. Add To Existing Order works", ok: Number(orderCount.rows[0].count) === 1 && appendResult.order_id === order.order_id, detail: `orders_for_table=${orderCount.rows[0].count}, appended=${JSON.stringify(appendResult.items_added)}` });

    const total = await client.query("select total_price, updated_at from public.orders where id = $1", [order.order_id]);
    results.push({ label: "6. Totals recalculate correctly", ok: Number(total.rows[0].total_price) === 280 && Boolean(total.rows[0].updated_at), detail: JSON.stringify(total.rows[0]) });

    const appendedItems = await asRole(client, "authenticated", ids.kitchenUser, `
      select mi.name, oi.quantity, oi.appended_at
      from public.order_items oi join public.menu_items mi on mi.id = oi.menu_item_id and mi.restaurant_id = oi.restaurant_id
      where oi.order_id = $1 and oi.appended_at is not null
      order by mi.name
    `, [order.order_id]);
    results.push({ label: "7. Kitchen sees appended items", ok: appendedItems.rowCount === 2 && appendedItems.rows.every((row) => row.appended_at), detail: JSON.stringify(appendedItems.rows) });

    const ownerTotal = await asRole(client, "authenticated", ids.ownerUser, "select total_price from public.orders where id = $1", [order.order_id]);
    results.push({ label: "8. Owner sees updated totals", ok: ownerTotal.rowCount === 1 && Number(ownerTotal.rows[0].total_price) === 280, detail: JSON.stringify(ownerTotal.rows[0]) });

    const qr = await asRole(client, "anon", null, "select public.create_public_qr_order('cashier-pos-audit-a', '2', 'QR Guest', 'Cash', $1::jsonb) as order", [
      JSON.stringify([{ menu_item_id: ids.pizza, quantity: 1 }]),
    ]);
    results.push({ label: "9. QR ordering still works", ok: qr.rows[0].order.status === "pending_payment" && Number(qr.rows[0].order.total_price) === 150, detail: JSON.stringify(qr.rows[0].order) });

    const shiftSummary = await asRole(client, "authenticated", ids.cashierUser, "select public.get_cashier_shift_summary($1) as summary", [ids.restaurantA]);
    results.push({ label: "10. Shift management still works", ok: Boolean(shiftSummary.rows[0].summary.active_shift), detail: JSON.stringify({ active_shift: Boolean(shiftSummary.rows[0].summary.active_shift) }) });

    results.push(await expectReject(
      "11. Multi-tenant isolation still works",
      () => asRole(client, "authenticated", ids.otherCashierUser, "select public.append_items_to_order($1, $2::jsonb)", [order.order_id, JSON.stringify([{ menu_item_id: ids.otherItem, quantity: 1 }])]),
      /Only active cashiers|invalid|unavailable|Order not found/i
    ));

    results.push(await expectReject(
      "12. RLS unchanged: direct browser order insert rejected",
      () => asRole(client, "authenticated", ids.cashierUser, "insert into public.orders (restaurant_id, customer_user_id, status, total_price, table_number, payment_method, order_source) values ($1, null, 'paid', 1, '1', 'Cash', 'cashier')", [ids.restaurantA]),
      /row-level security|violates|permission denied/i
    ));

    const nPlusOneEvidence = /\.in\("order_id", orderIds\)/.test(itemPreviewSource) && !/queueOrders\.map[\s\S]*supabase\.from\("order_items"\)/.test(itemPreviewSource);
    results.push({ label: "13. No N+1 query regressions", ok: nPlusOneEvidence, detail: "cashier cards use batched order_items load and no per-card order_items query" });
  } finally {
    await cleanup(client, ids);
    await client.end();
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}: ${result.detail}`);
  console.log(`SUMMARY passed=${results.length - failed.length} failed=${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
