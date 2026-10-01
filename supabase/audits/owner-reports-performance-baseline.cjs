const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const env = fs.readFileSync(path.join(root, "supabase/connection.env"), "utf8");
const url = env.match(/^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("SUPABASE_DB_URL is required in supabase/connection.env");

const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
const percentile = (values, at) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * at)];
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

async function asOwner(userId, sql, params = []) {
  await db.query("begin read only");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    const result = await db.query(sql, params);
    await db.query("rollback");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function measure(label, userId, sql, params, describe) {
  const samples = [];
  let value;
  await db.query("begin read only");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    for (let run = 0; run < 4; run += 1) {
      const started = performance.now();
      value = (await db.query(sql, params)).rows[0].result;
      const elapsed = performance.now() - started;
      if (run > 0) samples.push(elapsed);
    }
  } finally {
    await db.query("rollback");
  }
  console.log(JSON.stringify({
    kind: "rpc",
    label,
    clientMs: { min: +Math.min(...samples).toFixed(2), median: +percentile(samples, 0.5).toFixed(2), max: +Math.max(...samples).toFixed(2) },
    payloadBytes: bytes(value),
    ...describe(value),
  }));
}

function planNodes(plan, output = []) {
  output.push({
    node: plan["Node Type"],
    relation: plan["Relation Name"],
    index: plan["Index Name"],
    rows: plan["Actual Rows"],
    loops: plan["Actual Loops"],
    hit: plan["Shared Hit Blocks"],
    read: plan["Shared Read Blocks"],
  });
  for (const child of plan.Plans ?? []) planNodes(child, output);
  return output;
}

async function main() {
  await db.connect();
  try {
    await db.query("set statement_timeout='60s'; set lock_timeout='5s'; set application_name='serveflow-owner-reports-performance-baseline'");
    const migrationState = await db.query("select version from supabase_migrations.schema_migrations where version in ('267','268','269','270') order by version");
    console.log(JSON.stringify({ kind: "remoteMigrations", versions: migrationState.rows.map((row) => row.version) }));

    const tables = ["order_invoices", "order_items", "menu_items", "inventory_movements", "kitchen_inventory_requests", "cashier_shifts", "cash_reconciliations", "cashier_cash_handovers"];
    for (const table of tables) {
      const counts = await db.query(`select coalesce(sum(n),0)::int total, count(*)::int tenants, coalesce(max(n),0)::int max_per_tenant from (select restaurant_id,count(*) n from public.${table} group by restaurant_id) grouped`);
      console.log(JSON.stringify({ kind: "table", table, ...counts.rows[0] }));
    }

    const indexes = await db.query("select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename=any($1) order by tablename,indexname", [tables]);
    for (const row of indexes.rows) console.log(JSON.stringify({ kind: "index", ...row }));

    const owner = (await db.query("select s.user_id,s.restaurant_id from public.restaurant_staff s where s.role::text='owner' and s.active and s.user_id is not null order by (select count(*) from public.order_invoices i where i.restaurant_id=s.restaurant_id) desc limit 1")).rows[0];
    if (!owner) throw new Error("No active Owner membership is available for authenticated RPC measurement.");

    await measure("overview:today", owner.user_id, "select public.get_owner_reports_read_model($1,'today') result", [owner.restaurant_id], (value) => ({ buckets: value.salesAndOrders?.buckets?.length ?? null, menuRows: value.menu?.topSelling?.length ?? null }));
    for (const period of ["today", "week", "month"]) {
      await measure(`menu:${period}`, owner.user_id, "select public.get_owner_menu_sales_report($1,$2) result", [owner.restaurant_id, period], (value) => ({ soldRows: value.soldItems.length, noSalesRows: value.noSalesItems.length }));
    }

    const resolved = (await db.query("select public._owner_reports_resolve_period($1,'month',null,null,statement_timestamp()) result", [owner.restaurant_id])).rows[0].result;
    const explained = await db.query({
      text: `explain (analyze,buffers,format json)
        with current_menu_lines as (
          select items.id,items.menu_item_id,items.quantity,items.price
          from public.order_invoices invoices
          join public.order_items items on items.restaurant_id=$1 and items.invoice_id=invoices.id
          where invoices.restaurant_id=$1 and invoices.payment_status in ('paid','refunded')
            and invoices.paid_at >= $2::timestamptz and invoices.paid_at < $3::timestamptz
            and items.kitchen_status <> 'cancelled'
        ), menu_sales as (
          select menu_item_id,sum(quantity)::bigint quantity,sum(quantity*price)::numeric item_line_sales_value,count(*) line_count
          from current_menu_lines group by menu_item_id
        )
        select row_number() over(order by sales.quantity desc,sales.item_line_sales_value desc,sales.menu_item_id),sales.*
        from menu_sales sales`,
      values: [owner.restaurant_id, resolved.currentStart, resolved.currentEnd],
    });
    const report = explained.rows[0]["QUERY PLAN"][0];
    console.log(JSON.stringify({ kind: "plan", label: "menu:month-core", planningMs: report["Planning Time"], executionMs: report["Execution Time"], nodes: planNodes(report.Plan) }));
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
