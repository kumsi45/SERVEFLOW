const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

async function main() {
  const root = path.resolve(__dirname, "../..");
  const connection = envFile(path.join(root, "supabase", "connection.env")).SUPABASE_DB_URL;
  const db = new Client({ connectionString: connection, ssl: { rejectUnauthorized: false } });
  const results = [];
  const check = (label, condition, detail = "") => results.push({ label, ok: Boolean(condition), detail });
  const auth = async (role, userId = "") => {
    await db.query("reset role");
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.role',$1,true)", [role]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  };
  const expectReject = async (label, action, pattern) => {
    await db.query("savepoint expected_rejection");
    try {
      await action();
      await db.query("rollback to savepoint expected_rejection");
      check(label, false, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint expected_rejection");
      check(label, pattern.test(error.message), error.message);
    }
  };
  const waiterOrder = async (actor, tableNumber, itemId, note) => {
    await auth("authenticated", actor.waiter_user_id);
    return (await db.query(
      "select public.submit_waiter_order_batch($1,$2,$3,$4,$5,$6::jsonb,$7) result",
      [actor.slug, tableNumber, "Workflow Audit", "", note, JSON.stringify([{ menu_item_id: itemId, quantity: 1, notes: note }]), crypto.randomUUID()],
    )).rows[0].result;
  };
  const batchState = async (invoiceId) => (await db.query(`
    select i.payment_status, i.invoice_source, x.kitchen_status
    from public.order_invoices i join public.order_items x on x.invoice_id=i.id
    where i.id=$1 limit 1`, [invoiceId])).rows[0];

  await db.connect();
  try {
    const setup = await db.query(`
      select r.id restaurant_id,r.slug,
        w.user_id waiter_user_id,c.user_id cashier_user_id,o.user_id owner_user_id,
        array_agg(jsonb_build_object('number',t.table_number,'token',t.qr_token) order by t.table_number) tables
      from public.restaurants r
      join public.restaurant_tables t on t.restaurant_id=r.id and t.active and t.qr_token is not null
      join public.restaurant_staff w on w.restaurant_id=r.id and w.role='waiter' and w.active and w.user_id is not null
      join public.restaurant_staff c on c.restaurant_id=r.id and c.role='cashier' and c.active and c.user_id is not null
      join public.restaurant_staff o on o.restaurant_id=r.id and o.role='owner' and o.active and o.user_id is not null
      where r.active
        and (select count(*) from public.menu_items m where m.restaurant_id=r.id and m.available and m.price>0)>=2
        and not exists(select 1 from public.orders x where x.restaurant_id=r.id and x.table_number=t.table_number::text and x.dining_session_status='open')
      group by r.id,r.slug,w.user_id,c.user_id,o.user_id
      having count(distinct t.id)>=3
      limit 1`);
    if (!setup.rowCount) throw new Error("Audit requires one restaurant with three free QR tables, waiter, cashier, owner, and two menu items.");
    const actor = setup.rows[0];
    const tables = actor.tables.slice(0, 3);
    const menu = (await db.query("select id from public.menu_items where restaurant_id=$1 and available and price>0 order by created_at limit 2", [actor.restaurant_id])).rows;
    const otherCashier = (await db.query("select user_id from public.restaurant_staff where restaurant_id<>$1 and role='cashier' and active and user_id is not null limit 1", [actor.restaurant_id])).rows[0];

    await db.query("begin");

    // Scenario 1: QR is always pay -> kitchen, regardless of restaurant mode.
    await auth("authenticated", actor.owner_user_id);
    await db.query("select public.set_restaurant_payment_policy($1,'kitchen_before_payment')", [actor.restaurant_id]);
    await auth("anon");
    const qr = (await db.query(
      "select public.create_public_qr_order($1,$2,$3,$4,$5,$6,$7::jsonb) result",
      [actor.slug, String(tables[0].number), tables[0].token, crypto.randomUUID().toString(), "QR Audit", "Cash", JSON.stringify([{ menu_item_id: menu[0].id, quantity: 1, notes: "" }])],
    )).rows[0].result;
    await db.query("reset role");
    const qrState = await batchState(qr.invoice_id);
    check("QR waits for payment before kitchen", qrState.payment_status === "pending" && qrState.kitchen_status === "held", JSON.stringify(qrState));
    await auth("authenticated", actor.owner_user_id);
    const qrKitchenBefore = await db.query("select id from public.get_station_kitchen_orders($1,null,true,false) where id=$2", [actor.restaurant_id, qr.order_id]);
    check("Unpaid QR is absent from kitchen", qrKitchenBefore.rowCount === 0);
    await auth("authenticated", actor.cashier_user_id);
    await db.query("select public.verify_dining_session_payment($1,'Cash',null,null,null,false)", [qr.order_id]);
    await db.query("reset role");
    const qrPaid = await batchState(qr.invoice_id);
    check("Paid QR reaches Accepted", qrPaid.payment_status === "paid" && qrPaid.kitchen_status === "accepted", JSON.stringify(qrPaid));

    // Scenario 2: waiter Pay Before Kitchen.
    await auth("authenticated", actor.owner_user_id);
    await db.query("select public.set_restaurant_payment_policy($1,'pay_before_kitchen')", [actor.restaurant_id]);
    const before = await waiterOrder(actor, String(tables[1].number), menu[0].id, "Pay first");
    await db.query("reset role");
    const beforeState = await batchState(before.invoice_id);
    check("Waiter Pay Before Kitchen waits for cashier", beforeState.payment_status === "pending" && beforeState.kitchen_status === "held", JSON.stringify(beforeState));
    await auth("authenticated", actor.cashier_user_id);
    await db.query("select public.verify_dining_session_payment($1,'Cash',null,null,null,false)", [before.order_id]);
    await db.query("reset role");
    const beforePaid = await batchState(before.invoice_id);
    check("Waiter Pay Before Kitchen releases after session payment", beforePaid.payment_status === "paid" && beforePaid.kitchen_status === "accepted", JSON.stringify(beforePaid));

    // Scenarios 3-5: Kitchen Before Payment, added batch, one session and one payment.
    await auth("authenticated", actor.owner_user_id);
    await db.query("select public.set_restaurant_payment_policy($1,'kitchen_before_payment')", [actor.restaurant_id]);
    const first = await waiterOrder(actor, String(tables[2].number), menu[0].id, "Starter");
    const added = await waiterOrder(actor, String(tables[2].number), menu[1].id, "Dessert");
    check("Additional waiter order reuses dining session", first.order_id === added.order_id);
    check("Additional waiter order keeps a distinct batch", first.invoice_id !== added.invoice_id);
    await db.query("reset role");
    const states = await db.query(`select i.id,i.payment_status,x.kitchen_status from public.order_invoices i join public.order_items x on x.invoice_id=i.id where i.id=any($1::uuid[]) order by i.invoice_number`, [[first.invoice_id, added.invoice_id]]);
    check("Kitchen Before Payment releases every waiter batch immediately", states.rows.every((row) => row.payment_status === "held" && row.kitchen_status === "accepted"), JSON.stringify(states.rows));
    const openCount = await db.query("select count(*)::int count from public.orders where restaurant_id=$1 and table_number=$2 and dining_session_status='open'", [actor.restaurant_id, String(tables[2].number)]);
    check("Exactly one dining session owns both orders", openCount.rows[0].count === 1);

    if (otherCashier) {
      await auth("authenticated", otherCashier.user_id);
      await expectReject(
        "Another restaurant cannot collect this dining session",
        () => db.query("select public.verify_dining_session_payment($1,'Cash',null,null,null,false)", [first.order_id]),
        /only an active cashier/i,
      );
    }

    await auth("authenticated", actor.owner_user_id);
    const queue = await db.query("select * from public.get_station_kitchen_orders($1,null,true,false) where id=$2", [actor.restaurant_id, first.order_id]);
    check("Both added batches are in the kitchen queue", queue.rowCount >= 2, `queue rows=${queue.rowCount}`);
    for (const row of queue.rows) {
      const stationId = row.station_progress?.[0]?.station_id;
      await db.query("select public.start_order_preparation($1,$2,$3)", [first.order_id, stationId, row.kitchen_batch_key]);
      await db.query("select public.mark_order_ready($1,$2,$3)", [first.order_id, stationId, row.kitchen_batch_key]);
      await db.query("select public.mark_order_completed($1,$2,$3)", [first.order_id, stationId, row.kitchen_batch_key]);
    }
    await db.query("reset role");
    const beforeCollection = await db.query("select count(*)::int due from public.order_invoices where order_id=$1 and payment_status='held'", [first.order_id]);
    check("Completed dining session remains Payment Due", beforeCollection.rows[0].due === 2);
    await auth("authenticated", actor.cashier_user_id);
    const payment = (await db.query("select public.verify_dining_session_payment($1,'Cash',null,null,null,false) result", [first.order_id])).rows[0].result;
    check("One session payment settles both order batches", Number(payment.settled_invoice_count) === 2 && Number(payment.settled_total) > 0, JSON.stringify(payment));
    await db.query("select public.close_dining_session($1,'workflow_audit')", [first.order_id]);
    await db.query("reset role");
    const closed = await db.query("select dining_session_status,table_released_at from public.orders where id=$1", [first.order_id]);
    check("Paid completed dining session closes", closed.rows[0].dining_session_status === "closed" && closed.rows[0].table_released_at !== null, JSON.stringify(closed.rows[0]));

    await db.query("rollback");
  } catch (error) {
    await db.query("reset role").catch(() => {});
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }

  for (const entry of results) console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}${entry.detail ? ` — ${entry.detail}` : ""}`);
  const failures = results.filter((entry) => !entry.ok);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL waiter workflow audit — ${error.message}`);
  process.exitCode = 1;
});
