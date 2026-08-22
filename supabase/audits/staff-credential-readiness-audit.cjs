const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.join(__dirname, "..", "..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8")
  .split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "243_staff_credential_readiness.sql"), "utf8");
const checks = [];
const check = (label, ok, detail = "") => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
};

async function main() {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    await db.query(migration);

    const actors = (await db.query(`
      select distinct on (restaurant_id) user_id, restaurant_id
      from public.restaurant_staff
      where active and user_id is not null and role::text in ('owner','manager')
      order by restaurant_id, case when role::text='owner' then 0 else 1 end
    `)).rows;
    if (actors.length < 2) throw new Error("Two tenant administrators are required for the isolation audit.");
    const actorA = actors[0];
    const actorB = actors.find((actor) => actor.restaurant_id !== actorA.restaurant_id);
    if (!actorB) throw new Error("A second tenant administrator is required for the isolation audit.");

    const expected = Number((await db.query(`
      select count(*) from public.restaurant_staff
      where active and role::text in ('manager','cashier','kitchen','inventory','inventory_officer','waiter')
    `)).rows[0].count);
    const actual = Number((await db.query("select count(*) from public.staff_credential_readiness")).rows[0].count);
    check("Every active cutover account receives a readiness row", actual === expected, `${actual}/${expected}`);

    const invalid = Number((await db.query(`
      select count(*) from public.staff_credential_readiness readiness
      join public.restaurant_staff staff on staff.restaurant_id=readiness.restaurant_id and staff.id=readiness.staff_id
      where (staff.role::text='waiter' and readiness.readiness not in ('waiter_pin_ready','reset_required'))
         or (staff.role::text<>'waiter' and readiness.readiness<>'legacy_credential')
    `)).rows[0].count);
    check("Initial states are conservative and role-correct", invalid === 0);

    const missingWaiter = Number((await db.query(`
      select count(*) from public.staff_credential_readiness readiness
      join public.restaurant_staff staff on staff.restaurant_id=readiness.restaurant_id and staff.id=readiness.staff_id
      where staff.active and staff.role::text='waiter' and readiness.readiness='reset_required'
    `)).rows[0].count);
    check("Missing waiter enrollment remains visible", missingWaiter >= 1, String(missingWaiter));

    async function asUser(actor, sql, params = []) {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor.user_id]);
      const result = await db.query(sql, params);
      await db.query("reset role");
      return result;
    }

    const ownRows = await asUser(actorA, "select restaurant_id from public.staff_credential_readiness");
    check("Tenant administrator reads only own readiness rows", ownRows.rows.every((row) => row.restaurant_id === actorA.restaurant_id));
    const crossRows = await asUser(actorA, "select staff_id from public.staff_credential_readiness where restaurant_id=$1", [actorB.restaurant_id]);
    check("Cross-tenant readiness read is hidden by RLS", crossRows.rowCount === 0);

    await db.query("savepoint denied_write");
    try {
      await asUser(actorA, "update public.staff_credential_readiness set readiness='password_ready',ready_at=now() where restaurant_id=$1", [actorA.restaurant_id]);
      check("Authenticated clients cannot write readiness directly", false);
    } catch (error) {
      await db.query("rollback to savepoint denied_write");
      await db.query("reset role");
      check("Authenticated clients cannot write readiness directly", /permission denied/i.test(error.message));
    }

    await db.query("savepoint denied_anon");
    try {
      await db.query("set local role anon");
      await db.query("select * from public.staff_credential_readiness");
      check("Anonymous readiness access is denied", false);
    } catch (error) {
      await db.query("rollback to savepoint denied_anon");
      await db.query("reset role");
      check("Anonymous readiness access is denied", /permission denied/i.test(error.message));
    }

    const nonWaiterCredentials = Number((await db.query(`
      select count(*) from public.waiter_pin_credentials credential
      join public.restaurant_staff staff on staff.id=credential.staff_id and staff.restaurant_id=credential.restaurant_id
      where staff.role::text<>'waiter'
    `)).rows[0].count);
    check("Canonical waiter credentials remain waiter-only", nonWaiterCredentials === 0);

    const directGrants = Number((await db.query(`
      select count(*) from information_schema.role_table_grants
      where table_schema='public' and table_name='staff_credential_readiness'
        and grantee='authenticated' and privilege_type<>'SELECT'
    `)).rows[0].count);
    check("Readiness table exposes no authenticated write grants", directGrants === 0);

    const realtime = Number((await db.query(`
      select count(*) from pg_publication_tables where pubname='supabase_realtime'
        and schemaname='public' and tablename='staff_credential_readiness'
    `)).rows[0].count);
    check("Readiness changes use the RLS-protected realtime publication", realtime === 1);

    await db.query("rollback");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} hosted rollback checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
