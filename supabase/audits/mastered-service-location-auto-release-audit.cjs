const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function envFile(file) {
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

const root = path.resolve(__dirname, "../..");
const connectionString = envFile(path.join(root, "supabase", "connection.env")).SUPABASE_DB_URL;
const client = () => new Client({ connectionString, ssl: { rejectUnauthorized: false } });
const results = [];
const check = (label, ok, detail = "") => results.push({ label, ok: Boolean(ok), detail });

async function setAuth(db, userId) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.role','authenticated',true)");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
}

async function resetAuth(db) {
  await db.query("reset role");
}

async function createSession(db, setup, options = {}) {
  const source = options.source || "cashier";
  const table = options.table === undefined ? setup.table : options.table;
  const tableNumber = table ? String(table.table_number) : null;
  if (source === "waiter") {
    await db.query("select set_config('request.jwt.claim.role','authenticated',true)");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [setup.waiter_user_id]);
  }
  const order = (await db.query(`
    insert into public.orders(
      restaurant_id,status,total_price,customer_name,table_number,order_source,dining_session_status,
      created_by_waiter_id
    ) values ($1,'paid',100,$2,$3,$4,$5,case when $4='waiter' then $6::uuid end)
    returning *`, [
      setup.restaurant_id,
      options.name || "Release Audit",
      tableNumber,
      source,
      table ? "open" : "closed",
      setup.waiter_staff_id,
    ])).rows[0];
  const invoiceStatuses = options.invoices || ["paid"];
  const invoices = [];
  for (let i = 0; i < invoiceStatuses.length; i += 1) {
    const payment = invoiceStatuses[i];
    const status = payment === "paid" ? "paid" : payment === "refunded" ? "refunded" : payment === "cancelled" ? "cancelled" : "pending";
    invoices.push((await db.query(`
      insert into public.order_invoices(
        restaurant_id,order_id,invoice_number,status,total_price,payment_method,payment_status
      ) values ($1,$2,$3,$4,100,'Cash',$5) returning *`,
      [setup.restaurant_id, order.id, i + 1, status, payment],
    )).rows[0]);
  }

  const itemStatuses = options.items || ["completed"];
  const items = [];
  for (let i = 0; i < itemStatuses.length; i += 1) {
    items.push((await db.query(`
      insert into public.order_items(
        restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status,
        kitchen_preparation_started_at,kitchen_preparation_started_by,
        kitchen_ready_marked_at,kitchen_ready_marked_by,
        kitchen_completed_at,kitchen_completed_by
      ) values (
        $1,$2,$3,$4,1,100,$5,
        case when $5 in ('preparing','ready','completed') then now() end,
        case when $5 in ('preparing','ready','completed') then $6::uuid end,
        case when $5 in ('ready','completed') then now() end,
        case when $5 in ('ready','completed') then $6::uuid end,
        case when $5='completed' then now() end,
        case when $5='completed' then $6::uuid end
      ) returning *`,
      [setup.restaurant_id, order.id, invoices[Math.min(i, invoices.length - 1)].id, setup.menu_item_id, itemStatuses[i], setup.cashier_staff_id],
    )).rows[0]);
  }
  if (source === "waiter") {
    await db.query("select set_config('request.jwt.claim.role','',true)");
    await db.query("select set_config('request.jwt.claim.sub','',true)");
  }
  return { order, invoices, items };
}

async function state(db, orderId) {
  return (await db.query(`
    select dining_session_status,table_released_at,table_id,table_number
    from public.orders where id=$1`, [orderId])).rows[0];
}

async function removeSession(db, orderId) {
  await db.query(`update public.order_items set
    kitchen_status='completed',cancellation_request_id=null,cancelled_at=null,cancelled_by_staff_id=null
    where order_id=$1 and kitchen_status='cancelled'`, [orderId]);
  await db.query("delete from public.order_cancellation_requests where order_id=$1", [orderId]);
  await db.query("delete from public.order_items where order_id=$1", [orderId]);
  await db.query("delete from public.order_invoices where order_id=$1", [orderId]);
  await db.query("delete from public.shift_activity_logs where order_id=$1", [orderId]);
  await db.query("delete from public.orders where id=$1", [orderId]);
}

async function transactionalScenarios(setupA, setupB) {
  const db = client();
  await db.connect();
  await db.query("begin");
  try {
    await db.query("update public.restaurants set payment_policy='kitchen_before_payment' where id=$1", [setupA.restaurant_id]);
    // A: payment first; preparing blocks, completed releases.
    let s = await createSession(db, setupA, { items: ["preparing"], invoices: ["paid"] });
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_a')", [s.order.id]);
    check("A paid plus preparing remains occupied", (await state(db, s.order.id)).dining_session_status === "open");
    await db.query("update public.order_items set kitchen_status='completed',kitchen_completed_at=now(),kitchen_completed_by=$2 where id=$1", [s.items[0].id, setupA.cashier_staff_id]);
    check("A final kitchen completion releases", (await state(db, s.order.id)).dining_session_status === "closed");
    await removeSession(db, s.order.id);

    // B: service first; payment verification invokes the same evaluator.
    s = await createSession(db, setupA, { source: "waiter", items: ["completed"], invoices: ["paid"] });
    await db.query("update public.order_invoices set payment_status='held' where id=$1", [s.invoices[0].id]);
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_b_before')", [s.order.id]);
    check("B completed plus pending payment remains occupied", (await state(db, s.order.id)).dining_session_status === "open");
    await setAuth(db, setupA.cashier_user_id);
    const paymentB = (await db.query("select public.verify_dining_session_payment($1,'Cash',null,null,null,false) result", [s.order.id])).rows[0].result;
    await resetAuth(db);
    const stateB = await state(db, s.order.id);
    const itemsB = (await db.query("select kitchen_status,invoice_id from public.order_items where order_id=$1", [s.order.id])).rows;
    check("B final payment verification releases", stateB.dining_session_status === "closed", JSON.stringify({ paymentB, stateB, itemsB }));
    await removeSession(db, s.order.id);

    // C: every item participates.
    s = await createSession(db, setupA, { items: ["completed", "completed", "preparing"], invoices: ["paid"] });
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_c_before')", [s.order.id]);
    check("C one preparing item blocks completed siblings", (await state(db, s.order.id)).dining_session_status === "open");
    await db.query("update public.order_items set kitchen_status='completed',kitchen_completed_at=now(),kitchen_completed_by=$2 where id=$1", [s.items[2].id, setupA.cashier_staff_id]);
    check("C last item completion releases", (await state(db, s.order.id)).dining_session_status === "closed");
    await removeSession(db, s.order.id);

    // D: every invoice participates.
    s = await createSession(db, setupA, { source: "waiter", items: ["completed", "completed"], invoices: ["paid", "paid"] });
    await db.query("update public.order_invoices set payment_status='held' where id=$1", [s.invoices[1].id]);
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_d_before')", [s.order.id]);
    check("D one pending invoice blocks a paid batch", (await state(db, s.order.id)).dining_session_status === "open");
    await setAuth(db, setupA.cashier_user_id);
    const paymentD = (await db.query("select public.verify_dining_session_payment($1,'Cash',null,null,null,false) result", [s.order.id])).rows[0].result;
    await resetAuth(db);
    const stateD = await state(db, s.order.id);
    const itemsD = (await db.query("select kitchen_status,invoice_id from public.order_items where order_id=$1", [s.order.id])).rows;
    check("D final invoice settlement releases", stateD.dining_session_status === "closed", JSON.stringify({ paymentD, stateD, itemsD }));
    await removeSession(db, s.order.id);

    // E: a later batch in the same session blocks the first completed batch.
    s = await createSession(db, setupA, { source: "cashier", items: ["completed"], invoices: ["paid"] });
    const addedInvoice = (await db.query(`insert into public.order_invoices(
      restaurant_id,order_id,invoice_number,status,total_price,payment_method,payment_status
    ) values($1,$2,2,'pending',50,null,'pending') returning *`, [setupA.restaurant_id, s.order.id])).rows[0];
    const addedItem = (await db.query(`insert into public.order_items(
      restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,kitchen_status,appended_at,
      kitchen_preparation_started_at,kitchen_preparation_started_by
    ) values($1,$2,$3,$4,1,50,'preparing',now(),now(),$5) returning *`, [setupA.restaurant_id, s.order.id, addedInvoice.id, setupA.menu_item_id, setupA.cashier_staff_id])).rows[0];
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_e')", [s.order.id]);
    check("E additional source batches aggregate under one session", addedItem.order_id === s.order.id && (await state(db, s.order.id)).dining_session_status === "open");
    await removeSession(db, s.order.id);

    // F: a legitimate release permits a later new session.
    s = await createSession(db, setupA, { items: ["completed"], invoices: ["paid"] });
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_f_release')", [s.order.id]);
    const next = await createSession(db, setupA, { items: ["accepted"], invoices: ["pending"] });
    check("F late add-on opens a distinct valid session", s.order.id !== next.order.id && (await state(db, next.order.id)).dining_session_status === "open");
    await removeSession(db, next.order.id);
    await removeSession(db, s.order.id);

    // G: READY is explicitly non-terminal.
    s = await createSession(db, setupA, { items: ["ready"], invoices: ["paid"] });
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_g')", [s.order.id]);
    check("G ready plus paid remains occupied", (await state(db, s.order.id)).dining_session_status === "open");
    await removeSession(db, s.order.id);

    // H: QR source uses identical session policy.
    s = await createSession(db, setupA, { source: "public_qr", items: ["preparing"], invoices: ["paid"] });
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_h_before')", [s.order.id]);
    check("H QR paid plus preparing remains occupied", (await state(db, s.order.id)).dining_session_status === "open");
    await db.query("update public.order_items set kitchen_status='completed',kitchen_completed_at=now(),kitchen_completed_by=$2 where id=$1", [s.items[0].id, setupA.cashier_staff_id]);
    check("H QR completion releases without customer confirmation", (await state(db, s.order.id)).dining_session_status === "closed");
    await removeSession(db, s.order.id);

    // I: waiter source needs no Served action.
    s = await createSession(db, setupA, { source: "waiter", items: ["completed"], invoices: ["paid"] });
    await db.query("update public.order_invoices set payment_status='held' where id=$1", [s.invoices[0].id]);
    await setAuth(db, setupA.cashier_user_id);
    const paymentI = (await db.query("select public.verify_dining_session_payment($1,'Cash',null,null,null,false) result", [s.order.id])).rows[0].result;
    await resetAuth(db);
    const stateI = await state(db, s.order.id);
    check("I waiter session releases after kitchen completed plus payment", stateI.dining_session_status === "closed", JSON.stringify({ paymentI, stateI }));
    await removeSession(db, s.order.id);

    // J: request-only is active; finalized canonical cancellation is terminal.
    s = await createSession(db, setupA, { source: "cashier", items: ["held"], invoices: ["paid"] });
    const request = (await db.query(`insert into public.order_cancellation_requests(
      restaurant_id,order_id,order_item_id,request_scope,requested_by_staff_id,requested_by_user_id,
      reason,current_order_status,current_kitchen_status,current_payment_status
    ) values($1,$2,$3,'item',$4,$5,'Wrong item entered','paid','held','paid') returning *`,
    [setupA.restaurant_id, s.order.id, s.items[0].id, setupA.waiter_staff_id, setupA.waiter_user_id])).rows[0];
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_j_request')", [s.order.id]);
    check("J cancellation request alone does not release", (await state(db, s.order.id)).dining_session_status === "open");
    await db.query("update public.order_invoices set status='cancelled' where id=$1", [s.invoices[0].id]);
    await db.query(`update public.order_items set kitchen_status='cancelled',cancellation_request_id=$2,
      cancelled_at=now(),cancelled_by_staff_id=$3 where id=$1`, [s.items[0].id, request.id, setupA.cashier_staff_id]);
    check("J finalized cancellation may release", (await state(db, s.order.id)).dining_session_status === "closed");
    await removeSession(db, s.order.id);

    // L: same number in another tenant is isolated by restaurant_id and table_id.
    const a = await createSession(db, setupA, { items: ["completed"], invoices: ["paid"] });
    const b = await createSession(db, setupB, { items: ["accepted"], invoices: ["pending"] });
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_l')", [a.order.id]);
    check("L tenant A release leaves tenant B same-number location occupied", (await state(db, a.order.id)).dining_session_status === "closed" && (await state(db, b.order.id)).dining_session_status === "open");
    await removeSession(db, a.order.id);
    await removeSession(db, b.order.id);

    // M/N: no physical table identity means no physical release authority.
    const physical = await createSession(db, setupA, { items: ["accepted"], invoices: ["pending"] });
    const delivery = await createSession(db, setupA, { table: null, name: "Delivery Audit", items: ["completed"], invoices: ["paid"] });
    const takeaway = await createSession(db, setupA, { table: null, name: "Takeaway Audit", items: ["completed"], invoices: ["paid"] });
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_delivery')", [delivery.order.id]);
    await db.query("select public.try_auto_release_settled_service_location($1,'audit_takeaway')", [takeaway.order.id]);
    check("M delivery without a location cannot affect a physical location", (await state(db, physical.order.id)).dining_session_status === "open" && (await state(db, delivery.order.id)).table_id === null);
    check("N takeaway without a location cannot affect a physical location", (await state(db, physical.order.id)).dining_session_status === "open" && (await state(db, takeaway.order.id)).table_id === null);
    await removeSession(db, delivery.order.id);
    await removeSession(db, takeaway.order.id);
    await removeSession(db, physical.order.id);

    await db.query("rollback");
  } catch (error) {
    await resetAuth(db).catch(() => {});
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

async function concurrentScenarios(setup) {
  const setupDb = client();
  await setupDb.connect();
  const cleanupIds = new Set();
  try {
    // K: cashier add-on racing final completion produces one valid occupied session.
    let s = await createSession(setupDb, setup, { items: ["ready"], invoices: ["paid"] });
    cleanupIds.add(s.order.id);
    const a = client();
    const b = client();
    await Promise.all([a.connect(), b.connect()]);
    let appendPayload;
    try {
      const completion = a.query("update public.order_items set kitchen_status='completed',kitchen_completed_at=now(),kitchen_completed_by=$2 where id=$1", [s.items[0].id, setup.cashier_staff_id]);
      const append = (async () => {
        await b.query("begin");
        await setAuth(b, setup.cashier_user_id);
        const result = await b.query("select public.append_items_to_order($1,$2::jsonb) result", [
          s.order.id,
          JSON.stringify([{ menu_item_id: setup.menu_item_id, quantity: 1, notes: "Concurrent coffee" }]),
        ]);
        await b.query("commit");
        return result.rows[0].result;
      })();
      [, appendPayload] = await Promise.all([completion, append]);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
    cleanupIds.add(appendPayload.order_id);
    const k = await setupDb.query(`select o.id,o.dining_session_status,o.table_released_at,
      count(i.id) filter(where i.notes='Concurrent coffee')::int coffee
      from public.orders o left join public.order_items i on i.order_id=o.id
      where o.restaurant_id=$1 and o.table_id=$2 and o.id=any($3::uuid[])
      group by o.id,o.dining_session_status,o.table_released_at`,
    [setup.restaurant_id, setup.table.id, [...cleanupIds]]);
    const open = k.rows.filter((row) => row.dining_session_status === "open" && row.table_released_at === null);
    check("K concurrent add-on is retained in one valid occupied session", open.length === 1 && open.reduce((sum, row) => sum + row.coffee, 0) === 1, JSON.stringify({ appendPayload, rows: k.rows }));
    for (const id of [...cleanupIds]) await removeSession(setupDb, id);
    cleanupIds.clear();

    // O: two release devices are idempotent and emit one release audit.
    s = await createSession(setupDb, setup, { items: ["completed"], invoices: ["paid"] });
    cleanupIds.add(s.order.id);
    await setupDb.query("update public.orders set completed_at=null,completed_by=null where id=$1", [s.order.id]);
    const one = client();
    const two = client();
    await Promise.all([one.connect(), two.connect()]);
    try {
      await Promise.all([
        one.query("select public.try_auto_release_settled_service_location($1,'audit_o_one')", [s.order.id]),
        two.query("select public.try_auto_release_settled_service_location($1,'audit_o_two')", [s.order.id]),
      ]);
    } finally {
      await Promise.all([one.end(), two.end()]);
    }
    const final = await state(setupDb, s.order.id);
    const logs = await setupDb.query(`select count(*)::int count,
      bool_and(actor_staff_id is null and metadata->>'actor_type'='system') system_actor
      from public.shift_activity_logs where order_id=$1 and action='service_location_released'`, [s.order.id]);
    check("O simultaneous system release is idempotent with one audit", final.dining_session_status === "closed" && logs.rows[0].count === 1 && logs.rows[0].system_actor === true, JSON.stringify({ final, logs: logs.rows[0] }));
  } finally {
    for (const id of [...cleanupIds]) await removeSession(setupDb, id).catch(() => {});
    await setupDb.end();
  }
}

async function main() {
  const db = client();
  await db.connect();
  const setups = (await db.query(`
    select r.id restaurant_id,t.id table_id,t.table_number,t.qr_token,
      m.id menu_item_id,c.id cashier_staff_id,c.user_id cashier_user_id,
      w.id waiter_staff_id,w.user_id waiter_user_id
    from public.restaurants r
    join public.restaurant_tables t on t.restaurant_id=r.id and t.active
    join public.menu_items m on m.restaurant_id=r.id and m.available and m.price>0
    join public.restaurant_staff c on c.restaurant_id=r.id and c.active and c.role='cashier' and c.user_id is not null
    join public.restaurant_staff w on w.restaurant_id=r.id and w.active and w.role='waiter' and w.user_id is not null
    where r.active and not exists(
      select 1 from public.orders o where o.restaurant_id=r.id and o.table_id=t.id
        and o.dining_session_status='open' and o.table_released_at is null
    )
    order by r.id,t.table_number,m.created_at
  `)).rows;
  await db.end();
  const distinct = [];
  for (const row of setups) {
    if (!distinct.some((entry) => entry.restaurant_id === row.restaurant_id)) {
      distinct.push({
        ...row,
        table: { id: row.table_id, table_number: row.table_number, qr_token: row.qr_token },
      });
    }
  }
  if (distinct.length < 2) throw new Error("Audit requires two tenants with one free location, menu item, cashier, and waiter each.");

  await transactionalScenarios(distinct[0], distinct[1]);
  await concurrentScenarios(distinct[0]);

  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}${entry.detail ? ` - ${entry.detail}` : ""}`);
  }
  const failures = results.filter((entry) => !entry.ok);
  console.log(`RESULT ${results.length - failures.length} PASS / ${failures.length} FAIL`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL mastered service-location release audit - ${error.stack || error.message}`);
  process.exitCode = 1;
});
