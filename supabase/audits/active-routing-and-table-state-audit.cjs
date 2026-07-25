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
    const routed = await client.query(`
      select oi.id order_item_id, oi.order_id, oi.restaurant_id, oi.menu_item_id,
        oi.kitchen_status::text kitchen_status, oi.kitchen_station_id routed_station_id,
        mi.kitchen_station_id assigned_station_id, mi.name menu_item_name,
        routed.name routed_station_name, assigned.name assigned_station_name,
        o.operational_status::text operational_status,
        o.dining_session_status::text dining_session_status,
        inv.payment_status::text payment_status
      from public.order_items oi
      join public.orders o on o.id = oi.order_id and o.restaurant_id = oi.restaurant_id
      left join public.order_invoices inv on inv.id = oi.invoice_id
        and inv.order_id = oi.order_id and inv.restaurant_id = oi.restaurant_id
      left join public.menu_items mi on mi.id = oi.menu_item_id and mi.restaurant_id = oi.restaurant_id
      left join public.kitchen_stations routed on routed.id = oi.kitchen_station_id
        and routed.restaurant_id = oi.restaurant_id
      left join public.kitchen_stations assigned on assigned.id = mi.kitchen_station_id
        and assigned.restaurant_id = oi.restaurant_id
      where oi.kitchen_status::text in ('held','accepted','preparing','ready')
        and (
          oi.kitchen_station_id is null
          or (mi.kitchen_station_id is not null and oi.kitchen_station_id is distinct from mi.kitchen_station_id)
          or routed.id is null or not routed.active or routed.archived_at is not null
        )
      order by oi.created_at
    `);
    const occupiedWithoutOrder = await client.query(`
      select t.id table_id, t.restaurant_id, t.table_number,
        o.id order_id, o.status::text order_status,
        o.operational_status::text operational_status,
        o.dining_session_status::text dining_session_status,
        o.created_at
      from public.restaurant_tables t
      join public.orders o
        on o.restaurant_id = t.restaurant_id
       and (o.table_id = t.id or (o.table_id is null and o.table_number = t.table_number::text))
       and o.dining_session_status::text = 'open'
       and o.table_released_at is null
       and o.status::text <> 'cancelled'
      where not exists (
        select 1 from public.order_items oi
        where oi.restaurant_id = o.restaurant_id and oi.order_id = o.id
      )
      order by t.restaurant_id, t.table_number, o.created_at
    `);
    const recentRouted = await client.query(`
      select oi.id order_item_id, oi.order_id, oi.restaurant_id,
        mi.name menu_item_name, ks.id station_id, ks.name station_name,
        oi.kitchen_status::text kitchen_status,
        o.operational_status::text operational_status,
        o.dining_session_status::text dining_session_status,
        o.payment_timing, o.workflow_policy_snapshot, o.workflow_version,
        inv.payment_status::text payment_status, oi.created_at
      from public.order_items oi
      join public.orders o on o.id = oi.order_id and o.restaurant_id = oi.restaurant_id
      left join public.order_invoices inv on inv.id = oi.invoice_id
        and inv.order_id = oi.order_id and inv.restaurant_id = oi.restaurant_id
      left join public.menu_items mi on mi.id = oi.menu_item_id and mi.restaurant_id = oi.restaurant_id
      left join public.kitchen_stations ks on ks.id = oi.kitchen_station_id
        and ks.restaurant_id = oi.restaurant_id
      where oi.kitchen_status::text in ('held','accepted','preparing','ready')
      order by oi.created_at desc
      limit 40
    `);
    const snapshotCounts = await client.query(`
      select workflow_policy_snapshot, payment_timing, dining_session_status::text,
        count(*)::integer count
      from public.orders
      group by workflow_policy_snapshot, payment_timing, dining_session_status
      order by workflow_policy_snapshot, payment_timing, dining_session_status
    `);
    console.log(JSON.stringify({ routingIssues: routed.rows, occupiedWithoutOrder: occupiedWithoutOrder.rows, snapshotCounts: snapshotCounts.rows, recentRouted: recentRouted.rows }, null, 2));
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
