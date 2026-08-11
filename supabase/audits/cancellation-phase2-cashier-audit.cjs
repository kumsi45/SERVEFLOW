const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const root = path.join(__dirname, "..", "..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8")
  .split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "231_phase_cancellation_cashier_review.sql"), "utf8");
const results = [];
const check = (label, ok, detail = "") => {
  const row = { label, ok: Boolean(ok), detail };
  results.push(row);
  console.log(`${row.ok ? "PASS" : "FAIL"} ${row.label}${row.detail ? ` — ${row.detail}` : ""}`);
};
const id = () => crypto.randomUUID();

async function main() {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const created = [];
  const asUser = async (userId, sql, params = []) => {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    try {
      const output = await db.query(sql, params);
      await db.query("reset role");
      return output;
    } catch (error) {
      await db.query("reset role").catch(() => {});
      throw error;
    }
  };
  const expectReject = async (label, fn, pattern) => {
    await db.query("savepoint expected_rejection");
    try {
      await fn();
      await db.query("rollback to savepoint expected_rejection");
      check(label, false, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint expected_rejection");
      check(label, pattern.test(error.message), error.message);
    }
  };

  try {
    const base = (await db.query(`
      select restaurants.id restaurant_id,
        waiter.id waiter_id, waiter.user_id waiter_user,
        cashier_a.id cashier_a_id, cashier_a.user_id cashier_a_user,
        menu.id menu_id, menu.price,
        tables.id table_id, tables.table_number
      from public.restaurants restaurants
      cross join lateral (select * from public.restaurant_staff where restaurant_id=restaurants.id and role='waiter' and active and user_id is not null limit 1) waiter
      cross join lateral (select * from public.restaurant_staff where restaurant_id=restaurants.id and role='cashier' and active and user_id is not null order by id limit 1) cashier_a
      cross join lateral (select * from public.menu_items where restaurant_id=restaurants.id and available limit 1) menu
      cross join lateral (select * from public.restaurant_tables where restaurant_id=restaurants.id and active limit 1) tables
      limit 1
    `)).rows[0];
    if (!base) throw new Error("Audit requires a cashier, one waiter, and menu/table data.");
    const otherCashiers = (await db.query(`
      select restaurant_id,id staff_id,user_id from public.restaurant_staff
      where role='cashier' and active and user_id is not null and restaurant_id<>$1 limit 2
    `, [base.restaurant_id])).rows;
    if (otherCashiers.length < 2) throw new Error("Audit requires two other-tenant cashier identities.");
    const other = otherCashiers[0];
    const crossTenant = otherCashiers[1];
    const secondCashierId = id();

    const seed = async ({ kitchen = "held", payment = "pending", itemCount = 1, whole = false } = {}) => {
      const order = id(), invoice = id(), request = id();
      const auditTable = id();
      const auditTableNumber = 100 + created.length;
      const items = Array.from({ length: itemCount }, () => id());
      created.push({ order, invoice, request, items, auditTable });
      await db.query(`insert into public.restaurant_tables(id,restaurant_id,table_number,label,qr_path,qr_url,active)
        values($1,$2,$3,$4,$5,$6,true)`, [auditTable, base.restaurant_id, auditTableNumber, `Audit ${auditTableNumber}`, `/audit/${auditTable}`, `https://example.test/audit/${auditTable}`]);
      await db.query(`insert into public.orders
        (id,restaurant_id,status,total_price,customer_name,table_id,table_number,payment_method,order_source,created_by_waiter_id,dining_session_status,table_released_at)
        values($1,$2,'completed',$3,'Cancellation Audit',$4,$5,'Cash','cashier',$6,'open',null)`,
        [order, base.restaurant_id, Number(base.price) * itemCount, auditTable, String(auditTableNumber), base.waiter_id]);
      await db.query(`insert into public.order_invoices
        (id,restaurant_id,order_id,invoice_number,status,payment_status,total_price,subtotal,grand_total,payment_method,invoice_source,created_by_staff_id,created_by_display_name)
        values($1,$2,$3,1,$4,$5,$6,$6,$6,'Cash','cashier',$7,'Cancellation Audit Cashier')`,
        [invoice, base.restaurant_id, order, payment === "paid" ? "verified" : "pending", payment, Number(base.price) * itemCount, base.cashier_a_id]);
      for (const item of items) await db.query(`insert into public.order_items
        (id,restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status)
        values($1,$2,$3,$4,$5,1,$6,'held')`, [item, base.restaurant_id, order, invoice, base.menu_id, base.price]);
      if (kitchen !== "held") {
        await db.query("set local session_replication_role = replica");
        await db.query("update public.order_items set kitchen_status=$2, kitchen_preparation_started_at=case when $2 in ('preparing','ready','completed') then now() else null end where id=$1", [items[0], kitchen]);
        await db.query("set local session_replication_role = origin");
      }
      await db.query(`insert into public.order_cancellation_requests
        (id,restaurant_id,order_id,order_item_id,request_scope,requested_by_staff_id,requested_by_user_id,requester_role,reason,note,current_order_status,current_kitchen_status,current_payment_status,status,metadata)
        values($1,$2,$3,$4,$5,$6,$7,'waiter','Wrong item entered','Audit request','new',$8,$9,'pending_review',jsonb_build_object('requested_by_name','Audit Waiter'))`,
        [request, base.restaurant_id, order, whole ? null : items[0], whole ? "order" : "item", base.waiter_id, base.waiter_user, kitchen, payment]);
      return { order, invoice, request, items };
    };

    await db.query("begin");
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active)
      values($1,$2,$3,'cashier','Cancellation Audit Cashier B',true)`, [secondCashierId, base.restaurant_id, other.user_id]);
    const safe = await seed({ itemCount: 2 });
    const queue = (await asUser(base.cashier_a_user, "select public.get_cashier_cancellation_requests($1) payload", [base.restaurant_id])).rows[0].payload;
    const safeQueue = queue.find((row) => row.id === safe.request);
    check("Waiter request appears in cashier queue", Boolean(safeQueue));
    check("Queue preserves immutable requester identity", safeQueue.requested_by_staff_id === base.waiter_id && safeQueue.requested_by_name);
    check("Unpaid and not-started item is cashier-direct", safeQueue.authority === "cashier_direct");
    check("Pending badge source counts actionable cashier queue", queue.filter((row) => row.status === "pending_review").length >= 1);

    const direct = (await asUser(base.cashier_a_user, "select public.cashier_handle_cancellation_request($1,'direct_cancel') payload", [safe.request])).rows[0].payload;
    check("Direct cancellation resolves request without refund or table release", direct.status === "resolved" && direct.refund_created === false && direct.table_released === false);
    const safeState = (await db.query(`select r.status,r.requested_by_staff_id,r.handled_by_staff_id,r.handled_at,
      (select kitchen_status from order_items where id=$2) target_status,
      (select kitchen_status from order_items where id=$3) sibling_status,
      (select subtotal from order_invoices where id=$4) subtotal,
      (select table_released_at from orders where id=$5) table_released_at
      from order_cancellation_requests r where r.id=$1`, [safe.request, safe.items[0], safe.items[1], safe.invoice, safe.order])).rows[0];
    check("Item-level cancellation affects only the requested item", safeState.target_status === "cancelled" && safeState.sibling_status !== "cancelled");
    check("Cancelled item is excluded from recalculated totals", Number(safeState.subtotal) === Number(base.price));
    check("Cancellation does not release the dining table", safeState.table_released_at === null);
    check("Requester and cashier handler identities are both recorded", safeState.requested_by_staff_id === base.waiter_id && safeState.handled_by_staff_id === base.cashier_a_id && safeState.handled_at);
    const directAudit = (await db.query("select details from staff_activity_log where action='cancellation_cancelled_by_cashier' and details->>'request_id'=$1 order by created_at desc limit 1", [safe.request])).rows[0];
    check("Direct cancellation audit captures decision evidence", directAudit && directAudit.details.requester_staff_id === base.waiter_id && directAudit.details.cashier_staff_id === base.cashier_a_id && directAudit.details.refund_created === false);
    await expectReject("Second cashier cannot handle an already-resolved request", () => asUser(other.user_id, "select public.cashier_handle_cancellation_request($1,'direct_cancel')", [safe.request]), /already handled/i);

    const preparing = await seed({ kitchen: "preparing" });
    const ready = await seed({ kitchen: "ready" });
    const served = await seed({ kitchen: "completed" });
    const paid = await seed({ payment: "paid" });
    const riskQueue = (await asUser(base.cashier_a_user, "select public.get_cashier_cancellation_requests($1) payload", [base.restaurant_id])).rows[0].payload;
    const authority = (request) => riskQueue.find((row) => row.id === request)?.authority;
    check("Unpaid preparing request requires manager", authority(preparing.request) === "manager_approval_required");
    check("Unpaid ready request requires manager", authority(ready.request) === "manager_approval_required");
    check("Served request requires manager", authority(served.request) === "manager_approval_required");
    check("Paid not-started request requires financial approval", authority(paid.request) === "financial_approval_required");
    await expectReject("Preparing request cannot be directly cancelled", () => asUser(base.cashier_a_user, "select public.cashier_handle_cancellation_request($1,'direct_cancel')", [preparing.request]), /no longer eligible/i);
    await expectReject("Paid request cannot be directly cancelled", () => asUser(base.cashier_a_user, "select public.cashier_handle_cancellation_request($1,'direct_cancel')", [paid.request]), /no longer eligible/i);
    const escalated = (await asUser(base.cashier_a_user, "select public.cashier_handle_cancellation_request($1,'send_to_manager') payload", [preparing.request])).rows[0].payload;
    check("High-risk request persists for Phase 3 manager review", escalated.status === "manager_review_required");
    const financialEscalated = (await asUser(base.cashier_a_user, "select public.cashier_handle_cancellation_request($1,'send_to_manager') payload", [paid.request])).rows[0].payload;
    check("Paid request escalates without creating a refund", financialEscalated.status === "manager_review_required" && (await db.query("select count(*) count from order_invoices where id=$1 and payment_status='refunded'", [paid.invoice])).rows[0].count === "0");

    const whole = await seed({ itemCount: 2, whole: true });
    await db.query("set local session_replication_role = replica");
    await db.query("update order_items set kitchen_status='ready',kitchen_preparation_started_at=now() where id=$1", [whole.items[1]]);
    await db.query("set local session_replication_role = origin");
    const wholeDecision = (await db.query("select public.evaluate_cancellation_request($1) payload", [whole.request])).rows[0].payload;
    check("Whole-order eligibility fails atomically when any item is high-risk", wholeDecision.authority === "manager_approval_required" && wholeDecision.item_count === 2);
    await expectReject("Whole-order direct cancellation cannot partially succeed", () => asUser(base.cashier_a_user, "select public.cashier_handle_cancellation_request($1,'direct_cancel')", [whole.request]), /no longer eligible/i);

    const kitchenRace = await seed();
    await db.query("update order_items set kitchen_preparation_started_at=now() where id=$1", [kitchenRace.items[0]]);
    await expectReject("Kitchen-start race is revalidated and rejected", () => asUser(base.cashier_a_user, "select public.cashier_handle_cancellation_request($1,'direct_cancel')", [kitchenRace.request]), /no longer eligible/i);
    const paymentRace = await seed();
    await db.query("update order_invoices set status='verified',payment_status='paid',paid_at=now(),verified_at=now() where id=$1", [paymentRace.invoice]);
    await expectReject("Payment-state race is revalidated and rejected", () => asUser(base.cashier_a_user, "select public.cashier_handle_cancellation_request($1,'direct_cancel')", [paymentRace.request]), /no longer eligible/i);

    await expectReject("Forged restaurant id is rejected", () => asUser(base.cashier_a_user, "select public.get_cashier_cancellation_requests($1)", [other.restaurant_id]), /active cashier/i);
    await expectReject("Cross-tenant cashier cannot handle request by id", () => asUser(crossTenant.user_id, "select public.cashier_handle_cancellation_request($1,'send_to_manager')", [ready.request]), /active cashier/i);
    await expectReject("Requester identity cannot be overwritten", () => db.query("update order_cancellation_requests set requested_by_staff_id=$2 where id=$1", [ready.request, base.cashier_a_id]), /origin is immutable/i);
    const rlsRows = await asUser(crossTenant.user_id, "select id from order_cancellation_requests where id=$1", [ready.request]);
    check("RLS hides cancellation requests from other tenants", rlsRows.rowCount === 0);

    const publication = await db.query("select count(*) count from pg_publication_tables where pubname='supabase_realtime' and tablename=any($1)", [["order_cancellation_requests", "order_items", "order_invoices"]]);
    check("Cancellation, kitchen item, and invoice changes use existing realtime publication", publication.rows[0].count === "3");
    check("Migration contains no refund or table-release call", !/perform\s+public\.(refund|try_auto_release)/i.test(migration));
    const phase1Function = await db.query("select to_regprocedure('public.request_waiter_cancellation(uuid,uuid,text,text)') function_name");
    check("Phase 1 waiter request RPC remains installed", Boolean(phase1Function.rows[0].function_name));

    await db.query("rollback");
  } catch (error) {
    await db.query("reset role").catch(() => {});
    await db.query("set session_replication_role = origin").catch(() => {});
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }

  const passed = results.filter((row) => row.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exit(1);
}

main().catch((error) => {
  console.error(`FAIL audit crashed — ${error.message}${error.where ? ` — ${error.where}` : ""}`);
  process.exit(1);
});
