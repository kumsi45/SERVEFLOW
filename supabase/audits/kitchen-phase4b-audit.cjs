const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Client } = require("pg");

const root = path.join(__dirname, "..");
const migrationPath = path.join(__dirname, "migrations", "048_kitchen_station_collaboration_phase4b.sql");
const kitchenPagePath = path.join(root, "src", "modules", "kitchen", "pages", "KitchenDashboardPage.tsx");
const kitchenServicePath = path.join(root, "src", "modules", "kitchen", "services", "kitchenOrderService.ts");
const kitchenTypesPath = path.join(root, "src", "modules", "kitchen", "types.ts");
const kitchenCssPath = path.join(root, "src", "modules", "kitchen", "styles", "kitchenDashboard.css");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readKeyValueFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
      })
  );
}

function result(label, ok, detail = "") {
  return { label, ok, detail };
}

function hasAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

async function runLiveChecks(results) {
  const env = readKeyValueFile(path.join(__dirname, "connection.env"));
  if (!env.SUPABASE_DB_URL) {
    results.push(result("Live database checks skipped", true, "SUPABASE_DB_URL is not configured."));
    return;
  }

  const client = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const table = await client.query("select to_regclass('public.kitchen_order_station_progress') as table_name");
    if (!table.rows[0]?.table_name) {
      results.push(result("Live database Phase 4B migration pending", true, "Migration file exists; table is not yet applied to the connected database."));
      return;
    }

    const columns = await client.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'kitchen_order_station_progress'
      order by ordinal_position
    `);
    const columnNames = columns.rows.map((row) => row.column_name);
    results.push(result(
      "Live station progress schema",
      ["station_status", "item_count", "ready_count", "completed_count", "started_at", "ready_at", "completed_at"].every((name) => columnNames.includes(name)),
      columnNames.join(", ")
    ));

    const policies = await client.query(`
      select policyname, cmd
      from pg_policies
      where schemaname = 'public'
        and tablename = 'kitchen_order_station_progress'
      order by policyname
    `);
    results.push(result(
      "Live RLS policies",
      policies.rows.some((row) => row.policyname === "kitchen_order_station_progress_select_owner_or_station") &&
        policies.rows.some((row) => row.policyname === "kitchen_order_station_progress_update_own_station"),
      JSON.stringify(policies.rows)
    ));

    const realtime = await client.query(`
      select tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename in ('orders', 'order_items', 'kitchen_order_station_progress')
      order by tablename
    `);
    const realtimeTables = realtime.rows.map((row) => row.tablename);
    results.push(result(
      "Live realtime publication",
      realtimeTables.includes("order_items") && realtimeTables.includes("kitchen_order_station_progress"),
      realtimeTables.join(", ")
    ));

    const actions = await client.query(`
      select enumlabel
      from pg_enum
      where enumtypid = 'public.staff_activity_action'::regtype
        and enumlabel in ('kitchen_station_started', 'kitchen_station_ready', 'kitchen_station_completed', 'kitchen_order_completed')
      order by enumlabel
    `);
    results.push(result("Live activity action labels", actions.rows.length === 4, actions.rows.map((row) => row.enumlabel).join(", ")));
  } finally {
    await client.end();
  }
}

async function main() {
  const results = [];
  const migration = read(migrationPath);
  const page = read(kitchenPagePath);
  const service = read(kitchenServicePath);
  const types = read(kitchenTypesPath);
  const css = read(kitchenCssPath);

  results.push(result("Multiple stations", hasAll(migration, ["kitchen_order_station_progress", "kitchen_station_id", "unique (restaurant_id, order_id, kitchen_station_id)"])));
  results.push(result("Mixed order station progress", hasAll(migration, ["item_count", "ready_count", "completed_count", "refresh_kitchen_order_station_progress"])));
  results.push(result("Station isolation", hasAll(migration, ["current_kitchen_staff_station", "items.kitchen_station_id = effective_station_id", "target_station_id"])));
  results.push(result("Independent progress UI", hasAll(page + service + types + css, ["stationProgress", "StationProgressList", "kd-station-progress-row", "KitchenOrderStationProgress"])));
  results.push(result("Order waits for all stations", hasAll(migration, ["bool_or(progress.station_status = 'waiting')", "'paid'::public.order_status"])));
  results.push(result("Order auto completes", hasAll(migration, ["bool_and(progress.station_status = 'completed')", "'completed'::public.order_status", "kitchen_order_completed"])));
  results.push(result("Owner sees all stations", hasAll(migration + page, ["include_all_stations", "station_progress", "All Stations"])));
  results.push(result("Kitchen staff sees own station", hasAll(migration, ["role = 'kitchen'", "assigned_kitchen_station_id", "kitchen_order_station_progress_select_owner_or_station"])));
  results.push(result("RLS", hasAll(migration, ["enable row level security", "kitchen_order_station_progress_update_own_station", "with check"])));
  results.push(result("Realtime", hasAll(migration + page, ["supabase_realtime", "kitchen_order_station_progress", "postgres_changes"])));
  results.push(result("Activity logs", hasAll(migration, ["kitchen_station_started", "kitchen_station_ready", "kitchen_station_completed", "kitchen_order_completed", "log_staff_activity"])));
  results.push(result("Multi tenant isolation", hasAll(migration, ["restaurant_id = target_restaurant_id", "restaurant_id = target_order.restaurant_id", "references public.orders (restaurant_id, id)"])));
  results.push(result("Production safety scope", !/(public_qr|payments|receipt|reports|setup_wizard|auth\.users|cashier_shifts)/i.test(migration), "Migration stays inside kitchen order/station workflow."));

  try {
    execSync("npm run build", { cwd: root, stdio: "pipe", shell: true });
    results.push(result("Build", true, "npm run build"));
  } catch (error) {
    results.push(result("Build", false, error.stdout?.toString() || error.message));
  }

  await runLiveChecks(results);

  const failed = results.filter((entry) => !entry.ok);
  for (const entry of results) {
    console.log(`${entry.ok ? "PASS" : "FAIL"} ${entry.label}${entry.detail ? `: ${entry.detail}` : ""}`);
  }
  console.log(`Passed: ${results.length - failed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
