const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function connectionUrl() {
  const line = fs.readFileSync(path.join(__dirname, "..", "connection.env"), "utf8")
    .split(/\r?\n/).find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const client = new Client({ connectionString: connectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    const candidate = await client.query(`
      select o.id order_id, o.restaurant_id, o.workflow_policy_snapshot,
        o.payment_timing, oi.id order_item_id, inv.id invoice_id,
        r.payment_policy original_live_policy
      from public.orders o
      join public.order_items oi on oi.order_id = o.id and oi.restaurant_id = o.restaurant_id
      join public.order_invoices inv on inv.id = oi.invoice_id
        and inv.order_id = o.id and inv.restaurant_id = o.restaurant_id
      join public.restaurants r on r.id = o.restaurant_id
      where o.workflow_policy_snapshot = 'kitchen_before_payment'
        and o.payment_timing = 'after_meal'
      order by oi.created_at desc limit 1
      for update of o, oi, inv, r
    `);
    if (!candidate.rowCount) throw new Error("No deferred-payment snapshot fixture exists remotely.");
    const row = candidate.rows[0];

    // Reopen only inside this transaction to exercise the active-batch gate.
    await client.query(`
      update public.orders
      set dining_session_status = 'open', table_released_at = null,
          status = 'paid'::public.order_status, operational_status = 'accepted'
      where id = $1
    `, [row.order_id]);
    await client.query(`
      update public.order_invoices set payment_status = 'held' where id = $1
    `, [row.invoice_id]);
    await client.query(`update public.order_items set kitchen_status = 'accepted' where id = $1`, [row.order_item_id]);

    // Reproduce the bug: change live policy, then advance the existing batch.
    await client.query(`update public.restaurants set payment_policy = 'pay_before_kitchen' where id = $1`, [row.restaurant_id]);
    const transition = await client.query(`
      update public.order_items set kitchen_status = 'preparing'
      where id = $1 returning kitchen_status::text
    `, [row.order_item_id]);
    const snapshot = await client.query(`
      select workflow_policy_snapshot, payment_timing from public.orders where id = $1
    `, [row.order_id]);
    const visible = await client.query(`
      select exists (
        select 1 from public.order_items
        where id = $1 and kitchen_status::text = 'preparing'
      ) as remains_visible
    `, [row.order_item_id]);
    const passed = transition.rows[0]?.kitchen_status === "preparing"
      && snapshot.rows[0]?.workflow_policy_snapshot === "kitchen_before_payment"
      && snapshot.rows[0]?.payment_timing === "after_meal"
      && visible.rows[0]?.remains_visible === true;
    await client.query("rollback");
    console.log(JSON.stringify({ passed, snapshot: snapshot.rows[0], batchState: transition.rows[0] }));
    if (!passed) process.exitCode = 1;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
