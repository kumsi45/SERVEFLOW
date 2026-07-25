const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function connectionUrl() {
  const line = fs.readFileSync(path.join(__dirname, "..", "connection.env"), "utf8")
    .split(/\r?\n/).find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
}

const previousOrderId = "d0b8a3e4-116b-4b53-bef2-6881e8cf277c";

async function main() {
  const client = new Client({ connectionString: connectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");

    // Re-resolve and update even when the value is unchanged. PostgreSQL emits
    // the UPDATE through Supabase Realtime so every affected station refreshes.
    const routed = await client.query(`
      update public.order_items items
      set kitchen_station_id = public.resolve_kitchen_station_route(
        items.restaurant_id,
        items.menu_item_id
      )
      where items.order_id = $1
        and items.kitchen_status::text in ('held','accepted','preparing','ready')
      returning items.id, items.restaurant_id, items.order_id,
        items.kitchen_station_id, items.kitchen_status::text
    `, [previousOrderId]);

    const released = await client.query(`
      update public.orders orders
      set dining_session_status = 'closed',
          dining_session_closed_at = clock_timestamp(),
          dining_session_close_reason = 'empty_session_cleanup',
          table_released_at = clock_timestamp(),
          status = 'cancelled'::public.order_status,
          operational_status = 'closed',
          updated_at = clock_timestamp()
      where orders.dining_session_status::text = 'open'
        and orders.table_released_at is null
        and orders.status::text <> 'cancelled'
        and coalesce(orders.total_price, 0) = 0
        and not exists (
          select 1 from public.order_items items
          where items.restaurant_id = orders.restaurant_id
            and items.order_id = orders.id
        )
        and not exists (
          select 1 from public.order_invoices invoices
          where invoices.restaurant_id = orders.restaurant_id
            and invoices.order_id = orders.id
            and coalesce(invoices.total_price, 0) <> 0
        )
      returning orders.id, orders.restaurant_id, orders.table_id,
        orders.table_number, orders.dining_session_status::text,
        orders.operational_status::text
    `);

    if (routed.rowCount === 0) throw new Error("Previous active order was not found for rerouting.");
    await client.query("commit");

    const verification = await client.query(`
      select
        (select count(*)::integer from public.order_items items
          where items.order_id = $1
            and items.kitchen_status::text in ('accepted','preparing','ready')
            and items.kitchen_station_id is not null) as routed_active_items,
        (select count(*)::integer from public.orders orders
          where orders.dining_session_status::text = 'open'
            and orders.table_released_at is null
            and coalesce(orders.total_price, 0) = 0
            and not exists (select 1 from public.order_items items
              where items.restaurant_id = orders.restaurant_id and items.order_id = orders.id))
          as remaining_empty_open_sessions
    `, [previousOrderId]);

    console.log(JSON.stringify({
      reroutedItems: routed.rows,
      releasedEmptyTables: released.rows,
      verification: verification.rows[0],
    }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
