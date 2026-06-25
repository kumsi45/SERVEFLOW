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
  const hex = crypto.createHash("sha256").update(`serveflow-shift-audit-${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function asUser(client, userId, sql, params = []) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
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

async function roleExists(client, role) {
  const result = await client.query(
    "select exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'restaurant_staff_role' and e.enumlabel = $1) as exists",
    [role]
  );
  return Boolean(result.rows[0]?.exists);
}

async function cleanup(client, ids) {
  const legacyAuditId = "73657276-6566-6c6f-772d-73686966742d";
  await client.query("alter table public.cash_reconciliations disable trigger cash_reconciliations_immutable_delete").catch(() => {});
  try {
    for (const table of ["shift_activity_logs", "cash_reconciliations", "cashier_shifts", "orders", "restaurant_staff", "restaurant_tables"]) {
      await client.query(`delete from public.${table} where restaurant_id in ($1, $2)`, [ids.restaurantA, ids.restaurantB]).catch(() => {});
      await client.query(`delete from public.${table} where restaurant_id = $1`, [legacyAuditId]).catch(() => {});
    }
  } finally {
    await client.query("alter table public.cash_reconciliations enable trigger cash_reconciliations_immutable_delete").catch(() => {});
  }
  await client.query("delete from public.restaurants where id in ($1, $2)", [ids.restaurantA, ids.restaurantB]).catch(() => {});
  await client.query("delete from public.restaurants where id = $1", [legacyAuditId]).catch(() => {});
  await client.query("delete from auth.users where id in ($1, $2, $3, $4, $5)", [
    ids.ownerUser,
    ids.managerUser,
    ids.cashierAUser,
    ids.cashierBUser,
    ids.otherOwnerUser,
  ]).catch(() => {});
  await client.query("delete from auth.users where id = $1", [legacyAuditId]).catch(() => {});
}

async function countAuditResidue(client, ids) {
  const legacyAuditId = "73657276-6566-6c6f-772d-73686966742d";
  const result = await client.query(
    `
      with audit_restaurants(id) as (
        values ($1::uuid), ($2::uuid), ($3::uuid)
      ),
      audit_users(id) as (
        values ($4::uuid), ($5::uuid), ($6::uuid), ($7::uuid), ($8::uuid), ($3::uuid)
      )
      select
        (select count(*) from public.shift_activity_logs where restaurant_id in (select id from audit_restaurants)) as shift_activity_logs,
        (select count(*) from public.cash_reconciliations where restaurant_id in (select id from audit_restaurants)) as cash_reconciliations,
        (select count(*) from public.cashier_shifts where restaurant_id in (select id from audit_restaurants)) as cashier_shifts,
        (select count(*) from public.orders where restaurant_id in (select id from audit_restaurants)) as orders,
        (select count(*) from public.restaurant_staff where restaurant_id in (select id from audit_restaurants)) as restaurant_staff,
        (select count(*) from public.restaurant_tables where restaurant_id in (select id from audit_restaurants)) as restaurant_tables,
        (select count(*) from public.restaurants where id in (select id from audit_restaurants) or slug in ('shift-audit-a', 'shift-audit-b')) as restaurants,
        (select count(*) from auth.users where id in (select id from audit_users) or email like 'shift-audit-%@example.test') as users
    `,
    [
      ids.restaurantA,
      ids.restaurantB,
      legacyAuditId,
      ids.ownerUser,
      ids.managerUser,
      ids.cashierAUser,
      ids.cashierBUser,
      ids.otherOwnerUser,
    ]
  );
  return result.rows[0];
}

async function main() {
  const connectionString = readConnectionUrl();
  const ssl = { rejectUnauthorized: false };
  const client = new Client({ connectionString, ssl });
  await client.connect();

  const ids = {
    ownerUser: uuid("owner-user"),
    managerUser: uuid("manager-user"),
    cashierAUser: uuid("cashier-a-user"),
    cashierBUser: uuid("cashier-b-user"),
    otherOwnerUser: uuid("other-owner-user"),
    restaurantA: uuid("restaurant-a"),
    restaurantB: uuid("restaurant-b"),
    ownerStaff: uuid("owner-staff"),
    managerStaff: uuid("manager-staff"),
    cashierAStaff: uuid("cashier-a-staff"),
    cashierBStaff: uuid("cashier-b-staff"),
    otherOwnerStaff: uuid("other-owner-staff"),
    unpaidOrder: uuid("unpaid-order"),
    activeOrder: uuid("active-order"),
    paidOrder: uuid("paid-order"),
  };

  const results = [];
  const warnings = [];
  const skipped = [];

  try {
    await client.query(fs.readFileSync(path.join(__dirname, "migrations", "029_cashier_shift_management.sql"), "utf8"));

    await cleanup(client, ids);
    const hasManagerRole = await roleExists(client, "manager");
    if (!hasManagerRole) skipped.push("manager role visibility check: manager enum value is not present in this schema");

    for (const [id, email] of [
      [ids.ownerUser, "shift-audit-owner@example.test"],
      [ids.managerUser, "shift-audit-manager@example.test"],
      [ids.cashierAUser, "shift-audit-cashier-a@example.test"],
      [ids.cashierBUser, "shift-audit-cashier-b@example.test"],
      [ids.otherOwnerUser, "shift-audit-other-owner@example.test"],
    ]) {
      await client.query(`
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
        values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())
        on conflict (id) do update set email = excluded.email, updated_at = now()
      `, [id, email]);
    }

    await client.query(`
      insert into public.restaurants (id, name, slug, security_settings)
      values
        ($1, 'Shift Audit A', 'shift-audit-a', '{"cash_variance_reason_threshold": 0}'::jsonb),
        ($2, 'Shift Audit B', 'shift-audit-b', '{}'::jsonb)
      on conflict (id) do update set name = excluded.name, slug = excluded.slug, security_settings = excluded.security_settings
    `, [ids.restaurantA, ids.restaurantB]);

    await client.query(`
      insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, active)
      values
        ($3, $1, $6, 'owner', 'Audit Owner', true),
        ($4, $1, $7, 'cashier', 'Audit Cashier A', true),
        ($5, $1, $8, 'cashier', 'Audit Cashier B', true),
        ($9, $2, $10, 'owner', 'Other Owner', true)
      on conflict (id) do update set user_id = excluded.user_id, role = excluded.role, display_name = excluded.display_name, active = excluded.active
    `, [
      ids.restaurantA,
      ids.restaurantB,
      ids.ownerStaff,
      ids.cashierAStaff,
      ids.cashierBStaff,
      ids.ownerUser,
      ids.cashierAUser,
      ids.cashierBUser,
      ids.otherOwnerStaff,
      ids.otherOwnerUser,
    ]);

    await client.query(`
      insert into public.restaurant_tables (restaurant_id, table_number, label, qr_path, active)
      values ($1, 1, 'Table 1', '/r/shift-audit-a/order?table=1', true)
      on conflict (restaurant_id, table_number) do update set label = excluded.label, qr_path = excluded.qr_path, active = excluded.active
    `, [ids.restaurantA]);

    if (hasManagerRole) {
      await client.query(
        "insert into public.restaurant_staff (id, restaurant_id, user_id, role, display_name, active) values ($1, $2, $3, 'manager', 'Audit Manager', true) on conflict (id) do update set user_id = excluded.user_id, role = excluded.role, display_name = excluded.display_name, active = excluded.active",
        [ids.managerStaff, ids.restaurantA, ids.managerUser]
      );
    }

    const raceA = new Client({ connectionString, ssl });
    const raceB = new Client({ connectionString, ssl });
    await raceA.connect();
    await raceB.connect();
    const race = await Promise.allSettled([
      asUser(raceA, ids.cashierAUser, "select id from public.open_cashier_shift($1, 100, 'race a')", [ids.restaurantA]),
      asUser(raceB, ids.cashierAUser, "select id from public.open_cashier_shift($1, 100, 'race b')", [ids.restaurantA]),
    ]);
    await raceA.end();
    await raceB.end();
    results.push({
      label: "concurrent open permits exactly one active shift",
      ok: race.filter((item) => item.status === "fulfilled").length === 1 && race.filter((item) => item.status === "rejected").length === 1,
      detail: race.map((item) => item.status === "fulfilled" ? "opened" : item.reason.message).join(" | "),
    });

    const activeShiftId = (await client.query(
      "select id from public.cashier_shifts where restaurant_id = $1 and opened_by = $2 and closed_at is null",
      [ids.restaurantA, ids.cashierAStaff]
    )).rows[0].id;

    results.push(await expectReject(
      "cashier B cannot close cashier A shift",
      () => asUser(client, ids.cashierBUser, "select public.close_cashier_shift($1, 100, null)", [activeShiftId]),
      /Only the cashier who opened this shift may close it/
    ));

    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, created_at)
      values ($1, $2, null, 'pending_payment', 25, 'Audit Guest', '1', 'Cash', 'public_qr', now())
    `, [ids.unpaidOrder, ids.restaurantA]);
    results.push(await expectReject(
      "shift close blocks unpaid orders",
      () => asUser(client, ids.cashierAUser, "select public.close_cashier_shift($1, 100, null)", [activeShiftId]),
      /unpaid order/
    ));

    await client.query(`
      update public.orders
      set status = 'paid', payment_verified_at = now(), payment_verified_by = $2
      where id = $1
    `, [ids.unpaidOrder, ids.cashierAStaff]);
    results.push(await expectReject(
      "shift close blocks active paid orders",
      () => asUser(client, ids.cashierAUser, "select public.close_cashier_shift($1, 125, null)", [activeShiftId]),
      /active order/
    ));

    await client.query("update public.orders set status = 'completed', completed_at = now(), completed_by = $2 where id = $1", [ids.unpaidOrder, ids.cashierAStaff]);
    results.push(await expectReject(
      "non-zero variance requires reason",
      () => asUser(client, ids.cashierAUser, "select public.close_cashier_shift($1, 130, null)", [activeShiftId]),
      /Variance explanation is required/
    ));

    await asUser(client, ids.cashierAUser, "select public.close_cashier_shift($1, 130, 'Audit variance reason')", [activeShiftId]);
    const reconciliation = (await client.query("select expected_cash, actual_cash, variance, variance_reason from public.cash_reconciliations where shift_id = $1", [activeShiftId])).rows[0];
    results.push({
      label: "expected cash and variance are server-side and permanent",
      ok: Number(reconciliation.expected_cash) === 125 && Number(reconciliation.actual_cash) === 130 && Number(reconciliation.variance) === 5 && reconciliation.variance_reason === "Audit variance reason",
      detail: JSON.stringify(reconciliation),
    });

    results.push(await expectReject(
      "browser role cannot modify reconciliation",
      () => asUser(client, ids.cashierAUser, "update public.cash_reconciliations set expected_cash = 0 where shift_id = $1", [activeShiftId]),
      /permission denied|immutable|violates row-level security/i
    ));
    results.push(await expectReject(
      "browser role cannot override expected cash by inserting reconciliation",
      () => asUser(client, ids.cashierAUser, `
        insert into public.cash_reconciliations (restaurant_id, shift_id, closed_by, opening_cash, cash_payments, expected_cash, actual_cash, variance)
        values ($1, $2, $3, 0, 0, 0, 0, 0)
      `, [ids.restaurantA, activeShiftId, ids.cashierAStaff]),
      /permission denied|violates row-level security/i
    ));
    results.push(await expectReject(
      "cashier cannot modify own closed shift record",
      () => asUser(client, ids.cashierAUser, "update public.cashier_shifts set expected_cash = 0 where id = $1", [activeShiftId]),
      /permission denied|violates row-level security/i
    ));
    results.push(await expectReject(
      "owner cannot alter historical reconciliation",
      () => asUser(client, ids.ownerUser, "update public.cash_reconciliations set actual_cash = actual_cash where shift_id = $1", [activeShiftId]),
      /permission denied|immutable|violates row-level security/i
    ));
    results.push(await expectReject(
      "owner cannot alter historical shift logs",
      () => asUser(client, ids.ownerUser, "update public.shift_activity_logs set message = message where restaurant_id = $1", [ids.restaurantA]),
      /permission denied|violates row-level security/i
    ));

    const cashierBReconciliationRows = await asUser(client, ids.cashierBUser, "select id from public.cash_reconciliations where restaurant_id = $1", [ids.restaurantA]);
    results.push({
      label: "cashier B cannot view cashier A reconciliation details",
      ok: cashierBReconciliationRows.rowCount === 0,
      detail: `${cashierBReconciliationRows.rowCount} rows`,
    });

    await asUser(client, ids.cashierBUser, "select id from public.open_cashier_shift($1, 10, 'owner visibility')", [ids.restaurantA]);
    const cashierBShiftId = (await client.query(
      "select id from public.cashier_shifts where restaurant_id = $1 and opened_by = $2 and closed_at is null",
      [ids.restaurantA, ids.cashierBStaff]
    )).rows[0].id;
    const ownerActiveDuringB = await asUser(client, ids.ownerUser, "select id from public.cashier_shifts where restaurant_id = $1 and closed_at is null", [ids.restaurantA]);
    results.push({ label: "active shifts appear for owner while open", ok: ownerActiveDuringB.rowCount === 1, detail: `${ownerActiveDuringB.rowCount} active rows` });
    await client.query(`
      insert into public.orders (id, restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source, payment_verified_at, payment_verified_by, created_at)
      values ($1, $2, null, 'preparing', 15, 'Audit Guest Prep', '1', 'Cash', 'public_qr', now(), $3, now())
    `, [ids.activeOrder, ids.restaurantA, ids.cashierBStaff]);
    results.push(await expectReject(
      "shift close blocks kitchen preparation orders",
      () => asUser(client, ids.cashierBUser, "select public.close_cashier_shift($1, 25, null)", [cashierBShiftId]),
      /active order/
    ));
    await client.query("update public.orders set status = 'completed', completed_at = now(), completed_by = $2 where id = $1", [ids.activeOrder, ids.cashierBStaff]);
    await asUser(client, ids.cashierBUser, "select public.close_cashier_shift($1, 25, null)", [cashierBShiftId]);
    results.push({
      label: "shift close succeeds when orders are completed and paid",
      ok: true,
      detail: "completed paid cash order closed with zero variance",
    });

    const ownerRows = await asUser(client, ids.ownerUser, "select id from public.cashier_shifts where restaurant_id = $1 and closed_at is null", [ids.restaurantA]);
    const managerRows = hasManagerRole
      ? await asUser(client, ids.managerUser, "select id from public.cashier_shifts where restaurant_id = $1", [ids.restaurantA])
      : null;
    const cashierRows = await asUser(client, ids.cashierAUser, "select id from public.cashier_shifts where restaurant_id = $1", [ids.restaurantA]);
    const otherRows = await asUser(client, ids.otherOwnerUser, "select id from public.cashier_shifts where restaurant_id = $1", [ids.restaurantA]);
    const ownerReconciliationRows = await asUser(client, ids.ownerUser, "select id from public.cash_reconciliations where restaurant_id = $1", [ids.restaurantA]);
    results.push({ label: "owner can view restaurant active shifts", ok: ownerRows.rowCount === 0, detail: `${ownerRows.rowCount} active rows after operational close` });
    results.push({ label: "owner can view all restaurant reconciliations", ok: ownerReconciliationRows.rowCount === 2, detail: `${ownerReconciliationRows.rowCount} rows` });
    results.push({
      label: "manager role support",
      ok: !hasManagerRole || managerRows.rowCount >= 2,
      detail: hasManagerRole ? `${managerRows.rowCount} rows` : "manager role is not present; no manager UI or permissions added",
    });
    results.push({ label: "cashier sees only own shift records", ok: cashierRows.rowCount === 1, detail: `${cashierRows.rowCount} rows` });
    results.push({ label: "cross-restaurant owner cannot view isolated shifts", ok: otherRows.rowCount === 0, detail: `${otherRows.rowCount} rows` });

    const ownerShiftVisibility = await asUser(client, ids.ownerUser, "select public.get_owner_shift_visibility($1) as report", [ids.restaurantA]);
    const report = ownerShiftVisibility.rows[0].report;
    results.push({
      label: "owner shift visibility RPC includes active, history, and variances",
      ok: report.active_shifts.length === 0 && report.shift_history.length >= 2 && report.cash_variances.length >= 1,
      detail: JSON.stringify({ active: report.active_shifts.length, history: report.shift_history.length, variances: report.cash_variances.length }),
    });

    const logRows = await client.query("select action from public.shift_activity_logs where restaurant_id = $1 order by created_at", [ids.restaurantA]);
    const actions = logRows.rows.map((row) => row.action);
    results.push({
      label: "shift logs recorded open, payment/order, and close events",
      ok: actions.includes("shift_opened") && actions.includes("payment_verified") && actions.includes("shift_closed"),
      detail: actions.join(", "),
    });

    const metadata = await client.query(`
      select
        (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('cashier_shifts', 'cash_reconciliations', 'shift_activity_logs')) as table_count,
        (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('cashier_shifts_one_active_per_staff', 'cashier_shifts_restaurant_opened_idx', 'cashier_shifts_restaurant_active_idx', 'cash_reconciliations_restaurant_closed_idx', 'shift_activity_logs_restaurant_created_idx', 'shift_activity_logs_shift_created_idx')) as index_count,
        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('get_cashier_shift_summary', 'open_cashier_shift', 'close_cashier_shift', 'get_owner_shift_visibility', 'log_shift_order_activity', 'has_shift_admin_role')) as function_count,
        (select count(*) from pg_policies where schemaname = 'public' and tablename in ('cashier_shifts', 'cash_reconciliations', 'shift_activity_logs')) as policy_count,
        (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and table_name in ('cashier_shifts', 'cash_reconciliations', 'shift_activity_logs') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) as authenticated_write_grants,
        (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' and table_name in ('cashier_shifts', 'cash_reconciliations', 'shift_activity_logs') and privilege_type <> 'SELECT') as authenticated_non_select_grants,
        (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and table_name in ('cashier_shifts', 'cash_reconciliations', 'shift_activity_logs')) as anon_grants
    `);
    const meta = metadata.rows[0];
    results.push({ label: "shift tables exist", ok: Number(meta.table_count) === 3, detail: `${meta.table_count}/3 tables` });
    results.push({ label: "shift indexes exist", ok: Number(meta.index_count) === 6, detail: `${meta.index_count}/6 indexes` });
    results.push({ label: "shift RPCs and trigger functions exist", ok: Number(meta.function_count) >= 6, detail: `${meta.function_count} functions` });
    results.push({ label: "RLS policies exist for every shift table", ok: Number(meta.policy_count) >= 3, detail: `${meta.policy_count} policies` });
    results.push({ label: "authenticated role has no direct write grants on shift tables", ok: Number(meta.authenticated_write_grants) === 0, detail: `${meta.authenticated_write_grants} write grants` });
    results.push({ label: "shift table grants are authenticated read-only and no anon access", ok: Number(meta.authenticated_non_select_grants) === 0 && Number(meta.anon_grants) === 0, detail: `authenticated_non_select=${meta.authenticated_non_select_grants}, anon=${meta.anon_grants}` });

    await asUser(client, ids.cashierAUser, "select public.get_cashier_shift_summary($1)", [ids.restaurantA]);
    await asUser(client, ids.ownerUser, "select public.get_owner_shift_visibility($1)", [ids.restaurantA]);
    results.push({ label: "schema cache recognizes shift RPC calls", ok: true, detail: "RPC calls executed successfully" });
  } finally {
    await cleanup(client, ids);
    const residue = await countAuditResidue(client, ids);
    const residueTotal = Object.values(residue).reduce((sum, value) => sum + Number(value), 0);
    results.push({
      label: "audit cleanup leaves no test residue",
      ok: residueTotal === 0,
      detail: JSON.stringify(residue),
    });
    await client.end();
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}: ${result.detail}`);
  }
  console.log(`SUMMARY passed=${results.length - failed.length} failed=${failed.length} warnings=${warnings.length} skipped=${skipped.length}`);
  for (const warning of warnings) console.log(`WARN ${warning}`);
  for (const skip of skipped) console.log(`SKIP ${skip}`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
