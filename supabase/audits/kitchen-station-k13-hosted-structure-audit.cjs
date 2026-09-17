// Read-only post-deployment structural audit for Kitchen Station Safety K1.3.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const config = fs.readFileSync(path.join(root, "supabase/connection.env"), "utf8");
const url = config.match(/^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$/m)?.[1]?.replace(/^["']|["']$/g, "");
if (!url) throw new Error("SUPABASE_DB_URL missing");
const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
const check = (label, value) => { assert.ok(value, label); console.log(`PASS ${label}`); };

(async () => {
  await db.connect();
  try {
    const history = await db.query("select version from supabase_migrations.schema_migrations where version in ('264','265') order by version");
    check("remote history records only Kitchen migration 264", JSON.stringify(history.rows.map((row) => row.version)) === JSON.stringify(["264"]));

    const objects = await db.query(`
      select
        pg_get_functiondef('public.resolve_kitchen_station_route(uuid,uuid)'::regprocedure) routing,
        pg_get_functiondef('public.enforce_kitchen_station_disable_obligations()'::regprocedure) disable_guard,
        pg_get_triggerdef(trigger.oid, true) trigger_definition,
        indexdef
      from pg_trigger trigger
      join pg_class relation on relation.oid = trigger.tgrelid
      join pg_namespace schema on schema.oid = relation.relnamespace
      cross join lateral (
        select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'order_items_station_unresolved_routing_idx'
      ) index_row
      where schema.nspname = 'public'
        and relation.relname = 'kitchen_stations'
        and trigger.tgname = 'enforce_kitchen_station_disable_obligations'
        and not trigger.tgisinternal
    `);
    check("disable trigger is attached exactly once", objects.rowCount === 1);
    const row = objects.rows[0];
    check("route resolver uses tenant-station advisory locks", row.routing.includes("pg_advisory_xact_lock") && row.routing.includes("hashtext(target_restaurant_id::text)"));
    check("disable guard protects last active station", row.disable_guard.includes("LAST_ACTIVE_KITCHEN_STATION"));
    check("disable guard protects unresolved frozen work", row.disable_guard.includes("KITCHEN_STATION_HAS_UNRESOLVED_WORK") && row.disable_guard.includes("not in ('completed', 'cancelled')"));
    check("disable guard uses tenant lifecycle and tenant-station locks", row.disable_guard.includes("kitchen_station_lifecycle") && row.disable_guard.includes("hashtext(old.id::text)"));
    check("trigger is before active updates on kitchen stations", /before update of active on (?:public\.)?kitchen_stations/i.test(row.trigger_definition));
    check("partial unresolved-work index matches predicate", row.indexdef.includes("kitchen_status <> ALL (ARRAY['completed'::text, 'cancelled'::text])"));

    const security = await db.query(`
      select p.proname, p.prosecdef, p.proowner::regrole::text owner, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('resolve_kitchen_station_route', 'enforce_kitchen_station_disable_obligations')
      order by p.proname
    `);
    check("both deployed functions are security definer with explicit public search_path", security.rowCount === 2 && security.rows.every((entry) => entry.prosecdef && (entry.proconfig ?? []).includes("search_path=public")));

    const park = await db.query("select to_regclass('public.menu_item_creation_operations') parked_table, to_regprocedure('public.create_owner_menu_item_v1(uuid,uuid,jsonb)') parked_function");
    check("parked Menu candidate objects remain absent", park.rows[0].parked_table === null && park.rows[0].parked_function === null);

    const plan = await db.query(`explain (costs false)
      select 1 from public.order_items items
      where items.restaurant_id = '00000000-0000-0000-0000-000000000000'::uuid
        and items.kitchen_station_id = '00000000-0000-0000-0000-000000000000'::uuid
        and items.kitchen_status not in ('completed', 'cancelled')`);
    check("hosted obligation lookup plans with the K1.3 partial index", plan.rows.map((entry) => entry['QUERY PLAN']).join("\n").includes("order_items_station_unresolved_routing_idx"));
  } finally {
    await db.end();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
