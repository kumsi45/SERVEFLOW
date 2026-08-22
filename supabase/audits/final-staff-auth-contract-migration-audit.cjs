const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8")
  .split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "244_isolate_legacy_privileged_terminal_login.sql"), "utf8");
const checks = [];
const check = (label, ok) => { checks.push(Boolean(ok)); console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };

async function main() {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    await db.query(migration);
    const target = (await db.query(`
      select staff.id, staff.employee_id, restaurant.slug, readiness.readiness
      from public.restaurant_staff staff
      join public.restaurants restaurant on restaurant.id=staff.restaurant_id
      join public.staff_credential_readiness readiness on readiness.restaurant_id=staff.restaurant_id and readiness.staff_id=staff.id
      where staff.active and restaurant.active and staff.role::text in ('manager','cashier','kitchen')
        and readiness.readiness in ('legacy_credential','reset_required')
      limit 1
    `)).rows[0];
    if (!target) throw new Error("A legacy privileged demo row is required for the terminal compatibility audit.");

    const before = await db.query("select * from public.resolve_restaurant_staff_identity($1,$2,null)", [target.slug, target.employee_id]);
    check("Legacy privileged demo identity still resolves", before.rowCount === 1 && before.rows[0].staff_id === target.id);
    await db.query("update public.staff_credential_readiness set readiness='password_ready',ready_at=now() where staff_id=$1", [target.id]);
    const after = await db.query("select * from public.resolve_restaurant_staff_identity($1,$2,null)", [target.slug, target.employee_id]);
    check("Password-ready privileged identity is excluded", after.rowCount === 0);
    const directory = await db.query("select * from public.get_restaurant_terminal_staff($1) where staff_id=$2", [target.slug, target.id]);
    check("Password-ready privileged account is not listed", directory.rowCount === 0);

    const definitions = await db.query(`select p.proname, p.prosecdef, pg_get_functiondef(p.oid) definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('get_restaurant_terminal_staff','resolve_restaurant_staff_identity')`);
    check("Both terminal functions remain SECURITY DEFINER", definitions.rowCount === 2 && definitions.rows.every((row) => row.prosecdef));
    check("Both terminal functions enforce readiness isolation", definitions.rows.every((row) => row.definition.includes("legacy_credential") && row.definition.includes("reset_required")));

    const grants = await db.query(`select routine_name, privilege_type from information_schema.routine_privileges
      where specific_schema='public' and grantee='anon'
        and routine_name in ('get_restaurant_terminal_staff','resolve_restaurant_staff_identity')`);
    check("Anonymous terminal execute grants remain narrowly compatible", new Set(grants.rows.map((row) => row.routine_name)).size === 2);
    check("Migration does not weaken table RLS", !/disable row level security|using\s*\(\s*true\s*\)/i.test(migration));
    check("Migration does not alter credential data", !/delete\s+from|truncate|alter\s+table/i.test(migration));
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
  console.log(`${checks.filter(Boolean).length}/${checks.length} checks passed`);
  if (checks.some((value) => !value)) process.exit(1);
}

main().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(1); });
