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
  const hex = crypto.createHash("sha256").update(`serveflow-owner-production-bug-audit-${label}`).digest("hex").slice(0, 32);
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
  const restaurants = [ids.menuRestaurant, ids.reportRestaurant, ids.otherRestaurant];
  await client.query("delete from public.staff_activity_log where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.shift_activity_logs where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.order_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.orders where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cash_reconciliations where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.cashier_shifts where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.menu_items where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.categories where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_tables where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurant_staff where restaurant_id = any($1::uuid[])", [restaurants]).catch(() => {});
  await client.query("delete from public.restaurants where id = any($1::uuid[]) or slug in ('owner-bug-menu-audit','owner-bug-report-audit','owner-bug-other-audit')", [restaurants]).catch(() => {});
  await client.query("delete from auth.users where email like 'owner-bug-%@example.test'").catch(() => {});
}

function rangeToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

function rangeWeek() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return [start.toISOString(), end.toISOString()];
}

function rangeMonth() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(1);
  const end = new Date(start);
  end.setMonth(start.getMonth() + 1, 1);
  return [start.toISOString(), end.toISOString()];
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

async function main() {
  const ids = {
    ownerUser: uuid("owner-user"),
    otherOwnerUser: uuid("other-owner-user"),
    cashierUser: uuid("cashier-user"),
    customerUser: uuid("customer-user"),
    menuRestaurant: uuid("menu-restaurant"),
    reportRestaurant: uuid("report-restaurant"),
    otherRestaurant: uuid("other-restaurant"),
    ownerStaff: uuid("owner-staff"),
    reportOwnerStaff: uuid("report-owner-staff"),
    otherOwnerStaff: uuid("other-owner-staff"),
    cashierStaff: uuid("cashier-staff"),
    menuCategory: uuid("menu-category"),
    reportCategory: uuid("report-category"),
    otherCategory: uuid("other-category"),
    unusedItem: uuid("unused-item"),
    archivedItem: uuid("archived-item"),
    activeItem: uuid("active-item"),
    reportItem: uuid("report-item"),
    otherItem: uuid("other-item"),
    historyOrder: uuid("history-order"),
    todayOrder: uuid("today-order"),
    weekOrder: uuid("week-order"),
    monthOrder: uuid("month-order"),
    pendingOrder: uuid("pending-order"),
    outsideOrder: uuid("outside-order"),
  };

  const results = [];
  const client = new Client({ connectionString: readConnectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "032_owner_menu_delete_and_revenue_filters.sql"), "utf8"));
    await cleanup(client, ids);

    for (const [id, email] of [
      [ids.ownerUser, "owner-bug-owner@example.test"],
      [ids.otherOwnerUser, "owner-bug-other-owner@example.test"],
      [ids.cashierUser, "owner-bug-cashier@example.test"],
      [ids.customerUser, "owner-bug-customer@example.test"],
    ]) {
      await client.query(`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
      `, [id, email]);
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, total_tables)
      values
        ($1, 'Owner Bug Menu Audit', 'owner-bug-menu-audit', 4),
        ($2, 'Owner Bug Report Audit', 'owner-bug-report-audit', 4),
        ($3, 'Owner Bug Other Audit', 'owner-bug-other-audit', 4)
    `, [ids.menuRestaurant, ids.reportRestaurant, ids.otherRestaurant]);
    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, email, active)
      values
        ($1, $4, $7, 'owner', 'Audit Owner', 'owner-bug-owner@example.test', true),
        ($10, $5, $7, 'owner', 'Audit Owner', 'owner-bug-owner@example.test', true),
        ($2, $6, $8, 'owner', 'Other Owner', 'owner-bug-other-owner@example.test', true),
        ($3, $4, $9, 'cashier', 'Audit Cashier', 'owner-bug-cashier@example.test', true)
    `, [ids.ownerStaff, ids.otherOwnerStaff, ids.cashierStaff, ids.menuRestaurant, ids.reportRestaurant, ids.otherRestaurant, ids.ownerUser, ids.otherOwnerUser, ids.cashierUser, ids.reportOwnerStaff]);
    await client.query(`
      insert into public.restaurant_tables (restaurant_id, table_number, label, qr_path, active)
      values
        ($1, 1, 'Table 1', '/r/owner-bug-menu-audit/order?table=1', true),
        ($2, 1, 'Table 1', '/r/owner-bug-report-audit/order?table=1', true),
        ($3, 1, 'Table 1', '/r/owner-bug-other-audit/order?table=1', true)
      on conflict (restaurant_id, table_number) do update set active = excluded.active
    `, [ids.menuRestaurant, ids.reportRestaurant, ids.otherRestaurant]);
    await client.query("insert into public.categories (id, restaurant_id, name) values ($1, $4, 'Menu'), ($2, $5, 'Reports'), ($3, $6, 'Other')", [ids.menuCategory, ids.reportCategory, ids.otherCategory, ids.menuRestaurant, ids.reportRestaurant, ids.otherRestaurant]);
    await client.query(`
      insert into public.menu_items (id, restaurant_id, category_id, name, price, available)
      values
        ($1, $6, $7, 'Unused Delete Item', 10, true),
        ($2, $6, $7, 'Archived History Item', 123, true),
        ($3, $6, $7, 'Active Menu Item', 25, true),
        ($4, $8, $9, 'Report Item', 100, true),
        ($5, $10, $11, 'Other Tenant Item', 999, true)
    `, [ids.unusedItem, ids.archivedItem, ids.activeItem, ids.reportItem, ids.otherItem, ids.menuRestaurant, ids.menuCategory, ids.reportRestaurant, ids.reportCategory, ids.otherRestaurant, ids.otherCategory]);

    await client.query(`
      insert into public.orders (
        id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method,
        order_source, payment_verified_at, payment_verified_by, completed_at, completed_by, created_at
      )
      values ($1, $2, null, 'completed', 123, 'History Guest', '1', 'Cash', 'cashier', now(), $3, now(), $3, now())
    `, [ids.historyOrder, ids.menuRestaurant, ids.ownerStaff]);
    await client.query("insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price) values ($1, $2, $3, 1, 123)", [ids.menuRestaurant, ids.historyOrder, ids.archivedItem]);

    const deleted = await asRole(client, "authenticated", ids.ownerUser, "select public.archive_or_delete_menu_item($1, $2) as result", [ids.menuRestaurant, ids.unusedItem]);
    const deletedExists = await client.query("select 1 from public.menu_items where id = $1", [ids.unusedItem]);
    results.push({ label: "MENU delete unused menu item", ok: deleted.rows[0].result.action === "deleted" && deletedExists.rowCount === 0, detail: JSON.stringify(deleted.rows[0].result) });

    const archived = await asRole(client, "authenticated", ids.ownerUser, "select public.archive_or_delete_menu_item($1, $2) as result", [ids.menuRestaurant, ids.archivedItem]);
    const archivedRow = await client.query("select available, archived_at from public.menu_items where id = $1", [ids.archivedItem]);
    results.push({ label: "MENU archive item with order history", ok: archived.rows[0].result.action === "archived" && archivedRow.rowCount === 1 && archivedRow.rows[0].available === false && Boolean(archivedRow.rows[0].archived_at), detail: JSON.stringify({ result: archived.rows[0].result, row: archivedRow.rows[0] }) });

    const qrMenu = await asRole(client, "anon", null, "select public.get_public_qr_menu('owner-bug-menu-audit') as menu");
    const qrItems = qrMenu.rows[0].menu.items;
    results.push({ label: "MENU archived item disappears from QR menu/search source", ok: qrItems.every((item) => item.id !== ids.archivedItem) && qrItems.some((item) => item.id === ids.activeItem), detail: JSON.stringify(qrItems) });

    const activeOwnerItems = await asRole(client, "authenticated", ids.ownerUser, "select id from public.menu_items where restaurant_id = $1 and archived_at is null order by name", [ids.menuRestaurant]);
    results.push({ label: "MENU archived item disappears from Menu Management active list", ok: activeOwnerItems.rows.every((row) => row.id !== ids.archivedItem), detail: JSON.stringify(activeOwnerItems.rows) });

    results.push(await expectReject(
      "MENU archived item cannot be ordered by Public QR",
      () => asRole(client, "anon", null, "select public.create_public_qr_order('owner-bug-menu-audit', '1', 'QR Guest', 'Cash', $1::jsonb)", [JSON.stringify([{ menu_item_id: ids.archivedItem, quantity: 1 }])]),
      /invalid|unavailable|not found/i
    ));

    results.push(await expectReject(
      "MENU archived item cannot be ordered by Cashier POS",
      () => asRole(client, "authenticated", ids.cashierUser, "select public.create_cashier_order($1, '1', 'Cash', $2::jsonb)", [ids.menuRestaurant, JSON.stringify([{ menu_item_id: ids.archivedItem, quantity: 1 }])]),
      /invalid|unavailable|not found/i
    ));

    results.push(await expectReject(
      "MENU archived item cannot be ordered by Waiter POS",
      () => asRole(client, "authenticated", ids.customerUser, "select public.create_customer_order('owner-bug-menu-audit', $1::jsonb)", [JSON.stringify([{ menu_item_id: ids.archivedItem, quantity: 1 }])]),
      /unavailable|not found/i
    ));

    const history = await asRole(client, "authenticated", ids.ownerUser, `
      select mi.name, oi.quantity, oi.price
      from public.order_items oi
      join public.menu_items mi on mi.id = oi.menu_item_id and mi.restaurant_id = oi.restaurant_id
      where oi.order_id = $1
    `, [ids.historyOrder]);
    results.push({ label: "MENU historical orders/receipts keep item names", ok: history.rowCount === 1 && history.rows[0].name === "Archived History Item" && Number(history.rows[0].price) === 123, detail: JSON.stringify(history.rows[0]) });

    await client.query(`
      insert into public.orders (
        id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method,
        order_source, payment_verified_at, payment_verified_by, completed_at, completed_by, created_at
      )
      values
        ($1, $7, null, 'completed', 100, 'Today Guest', '1', 'Cash', 'cashier', $9, $13, $9, $13, $9),
        ($2, $7, null, 'paid', 200, 'Week Guest', '1', 'Cash', 'cashier', $10, $13, null, null, $10),
        ($3, $7, null, 'preparing', 300, 'Month Guest', '1', 'Cash', 'cashier', null, null, null, null, $11),
        ($4, $7, null, 'pending_payment', 999, 'Pending Guest', '1', 'Cash', 'public_qr', null, null, null, null, $9),
        ($5, $7, null, 'completed', 400, 'Outside Guest', '1', 'Cash', 'cashier', $12, $13, $12, $13, $12),
        ($6, $8, null, 'completed', 9999, 'Other Guest', '1', 'Cash', 'cashier', $9, $14, $9, $14, $9)
    `, [ids.todayOrder, ids.weekOrder, ids.monthOrder, ids.pendingOrder, ids.outsideOrder, uuid("other-report-order"), ids.reportRestaurant, ids.otherRestaurant, daysAgo(0), daysAgo(2), daysAgo(10), daysAgo(45), ids.reportOwnerStaff, ids.otherOwnerStaff]);
    for (const [orderId, quantity, price] of [
      [ids.todayOrder, 1, 100],
      [ids.weekOrder, 2, 100],
      [ids.monthOrder, 3, 100],
      [ids.pendingOrder, 1, 999],
      [ids.outsideOrder, 4, 100],
    ]) {
      await client.query("insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price) values ($1, $2, $3, $4, $5)", [ids.reportRestaurant, orderId, ids.reportItem, quantity, price]);
    }

    const [todayStart, todayEnd] = rangeToday();
    const [weekStart, weekEnd] = rangeWeek();
    const [monthStart, monthEnd] = rangeMonth();
    const todayReport = await asRole(client, "authenticated", ids.ownerUser, "select public.get_owner_reporting_center($1, $2, $3) as report", [ids.reportRestaurant, todayStart, todayEnd]);
    const weekReport = await asRole(client, "authenticated", ids.ownerUser, "select public.get_owner_reporting_center($1, $2, $3) as report", [ids.reportRestaurant, weekStart, weekEnd]);
    const monthReport = await asRole(client, "authenticated", ids.ownerUser, "select public.get_owner_reporting_center($1, $2, $3) as report", [ids.reportRestaurant, monthStart, monthEnd]);
    const todaySummary = todayReport.rows[0].report.summary;
    const weekSummary = weekReport.rows[0].report.summary;
    const monthSummary = monthReport.rows[0].report.summary;

    results.push({ label: "REPORTS today revenue/counts/average", ok: Number(todaySummary.revenue) === 100 && Number(todaySummary.orders) === 2 && Number(todaySummary.average_order_value) === 100, detail: JSON.stringify(todaySummary) });
    results.push({ label: "REPORTS week revenue/counts/average", ok: Number(weekSummary.revenue) === 300 && Number(weekSummary.orders) === 3 && Number(weekSummary.average_order_value) === 150, detail: JSON.stringify(weekSummary) });
    results.push({ label: "REPORTS month revenue/counts/average", ok: Number(monthSummary.revenue) === 600 && Number(monthSummary.orders) === 4 && Number(monthSummary.average_order_value) === 200, detail: JSON.stringify(monthSummary) });

    const menuReport = monthReport.rows[0].report.menu_performance;
    results.push({ label: "REPORTS menu performance remains correct", ok: menuReport.some((row) => row.name === "Report Item" && Number(row.quantity) === 6 && Number(row.revenue) === 600), detail: JSON.stringify(menuReport) });

    results.push(await expectReject(
      "REPORTS multi-tenant owner isolation",
      () => asRole(client, "authenticated", ids.otherOwnerUser, "select public.get_owner_reporting_center($1, $2, $3)", [ids.reportRestaurant, monthStart, monthEnd]),
      /Only restaurant owners/i
    ));

    results.push(await expectReject(
      "MENU multi-tenant owner isolation",
      () => asRole(client, "authenticated", ids.otherOwnerUser, "select public.archive_or_delete_menu_item($1, $2)", [ids.menuRestaurant, ids.activeItem]),
      /Only restaurant owners/i
    ));

    results.push(await expectReject(
      "MENU cashier cannot archive menus",
      () => asRole(client, "authenticated", ids.cashierUser, "select public.archive_or_delete_menu_item($1, $2)", [ids.menuRestaurant, ids.activeItem]),
      /Only restaurant owners/i
    ));

    results.push(await expectReject(
      "RPC anonymous users blocked from archive/delete",
      () => asRole(client, "anon", null, "select public.archive_or_delete_menu_item($1, $2)", [ids.menuRestaurant, ids.activeItem]),
      /permission denied|Authentication is required|Only restaurant owners/i
    ));

    results.push(await expectReject(
      "RPC anonymous users blocked from owner reports",
      () => asRole(client, "anon", null, "select public.get_owner_reporting_center($1, $2, $3)", [ids.reportRestaurant, monthStart, monthEnd]),
      /permission denied|Authentication is required/i
    ));

    const rlsState = await client.query(`
      select
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as force_rls,
        has_table_privilege('anon', 'public.menu_items', 'DELETE') as anon_can_delete,
        has_function_privilege('anon', 'public.archive_or_delete_menu_item(uuid, uuid)', 'EXECUTE') as anon_can_archive,
        has_function_privilege('authenticated', 'public.archive_or_delete_menu_item(uuid, uuid)', 'EXECUTE') as authenticated_can_archive,
        has_function_privilege('authenticated', 'public.get_owner_reporting_center(uuid, timestamp with time zone, timestamp with time zone)', 'EXECUTE') as authenticated_can_report
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'menu_items'
    `);
    results.push({
      label: "RLS preserved: anon cannot directly delete menu_items",
      ok: rlsState.rowCount === 1 && rlsState.rows[0].rls_enabled === true && rlsState.rows[0].anon_can_delete === false,
      detail: JSON.stringify(rlsState.rows[0]),
    });

    results.push({
      label: "RPC authorization grants are least privilege",
      ok: rlsState.rowCount === 1
        && rlsState.rows[0].anon_can_archive === false
        && rlsState.rows[0].authenticated_can_archive === true
        && rlsState.rows[0].authenticated_can_report === true,
      detail: JSON.stringify(rlsState.rows[0]),
    });

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
