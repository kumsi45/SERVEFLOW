const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

function readEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([^#=]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((match) => [
        match[1],
        match[2].trim().replace(/^['"]|['"]$/g, ""),
      ]),
  );
}

function classifyOrder(row) {
  const hasItems = Number(row.item_count) > 0;
  const amount = Number(row.item_total ?? row.total_price ?? 0);
  const financialStatus = ["pending_payment", "paid", "preparing", "ready", "completed", "served"];

  if (["cancelled", "void", "test"].includes(String(row.status))) {
    return "D";
  }

  if (
    hasItems &&
    amount > 0 &&
    (financialStatus.includes(String(row.status)) ||
      ["served", "completed", "ready", "preparing"].includes(String(row.operational_status)) ||
      ["public_qr", "waiter", "cashier", "authenticated"].includes(String(row.order_source)))
  ) {
    return "B";
  }

  if (!hasItems || amount === 0) {
    return "A";
  }

  return "C";
}

async function asUser(db, userId, sql, params = []) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  let operationError = null;
  try {
    return await db.query(sql, params);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    await db.query("reset role").catch(() => {
      if (!operationError) throw new Error("Could not reset the database role.");
    });
  }
}

async function asAnon(db, sql, params = []) {
  await db.query("set local role anon");
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
  let operationError = null;
  try {
    return await db.query(sql, params);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    await db.query("reset role").catch(() => {
      if (!operationError) throw new Error("Could not reset the database role.");
    });
  }
}

async function expectReject(db, label, operation, checks) {
  const savepoint = `phase_b_expected_rejection_${checks.length}`;
  await db.query(`savepoint ${savepoint}`);
  try {
    await operation();
  } catch (error) {
    await db.query(`rollback to savepoint ${savepoint}`);
    await db.query(`release savepoint ${savepoint}`);
    checks.push({ label, ok: true, detail: error.message });
    return;
  }

  await db.query(`release savepoint ${savepoint}`);
  checks.push({ label, ok: false, detail: "operation unexpectedly succeeded" });
}

async function productionBaseline(db) {
  const result = await db.query(`
    select
      count(*) filter (where invoices.payment_status in ('pending', 'held'))::int as unresolved_invoices,
      coalesce(sum(coalesce(invoices.grand_total, invoices.total_price, 0)) filter (
        where invoices.payment_status in ('pending', 'held')
      ), 0)::numeric(12, 2) as unresolved_total,
      count(*) filter (
        where invoices.payment_status in ('pending', 'held')
          and orders.operational_status = 'served'
      )::int as served_unpaid,
      min(invoices.created_at) filter (
        where invoices.payment_status in ('pending', 'held')
      ) as oldest_unresolved_created_at,
      count(*) filter (
        where invoices.payment_status in ('pending', 'held')
          and invoices.created_at < now() - interval '36 hours'
      )::int as unresolved_over_36h,
      count(*) filter (
        where invoices.payment_status in ('pending', 'held')
          and orders.dining_session_status = 'open'
      )::int as open_session_unresolved,
      count(*) filter (
        where invoices.payment_status in ('pending', 'held')
          and coalesce(orders.dining_session_status, '') <> 'open'
      )::int as non_open_session_unresolved,
      count(*) filter (
        where invoices.payment_status = 'paid' and invoices.cashier_shift_id is null
      )::int as paid_null_shift,
      count(*) filter (
        where invoices.status in ('paid', 'verified') or invoices.payment_status = 'paid'
      )::int as terminal_paid_verified,
      (select count(*)::int from public.orders missing
       where not exists (
         select 1 from public.order_invoices candidate
         where candidate.restaurant_id = missing.restaurant_id
           and candidate.order_id = missing.id
       )) as orders_without_invoices
    from public.order_invoices invoices
    join public.orders orders
      on orders.restaurant_id = invoices.restaurant_id
     and orders.id = invoices.order_id
  `);
  return result.rows[0];
}

async function hostedBehaviorTest(db) {
  const checks = [];
  const check = (label, ok, detail = "") => checks.push({ label, ok, detail });
  const appEnvPath = path.join(__dirname, "..", "..", ".env.local");
  const appEnv = fs.existsSync(appEnvPath) ? readEnv(appEnvPath) : {};
  const service =
    appEnv.VITE_SUPABASE_URL && appEnv.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(appEnv.VITE_SUPABASE_URL, appEnv.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  const temporaryUsers = [];
  const createdIds = { orders: [], invoices: [], staff: [], shifts: [] };
  const auditTag = `phase-b-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let transactionStarted = false;
  let auditError = null;
  let baselineBefore = null;

  if (!service) {
    throw new Error("Hosted behavior audit requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  }

  try {
    for (const purpose of ["cashier"]) {
      const email = `${auditTag}-${purpose}@serveflow.local`;
      const created = await service.auth.admin.createUser({
        email,
        password: `PhaseB-${Date.now()}-Aa1!`,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      temporaryUsers.push({ id: created.data.user.id, email, purpose });
    }

    baselineBefore = await productionBaseline(db);
    console.log("HOSTED_BASELINE_BEFORE " + JSON.stringify(baselineBefore));
    await db.query("begin");
    transactionStarted = true;

    const base = await db.query(`
      with restaurant_candidate as (
        select restaurants.id, restaurants.slug
        from public.restaurants restaurants
        where restaurants.active = true
          and restaurants.payment_policy = 'kitchen_before_payment'
          and exists (
            select 1 from public.restaurant_staff staff
            where staff.restaurant_id = restaurants.id
              and staff.active
              and staff.role::text = 'cashier'
              and staff.user_id is not null
              and not exists (
                select 1 from public.cashier_shifts shifts
                where shifts.restaurant_id = restaurants.id
                  and shifts.opened_by = staff.id
                  and shifts.closed_at is null
              )
          )
          and exists (
            select 1 from public.restaurant_staff staff
            where staff.restaurant_id = restaurants.id
              and staff.active
              and staff.role::text = 'waiter'
              and staff.user_id is not null
          )
          and exists (
            select 1
            from public.menu_items items
            join public.restaurant_staff kitchen
              on kitchen.restaurant_id = items.restaurant_id
             and kitchen.assigned_kitchen_station_id = items.kitchen_station_id
             and kitchen.active
             and kitchen.role::text = 'kitchen'
             and kitchen.user_id is not null
            where items.restaurant_id = restaurants.id and items.available
          )
        order by restaurants.created_at desc
        limit 1
      )
      select
        restaurant_candidate.id as restaurant_id,
        restaurant_candidate.slug,
        cashier.id as cashier_staff_id,
        cashier.user_id as cashier_user_id,
        waiter.id as waiter_staff_id,
        waiter.user_id as waiter_user_id,
        kitchen.id as kitchen_staff_id,
        kitchen.user_id as kitchen_user_id,
        kitchen.assigned_kitchen_station_id as kitchen_station_id,
        qr_table.id as qr_table_id,
        qr_table.table_number as qr_table_number,
        qr_table.qr_token as qr_token,
        waiter_table.id as waiter_table_id,
        waiter_table.table_number as waiter_table_number,
        cashier_table.id as cashier_table_id,
        cashier_table.table_number as cashier_table_number,
        items.id as menu_item_id,
        items.price
      from restaurant_candidate
      join lateral (
        select staff.*
        from public.restaurant_staff staff
        where staff.restaurant_id = restaurant_candidate.id
          and staff.active
          and staff.role::text = 'cashier'
          and staff.user_id is not null
          and not exists (
            select 1 from public.cashier_shifts shifts
            where shifts.restaurant_id = restaurant_candidate.id
              and shifts.opened_by = staff.id
              and shifts.closed_at is null
          )
        order by staff.created_at desc
        limit 1
      ) cashier on true
      join lateral (
        select staff.* from public.restaurant_staff staff
        where staff.restaurant_id = restaurant_candidate.id
          and staff.active and staff.role::text = 'waiter' and staff.user_id is not null
        order by staff.created_at desc limit 1
      ) waiter on true
      join lateral (
        select staff.* from public.restaurant_staff staff
        where staff.restaurant_id = restaurant_candidate.id
          and staff.active and staff.role::text = 'kitchen'
          and staff.user_id is not null and staff.assigned_kitchen_station_id is not null
        order by staff.created_at desc limit 1
      ) kitchen on true
      join lateral (
        select tables.*
        from public.restaurant_tables tables
        where tables.restaurant_id = restaurant_candidate.id
          and tables.active
          and not exists (
            select 1 from public.orders orders
            where orders.restaurant_id = tables.restaurant_id
              and orders.table_id = tables.id
              and orders.dining_session_status = 'open'
              and orders.table_released_at is null
          )
        order by tables.table_number desc
        limit 1
      ) qr_table on true
      join lateral (
        select tables.*
        from public.restaurant_tables tables
        where tables.restaurant_id = restaurant_candidate.id
          and tables.active
          and tables.id <> qr_table.id
          and not exists (
            select 1 from public.orders orders
            where orders.restaurant_id = tables.restaurant_id
              and orders.table_id = tables.id
              and orders.dining_session_status = 'open'
              and orders.table_released_at is null
          )
        order by tables.table_number desc
        limit 1
      ) waiter_table on true
      join lateral (
        select tables.*
        from public.restaurant_tables tables
        where tables.restaurant_id = restaurant_candidate.id
          and tables.active
          and tables.id not in (qr_table.id, waiter_table.id)
          and not exists (
            select 1 from public.orders orders
            where orders.restaurant_id = tables.restaurant_id
              and orders.table_id = tables.id
              and orders.dining_session_status = 'open'
              and orders.table_released_at is null
          )
        order by tables.table_number desc
        limit 1
      ) cashier_table on true
      join lateral (
        select items.*
        from public.menu_items items
        where items.restaurant_id = restaurant_candidate.id
          and items.available
          and items.kitchen_station_id = kitchen.assigned_kitchen_station_id
        order by items.created_at desc
        limit 1
      ) items on true
    `);

    if (base.rowCount !== 1) {
      throw new Error("Hosted audit requires a kitchen-before-payment restaurant with cashier, waiter, assigned kitchen staff, routed item, and free table.");
    }

    const ids = base.rows[0];
    ids.no_shift_user_id = temporaryUsers.find((user) => user.purpose === "cashier").id;
    const other = await db.query(
      "select id, slug from public.restaurants where id <> $1 order by created_at desc limit 1",
      [ids.restaurant_id],
    );
    if (other.rowCount !== 1) {
      throw new Error("Hosted audit requires a second restaurant for cross-tenant denial.");
    }

    await db.query(
      `insert into public.users (id, restaurant_id, role)
       values ($1, $2, 'customer')
       on conflict (id) do update set restaurant_id = excluded.restaurant_id
       returning id`,
      [ids.no_shift_user_id, ids.restaurant_id],
    );

    const insertedNoShiftStaff = await db.query(
      `insert into public.restaurant_staff (restaurant_id, user_id, role, display_name, active)
       values ($1, $2, 'cashier', $3, true)
       returning id`,
      [ids.restaurant_id, ids.no_shift_user_id, auditTag],
    );
    createdIds.staff.push(insertedNoShiftStaff.rows[0].id);

    const retirementBefore = await db.query(
      `select
         (select count(*) from public.orders)::int as orders,
         (select count(*) from public.order_items)::int as items,
         (select count(*) from public.order_invoices)::int as invoices,
         (select count(*) from public.orders where dining_session_status = 'open')::int as open_sessions,
         (select to_jsonb(tables) from public.restaurant_tables tables where tables.id = $1) as table_state`,
      [ids.qr_table_id],
    );
    await expectReject(
      db,
      "Legacy generic customer RPC fails closed",
      () => asUser(
        db,
        ids.no_shift_user_id,
        "select public.create_customer_order($1, $2::jsonb)",
        [ids.slug, JSON.stringify([{ menu_item_id: ids.menu_item_id, quantity: 1 }])],
      ),
      checks,
    );
    const retirementAfter = await db.query(
      `select
         (select count(*) from public.orders)::int as orders,
         (select count(*) from public.order_items)::int as items,
         (select count(*) from public.order_invoices)::int as invoices,
         (select count(*) from public.orders where dining_session_status = 'open')::int as open_sessions,
         (select to_jsonb(tables) from public.restaurant_tables tables where tables.id = $1) as table_state`,
      [ids.qr_table_id],
    );
    check(
      "Retired generic customer RPC performs zero mutation",
      JSON.stringify(retirementAfter.rows[0]) === JSON.stringify(retirementBefore.rows[0]),
    );

    const createQrOrder = async () => {
      const result = await asAnon(
        db,
        `select public.create_public_qr_order($1, $2, $3, $4, $5, 'Cash', $6::jsonb) as payload`,
        [
          ids.slug,
          String(ids.qr_table_number),
          ids.qr_token,
          crypto.randomUUID(),
          auditTag,
          JSON.stringify([{ menu_item_id: ids.menu_item_id, quantity: 1 }]),
        ],
      );
      createdIds.orders.push(result.rows[0].payload.order_id);
      createdIds.invoices.push(result.rows[0].payload.invoice_id);
      return result.rows[0].payload;
    };

    await expectReject(
      db,
      "Invalid QR authority is denied",
      () => asAnon(
        db,
        `select public.create_public_qr_order($1, $2, $3, $4, $5, 'Cash', $6::jsonb)`,
        [ids.slug, String(ids.qr_table_number), crypto.randomUUID(), crypto.randomUUID(), auditTag,
          JSON.stringify([{ menu_item_id: ids.menu_item_id, quantity: 1 }])],
      ),
      checks,
    );

    const oldQr = await createQrOrder();
    await db.query(
      `update public.orders set created_at = now() - interval '10 days', updated_at = now() - interval '10 days'
       where id = $1`,
      [oldQr.order_id],
    );
    await db.query(
      `update public.order_invoices set created_at = now() - interval '10 days', updated_at = now() - interval '10 days'
       where id = $1`,
      [oldQr.invoice_id],
    );

    await expectReject(
      db,
      "Waiter cross-tenant order creation is denied",
      () => asUser(
        db,
        ids.waiter_user_id,
        `select public.submit_waiter_order_batch($1, $2, $3, null, $4, $5::jsonb, $6::uuid)`,
        [
          other.rows[0].slug,
          String(ids.waiter_table_number),
          auditTag,
          "Phase B cross-tenant denial audit",
          JSON.stringify([{ menu_item_id: ids.menu_item_id, quantity: 1 }]),
          crypto.randomUUID(),
        ],
      ),
      checks,
    );

    const waiterResult = await asUser(
      db,
      ids.waiter_user_id,
      `select public.submit_waiter_order_batch($1, $2, $3, null, $4, $5::jsonb, $6::uuid) as payload`,
      [
        ids.slug,
        String(ids.waiter_table_number),
        auditTag,
        "Phase B canonical served-unpaid audit",
        JSON.stringify([{ menu_item_id: ids.menu_item_id, quantity: 1 }]),
        crypto.randomUUID(),
      ],
    );
    const served = waiterResult.rows[0].payload;
    createdIds.orders.push(served.order_id);
    createdIds.invoices.push(served.invoice_id);

    const canonicalWaiterState = await db.query(
      `select orders.order_source, orders.created_by_waiter_id, orders.customer_user_id,
              orders.payment_timing, orders.workflow_policy_snapshot, orders.dining_session_status,
              invoices.payment_status, invoices.invoice_source, invoices.cashier_shift_id
       from public.orders orders join public.order_invoices invoices
         on invoices.restaurant_id = orders.restaurant_id and invoices.order_id = orders.id
       where orders.id = $1 and invoices.id = $2`,
      [served.order_id, served.invoice_id],
    );
    const waiterState = canonicalWaiterState.rows[0];
    check(
      "Deferred fixture uses authenticated waiter provenance",
      waiterState.order_source === "waiter" &&
        waiterState.created_by_waiter_id === ids.waiter_staff_id &&
        waiterState.customer_user_id === null &&
        waiterState.payment_timing === "after_meal" &&
        waiterState.workflow_policy_snapshot === "kitchen_before_payment" &&
        waiterState.payment_status === "held" &&
        waiterState.invoice_source === "waiter" &&
        waiterState.cashier_shift_id === null,
    );

    const cancellation = await asUser(
      db,
      ids.waiter_user_id,
      "select public.request_waiter_cancellation($1, null, 'Customer changed mind', $2) as payload",
      [served.order_id, auditTag],
    );
    check("Cancellation request is pending review", cancellation.rows[0].payload.status === "pending_review");

    await asUser(db, ids.kitchen_user_id, "select public.start_order_preparation($1, $2, null)", [served.order_id, ids.kitchen_station_id]);
    await asUser(db, ids.kitchen_user_id, "select public.mark_order_ready($1, $2, null)", [served.order_id, ids.kitchen_station_id]);
    await asUser(db, ids.kitchen_user_id, "select public.mark_order_completed($1, $2, null)", [served.order_id, ids.kitchen_station_id]);
    await asUser(db, ids.waiter_user_id, "select public.request_waiter_final_bill($1)", [served.order_id]);

    const customerIntegrity = await db.query(
      `select orders.order_source, orders.customer_user_id, orders.created_by_waiter_id,
              orders.table_id, orders.table_number, orders.dining_session_status,
              orders.payment_timing, invoices.payment_status, invoices.invoice_source,
              count(distinct invoices.id)::int as invoice_count,
              count(items.id)::int as item_count,
              count(items.id) filter (where items.invoice_id = invoices.id)::int as linked_item_count
       from public.orders orders
       join public.order_invoices invoices
         on invoices.restaurant_id = orders.restaurant_id and invoices.order_id = orders.id
       left join public.order_items items
         on items.restaurant_id = invoices.restaurant_id and items.order_id = invoices.order_id
       where orders.id = $1
       group by orders.id, invoices.id`,
      [oldQr.order_id],
    );
    const customerState = customerIntegrity.rows[0];
    check(
      "Supported Customer QR order is atomic and canonical",
      customerState.order_source === "public_qr" &&
        customerState.customer_user_id === null &&
        customerState.created_by_waiter_id === null &&
        customerState.table_id === ids.qr_table_id &&
        String(customerState.table_number) === String(ids.qr_table_number) &&
        customerState.dining_session_status === "open" &&
        customerState.payment_timing === "before_kitchen" &&
        customerState.payment_status === "pending" &&
        customerState.invoice_source === "public_qr" &&
        Number(customerState.invoice_count) === 1 &&
        Number(customerState.item_count) === 1 &&
        Number(customerState.linked_item_count) === 1,
    );

    const visibleNoShift = await asUser(
      db,
      ids.no_shift_user_id,
      "select value from public.get_restaurant_unresolved_obligations($1) as value",
      [ids.restaurant_id],
    );
    const visibleIds = visibleNoShift.rows.map((row) => row.value.invoice_id);
    check("A no-shift cashier can read unresolved obligations", visibleIds.includes(oldQr.invoice_id));

    await expectReject(
      db,
      "A no-shift cashier cannot settle",
      () => asUser(db, ids.no_shift_user_id, "select public.verify_dining_session_payment($1, 'Cash', null, null, null)", [oldQr.order_id]),
      checks,
    );

    const servedPayload = visibleNoShift.rows.find((row) => row.value.invoice_id === served.invoice_id)?.value;
    check("Served unpaid is visible", Boolean(servedPayload));
    check("Served unpaid is backend-classified", servedPayload?.served_unpaid === true);
    check("Bill requested does not resolve debt", servedPayload?.bill_requested === true);
    check("Cancellation request does not resolve debt", servedPayload?.pending_cancellation_request === true);
    check("Served debt remains unassigned before settlement", servedPayload?.cashier_shift_id === null);

    const servedSessionBeforeClose = await db.query(
      "select operational_status, dining_session_status, table_released_at from public.orders where id = $1",
      [served.order_id],
    );
    check(
      "Canonical kitchen flow reaches served while session stays occupied",
      servedSessionBeforeClose.rows[0].operational_status === "served" &&
        servedSessionBeforeClose.rows[0].dining_session_status === "open" &&
        servedSessionBeforeClose.rows[0].table_released_at === null,
    );

    const queue = await asUser(
      db,
      ids.no_shift_user_id,
      "select value from public.get_cashier_payment_queue($1) as value",
      [ids.restaurant_id],
    );
    const queueIds = queue.rows.map((row) => row.value.invoice_id);
    check("Unresolved invoices older than 36 hours stay in queue", queueIds.includes(oldQr.invoice_id));
    const paidHistory = await db.query(
      `select invoices.id from public.order_invoices invoices
       where invoices.restaurant_id = $1 and invoices.payment_status = 'paid'
         and invoices.created_at < now() - interval '36 hours'
       order by invoices.created_at limit 1`,
      [ids.restaurant_id],
    );
    check("Old paid fixture exists", paidHistory.rowCount === 1);
    check("Old paid invoice is excluded from unresolved projection", !visibleIds.includes(paidHistory.rows[0]?.id));

    await expectReject(
      db,
      "Cross-tenant obligation read is denied",
      () => asUser(db, ids.no_shift_user_id, "select value from public.get_restaurant_unresolved_obligations($1) as value", [other.rows[0].id]),
      checks,
    );

    await expectReject(
      db,
      "Waiter cannot read cashier obligations",
      () => asUser(db, ids.waiter_user_id, "select value from public.get_restaurant_unresolved_obligations($1) as value", [ids.restaurant_id]),
      checks,
    );
    await expectReject(
      db,
      "Kitchen cannot read cashier obligations",
      () => asUser(db, ids.kitchen_user_id, "select value from public.get_restaurant_unresolved_obligations($1) as value", [ids.restaurant_id]),
      checks,
    );

    const shiftAResult = await asUser(
      db,
      ids.cashier_user_id,
      "select id from public.open_cashier_shift($1, 0, $2)",
      [ids.restaurant_id, auditTag],
    );
    const shiftA = shiftAResult.rows[0].id;
    createdIds.shifts.push(shiftA);
    await expectReject(
      db,
      "Waiter cannot create a cashier order",
      () => asUser(
        db,
        ids.waiter_user_id,
        "select public.create_cashier_order($1, $2, 'Cash', $3::jsonb)",
        [ids.restaurant_id, String(ids.cashier_table_number), JSON.stringify([{ menu_item_id: ids.menu_item_id, quantity: 1 }])],
      ),
      checks,
    );
    await expectReject(
      db,
      "Cashier cross-tenant order creation is denied",
      () => asUser(
        db,
        ids.cashier_user_id,
        "select public.create_cashier_order($1, $2, 'Cash', $3::jsonb)",
        [other.rows[0].id, String(ids.cashier_table_number), JSON.stringify([{ menu_item_id: ids.menu_item_id, quantity: 1 }])],
      ),
      checks,
    );
    const cashierAResult = await asUser(
      db,
      ids.cashier_user_id,
      "select public.create_cashier_order($1, $2, 'Cash', $3::jsonb) as payload",
      [ids.restaurant_id, String(ids.cashier_table_number), JSON.stringify([{ menu_item_id: ids.menu_item_id, quantity: 1 }])],
    );
    const cashierAOrder = cashierAResult.rows[0].payload;
    createdIds.orders.push(cashierAOrder.order_id);
    createdIds.invoices.push(cashierAOrder.invoice_id);
    check("Supported cashier order succeeds through cashier authority", Boolean(cashierAOrder.order_id && cashierAOrder.invoice_id));
    await asUser(db, ids.cashier_user_id, "select public.verify_dining_session_payment($1, 'Cash', null, null, null)", [cashierAOrder.order_id]);
    const cashierASettlement = await db.query(
      "select payment_status, verified_by, cashier_shift_id from public.order_invoices where id = $1",
      [cashierAOrder.invoice_id],
    );
    check(
      "Cashier A settlement belongs only to A own shift",
      cashierASettlement.rows[0].payment_status === "paid" &&
        cashierASettlement.rows[0].verified_by === ids.cashier_staff_id &&
        cashierASettlement.rows[0].cashier_shift_id === shiftA,
    );
    await asUser(db, ids.kitchen_user_id, "select public.start_order_preparation($1, $2, null)", [cashierAOrder.order_id, ids.kitchen_station_id]);
    await asUser(db, ids.kitchen_user_id, "select public.mark_order_ready($1, $2, null)", [cashierAOrder.order_id, ids.kitchen_station_id]);
    await asUser(db, ids.kitchen_user_id, "select public.mark_order_completed($1, $2, null)", [cashierAOrder.order_id, ids.kitchen_station_id]);
    const cashierOrderTerminal = await db.query(
      "select dining_session_status, table_released_at from public.orders where id = $1",
      [cashierAOrder.order_id],
    );
    check(
      "Supported cashier order completes before shift close",
      cashierOrderTerminal.rows[0].dining_session_status === "closed" &&
        cashierOrderTerminal.rows[0].table_released_at !== null,
    );

    await expectReject(
      db,
      "Shift close requires unresolved acknowledgment",
      () => asUser(db, ids.cashier_user_id, "select public.close_cashier_shift($1, $2, null)", [shiftA, ids.price]),
      checks,
    );

    const beforeAck = await db.query(
      "select cashier_shift_id, payment_status from public.order_invoices where id = $1",
      [served.invoice_id],
    );
    const closePayload = await asUser(
      db,
      ids.cashier_user_id,
      "select public.close_cashier_shift($1, $2, null, true) as payload",
      [shiftA, ids.price],
    );
    check("Acknowledged shift close succeeds", closePayload.rowCount === 1);
    const afterAck = await db.query(
      "select cashier_shift_id, payment_status from public.order_invoices where id = $1",
      [served.invoice_id],
    );

    const acknowledgmentLog = await db.query(
      `select amount, metadata from public.shift_activity_logs
       where shift_id = $1 and action = 'restaurant_obligations_acknowledged'
       order by created_at desc limit 1`,
      [shiftA],
    );
    const ack = acknowledgmentLog.rows[0];
    check(
      "Shift-close acknowledgment persists restaurant-wide snapshot",
      acknowledgmentLog.rowCount === 1 &&
        Number(ack.metadata.unresolved_obligation_count) >= 2 &&
        Number(ack.metadata.served_unpaid_count) >= 1 &&
        ack.metadata.oldest_unresolved_created_at &&
        ack.metadata.acknowledged_at &&
        ack.metadata.acknowledged_by_staff_id === ids.cashier_staff_id &&
        ack.metadata.shift_id === shiftA &&
        ack.metadata.restaurant_id === ids.restaurant_id,
      acknowledgmentLog.rowCount === 1 ? JSON.stringify(ack.metadata) : "missing acknowledgment log",
    );
    check(
      "Acknowledgment does not mutate invoice ownership",
      beforeAck.rows[0].cashier_shift_id === afterAck.rows[0].cashier_shift_id &&
        beforeAck.rows[0].payment_status === afterAck.rows[0].payment_status,
    );

    const tableAfterAck = await db.query(
      "select table_released_at from public.orders where id = $1",
      [served.order_id],
    );
    check("Acknowledgment does not release table/session", tableAfterAck.rows[0].table_released_at === null);

    const stillVisible = await asUser(
      db,
      ids.no_shift_user_id,
      "select value from public.get_restaurant_unresolved_obligations($1) as value",
      [ids.restaurant_id],
    );
    check(
      "Shift transition leaves obligation visible",
      stillVisible.rows.some((row) => row.value.invoice_id === served.invoice_id),
    );

    const shiftBResult = await asUser(
      db,
      ids.no_shift_user_id,
      "select id from public.open_cashier_shift($1, 0, $2)",
      [ids.restaurant_id, auditTag],
    );
    const shiftB = shiftBResult.rows[0].id;
    createdIds.shifts.push(shiftB);

    await expectReject(
      db,
      "Cashier A cannot settle while only Cashier B has an open shift",
      () => asUser(db, ids.cashier_user_id, "select public.verify_dining_session_payment($1, 'Cash', null, null, null)", [oldQr.order_id]),
      checks,
    );
    await asUser(
      db,
      ids.no_shift_user_id,
      "select public.verify_dining_session_payment($1, 'Cash', null, null, null)",
      [served.order_id],
    );
    const settled = await db.query(
      "select payment_status, cashier_shift_id from public.order_invoices where id = $1",
      [served.invoice_id],
    );
    check(
      "Inherited obligation settles onto the active cashier shift",
      settled.rows[0].payment_status === "paid" && settled.rows[0].cashier_shift_id === shiftB,
    );
    await db.query("rollback");
    transactionStarted = false;
  } catch (error) {
    auditError = error;
    if (transactionStarted) await db.query("rollback").catch(() => undefined);
    transactionStarted = false;
  } finally {
    for (const user of temporaryUsers) {
      const deleted = await service.auth.admin.deleteUser(user.id);
      if (deleted.error && !auditError) auditError = deleted.error;
    }
  }

  const baselineAfter = await productionBaseline(db);
  const databaseResidue = await db.query(
    `select
       (select count(*) from public.users where id = any($1::uuid[]))::int as users,
       (select count(*) from public.restaurant_staff where id = any($2::uuid[]) or display_name = $3)::int as staff,
       (select count(*) from public.orders where id = any($4::uuid[]))::int as orders,
       (select count(*) from public.order_invoices where id = any($5::uuid[]))::int as invoices,
       (select count(*) from public.cashier_shifts where id = any($6::uuid[]))::int as shifts`,
    [temporaryUsers.map((user) => user.id), createdIds.staff, auditTag, createdIds.orders, createdIds.invoices, createdIds.shifts],
  );
  let authResidue = 0;
  for (const user of temporaryUsers) {
    const lookup = await service.auth.admin.getUserById(user.id);
    if (!lookup.error && lookup.data?.user) authResidue += 1;
  }
  const residue = { ...databaseResidue.rows[0], auth_users: authResidue };
  check("Audit transaction and auth users leave zero residue", Object.values(residue).every((value) => Number(value) === 0), JSON.stringify(residue));
  check("Production baseline is unchanged after rollback", JSON.stringify(baselineAfter) === JSON.stringify(baselineBefore), JSON.stringify({ before: baselineBefore, after: baselineAfter }));
  console.log("HOSTED_BASELINE_AFTER " + JSON.stringify(baselineAfter));
  console.log("AUDIT_RESIDUE " + JSON.stringify(residue));

  if (auditError) throw auditError;

  checks.forEach((result) => {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}${result.detail ? ` - ${result.detail}` : ""}`);
  });

  const failed = checks.filter((result) => !result.ok);
  console.log(`HOSTED_PHASE_B_AUDIT ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exitCode = 1;
}

async function main() {
  const env = readEnv(path.join(__dirname, "..", "connection.env"));
  if (!env.SUPABASE_DB_URL) {
    throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  }

  const db = new Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  await db.connect();

  try {
    if (process.argv.includes("--rollback-validate")) {
      const migrationSql = fs.readFileSync(
        path.join(__dirname, "..", "migrations", "259_retire_obsolete_generic_customer_order_rpc.sql"),
        "utf8",
      );

      try {
        await db.query("begin");
        await db.query(migrationSql);
        const tombstone = await db.query(`select pg_get_functiondef(
          'public.create_customer_order(text,jsonb)'::regprocedure
        ) as definition`);
        if (!tombstone.rows[0].definition.includes("This ordering method is not supported.")) {
          throw new Error("Migration 259 tombstone was not installed.");
        }
        const supported = await db.query(`select to_regprocedure(name) is not null as exists
          from unnest(array[
            'public.create_public_qr_order(text,text,text,text,text,text,jsonb)',
            'public.submit_waiter_order_batch(text,text,text,text,text,jsonb,uuid)',
            'public.create_cashier_order(uuid,text,text,jsonb)'
          ]) name`);
        if (supported.rows.some((row) => !row.exists)) {
          throw new Error("A supported V1 order-entry RPC is missing.");
        }
        await db.query("rollback");
        console.log("ROLLBACK_VALIDATION PASS");
      } catch (error) {
        await db.query("rollback").catch(() => undefined);
        console.error("ROLLBACK_VALIDATION FAIL " + error.message);
        process.exitCode = 1;
      }

      return;
    }

    if (process.argv.includes("--hosted-test")) {
      await hostedBehaviorTest(db);
      return;
    }

    const heads = await db.query(
      "select version from supabase_migrations.schema_migrations order by version desc limit 5",
    );
    console.log("MIGRATION_HEADS " + JSON.stringify(heads.rows));

    const baseline = await db.query(`
      select
        count(*) filter (where payment_status in ('pending', 'held'))::int as unresolved_invoices,
        coalesce(sum(coalesce(grand_total, total_price, 0)) filter (where payment_status in ('pending', 'held')), 0)::numeric(12, 2) as unresolved_total,
        count(*) filter (where payment_status in ('pending', 'held') and created_at < now() - interval '36 hours')::int as unresolved_over_36h,
        min(created_at) filter (where payment_status in ('pending', 'held') and created_at is not null) as oldest_unresolved_created_at,
        count(*) filter (where payment_status = 'paid' and cashier_shift_id is null)::int as paid_null_shift
      from public.order_invoices
    `);
    console.log("BASELINE " + JSON.stringify(baseline.rows[0]));

    const sessionBaseline = await db.query(`
      select
        count(distinct orders.id) filter (where orders.dining_session_status = 'open')::int as open_sessions_with_unresolved,
        count(distinct orders.id) filter (where coalesce(orders.dining_session_status, '') <> 'open')::int as non_open_sessions_with_unresolved,
        count(*) filter (where orders.operational_status = 'served')::int as served_unpaid
      from public.order_invoices invoices
      join public.orders orders
        on orders.restaurant_id = invoices.restaurant_id
       and orders.id = invoices.order_id
      where invoices.payment_status in ('pending', 'held')
    `);
    console.log("SESSION_BASELINE " + JSON.stringify(sessionBaseline.rows[0]));

    const performanceTarget = await db.query(`
      select restaurant_id
      from public.order_invoices
      where payment_status in ('pending', 'held')
      order by created_at
      limit 1
    `);
    if (performanceTarget.rows[0]) {
      const explain = await db.query(`
        explain (format json)
        select invoices.id, orders.id, tables.id, receipt.created_at, cancellation.requested_at
        from public.order_invoices invoices
        join public.orders orders
          on orders.restaurant_id = invoices.restaurant_id
         and orders.id = invoices.order_id
        left join public.restaurant_tables tables
          on tables.restaurant_id = orders.restaurant_id
         and tables.id = orders.table_id
        left join lateral (
          select events.created_at
          from public.receipt_generation_events events
          where events.restaurant_id = invoices.restaurant_id
            and events.invoice_id = invoices.id
          order by events.created_at desc
          limit 1
        ) receipt on true
        left join lateral (
          select requests.requested_at
          from public.order_cancellation_requests requests
          where requests.restaurant_id = invoices.restaurant_id
            and requests.order_id = invoices.order_id
            and requests.status in ('pending_review', 'manager_review_required')
          order by requests.requested_at desc
          limit 1
        ) cancellation on true
        where invoices.restaurant_id = $1
          and invoices.payment_status in ('pending', 'held')
        order by case when orders.operational_status = 'served' then 0 else 1 end,
          invoices.created_at, invoices.id
      `, [performanceTarget.rows[0].restaurant_id]);
      console.log("UNRESOLVED_EXPLAIN " + JSON.stringify(explain.rows[0]["QUERY PLAN"][0].Plan));
    }

    const indexes = await db.query(`
      select tablename, indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename in (
          'order_invoices', 'orders', 'restaurant_tables',
          'receipt_generation_events', 'order_cancellation_requests'
        )
        and (
          indexdef ilike '%restaurant_id%'
          or indexdef ilike '%payment_status%'
          or indexdef ilike '%invoice_id%'
          or indexdef ilike '%order_id%'
        )
      order by tablename, indexname
    `);
    console.log("UNRESOLVED_INDEXES " + JSON.stringify(indexes.rows));

    const retiredSecurity = await db.query(`
      select
        pg_get_userbyid(procedures.proowner) as owner,
        procedures.prosecdef as security_definer,
        procedures.proconfig as configuration,
        procedures.proacl::text as acl,
        obj_description(procedures.oid, 'pg_proc') as comment
      from pg_proc procedures
      where procedures.oid = 'public.create_customer_order(text,jsonb)'::regprocedure
    `);
    console.log("RETIRED_RPC_SECURITY " + JSON.stringify(retiredSecurity.rows[0]));

    const missingInvoices = await db.query(`
      select
        orders.restaurant_id,
        orders.id,
        orders.order_source,
        orders.status,
        orders.operational_status,
        orders.dining_session_status,
        orders.created_at,
        orders.table_id,
        orders.table_number,
        orders.customer_user_id,
        orders.created_by_waiter_id,
        orders.total_price,
        orders.payment_method,
        count(items.id)::int as item_count,
        coalesce(sum(items.quantity * items.price), 0)::numeric(12, 2) as item_total
      from public.orders orders
      left join public.order_invoices invoices
        on invoices.restaurant_id = orders.restaurant_id
       and invoices.order_id = orders.id
      left join public.order_items items
        on items.restaurant_id = orders.restaurant_id
       and items.order_id = orders.id
      where invoices.id is null
      group by orders.restaurant_id, orders.id
      order by orders.created_at
    `);

    const counts = { A: 0, B: 0, C: 0, D: 0 };
    const rows = missingInvoices.rows.map((row) => {
      const classification = classifyOrder(row);
      counts[classification] += 1;
      return { classification, ...row };
    });

    console.log("MISSING_INVOICE_COUNTS " + JSON.stringify(counts));
    rows.forEach((row) => console.log("MISSING_INVOICE_ROW " + JSON.stringify(row)));

    const definitions = await db.query(`
      select
        procedures.proname,
        pg_get_function_arguments(procedures.oid) as args,
        pg_get_functiondef(procedures.oid) as definition
      from pg_proc procedures
      join pg_namespace namespaces
        on namespaces.oid = procedures.pronamespace
      where namespaces.nspname = 'public'
        and procedures.proname in (
          'create_customer_order',
          'create_public_qr_order',
          'submit_waiter_order_batch',
          'create_cashier_order',
          'get_cashier_payment_queue',
          'close_cashier_shift'
        )
      order by procedures.proname, pg_get_function_arguments(procedures.oid)
    `);

    definitions.rows.forEach((row) => {
      const compact = row.definition
        .replace(/\s+/g, " ")
        .slice(0, 1800);
      console.log("FUNCTION_DEFINITION " + JSON.stringify({
        name: row.proname,
        args: row.args,
        definition_sample: compact,
      }));
    });
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("FAIL " + error.message);
  process.exit(1);
});
