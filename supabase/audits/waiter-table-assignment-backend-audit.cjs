const fs = require("fs");
const crypto = require("crypto");
const { Client } = require("pg");

const env = Object.fromEntries(fs.readFileSync("supabase/connection.env", "utf8")
  .split(/\r?\n/)
  .filter((line) => line.includes("="))
  .map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const migration = fs.readFileSync("supabase/migrations/245_waiter_table_assignment_backend.sql", "utf8");
const leastPrivilegeMigration = fs.readFileSync("supabase/migrations/246_waiter_table_assignment_least_privilege.sql", "utf8");
const id = () => crypto.randomUUID();
const results = [];

function check(label, ok, detail = "") {
  const result = { label, ok: Boolean(ok), detail };
  results.push(result);
  console.log(`${result.ok ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
}

async function main() {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const asUser = async (userId, sql, params = []) => {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    const output = await db.query(sql, params);
    await db.query("reset role");
    return output;
  };
  const expectUserReject = async (label, userId, sql, params, pattern = /Permission denied|Authentication required/i) => {
    await db.query("savepoint expected_rejection");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
      await db.query(sql, params);
      await db.query("reset role");
      await db.query("rollback to savepoint expected_rejection");
      check(label, false, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint expected_rejection");
      await db.query("reset role");
      check(label, pattern.test(error.message), error.message);
    }
  };

  try {
    await db.query("begin");
    const migrationIsDeployed = (await db.query(
      "select to_regprocedure('public.assign_waiter_tables(uuid,uuid,uuid[])') is not null as deployed",
    )).rows[0].deployed;
    if (!migrationIsDeployed) await db.query(migration);
    const directMutationStillGranted = (await db.query(`select
      has_table_privilege('anon','public.restaurant_table_waiter_assignments','insert')
      or has_table_privilege('anon','public.restaurant_table_waiter_assignments','update')
      or has_table_privilege('anon','public.restaurant_table_waiter_assignments','delete')
      or has_table_privilege('anon','public.restaurant_table_waiter_assignments','truncate')
      or has_table_privilege('authenticated','public.restaurant_table_waiter_assignments','insert')
      or has_table_privilege('authenticated','public.restaurant_table_waiter_assignments','update')
      or has_table_privilege('authenticated','public.restaurant_table_waiter_assignments','delete')
      or has_table_privilege('authenticated','public.restaurant_table_waiter_assignments','truncate') as unsafe`
    )).rows[0].unsafe;
    if (directMutationStillGranted) await db.query(leastPrivilegeMigration);
    const unsafeGrantAfterHardening = (await db.query(`select
      has_table_privilege('anon','public.restaurant_table_waiter_assignments','insert')
      or has_table_privilege('anon','public.restaurant_table_waiter_assignments','update')
      or has_table_privilege('anon','public.restaurant_table_waiter_assignments','delete')
      or has_table_privilege('anon','public.restaurant_table_waiter_assignments','truncate')
      or has_table_privilege('authenticated','public.restaurant_table_waiter_assignments','insert')
      or has_table_privilege('authenticated','public.restaurant_table_waiter_assignments','update')
      or has_table_privilege('authenticated','public.restaurant_table_waiter_assignments','delete')
      or has_table_privilege('authenticated','public.restaurant_table_waiter_assignments','truncate') as unsafe`
    )).rows[0].unsafe;
    if (unsafeGrantAfterHardening) throw new Error("Direct assignment-table mutation privileges remain granted.");

    const users = (await db.query("select distinct user_id from public.restaurant_staff where user_id is not null limit 8"))
      .rows.map((row) => row.user_id);
    if (users.length < 8) throw new Error("Hosted audit requires eight existing authenticated identities.");

    const restaurantA = id();
    const restaurantB = id();
    const suffix = crypto.randomUUID().slice(0, 8);
    const staff = {
      managerA: { id: id(), user: users[0] },
      managerB: { id: id(), user: users[1] },
      waiterA1: { id: id(), user: users[2] },
      waiterA2: { id: id(), user: users[3] },
      waiterB: { id: id(), user: users[4] },
      cashierA: { id: id(), user: users[5] },
      chefA: { id: id(), user: users[6] },
      ownerA: { id: id(), user: users[7] },
    };
    const tablesA = [id(), id(), id(), id(), id()];
    const tableB = id();
    const orderA = id();
    const invoiceA = id();

    await db.query(
      "insert into public.restaurants(id,name,slug) values($1,'Waiter Assignment Audit A',$2),($3,'Waiter Assignment Audit B',$4)",
      [restaurantA, `waiter-assignment-a-${suffix}`, restaurantB, `waiter-assignment-b-${suffix}`],
    );
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values
      ($1,$2,$3,'manager','Audit Manager A',true),
      ($4,$5,$6,'manager','Audit Manager B',true),
      ($7,$2,$8,'waiter','Audit Waiter A1',true),
      ($9,$2,$10,'waiter','Audit Waiter A2',true),
      ($11,$5,$12,'waiter','Audit Waiter B',true),
      ($13,$2,$14,'cashier','Audit Cashier A',true),
      ($15,$2,$16,'kitchen','Audit Chef A',true),
      ($17,$2,$18,'owner','Audit Owner A',true)`, [
      staff.managerA.id, restaurantA, staff.managerA.user,
      staff.managerB.id, restaurantB, staff.managerB.user,
      staff.waiterA1.id, staff.waiterA1.user,
      staff.waiterA2.id, staff.waiterA2.user,
      staff.waiterB.id, staff.waiterB.user,
      staff.cashierA.id, staff.cashierA.user,
      staff.chefA.id, staff.chefA.user,
      staff.ownerA.id, staff.ownerA.user,
    ]);
    for (let index = 0; index < tablesA.length; index += 1) {
      await db.query(
        "insert into public.restaurant_tables(id,restaurant_id,table_number,label,qr_path,qr_url,active) values($1,$2,$3,$4,$5,$6,true)",
        [tablesA[index], restaurantA, 401 + index, `Audit A${index + 1}`, `audit-a${index + 1}`, `https://audit.invalid/a${index + 1}`],
      );
    }
    await db.query(
      "insert into public.restaurant_tables(id,restaurant_id,table_number,label,qr_path,qr_url,active) values($1,$2,401,'Audit B1','audit-b1','https://audit.invalid/b1',true)",
      [tableB, restaurantB],
    );
    await db.query(`insert into public.orders(
      id,restaurant_id,table_id,table_number,customer_name,created_by_waiter_id,order_source,status,total_price,
      dining_session_status,table_released_at,operational_status,workflow_policy_snapshot
    ) values($1,$2,$3,'403','Audit Occupied',$4,'waiter','pending',42,'open',null,'new','pay_before_kitchen')`,
    [orderA, restaurantA, tablesA[2], staff.waiterA1.id]);
    await db.query(
      "insert into public.order_invoices(id,restaurant_id,order_id,invoice_number,status,total_price,payment_status) values($1,$2,$3,1,'pending',42,'pending')",
      [invoiceA, restaurantA, orderA],
    );

    const realtime = await db.query("select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='restaurant_table_waiter_assignments'");
    if (realtime.rowCount !== 1) throw new Error("Assignment table is not in supabase_realtime publication.");

    const contextA = (await asUser(staff.managerA.user, "select public.get_waiter_table_assignment_context($1) context", [restaurantA])).rows[0].context;
    check("A. Manager A lists only Tenant A Waiters and tables", contextA.waiters.length === 2
      && contextA.waiters.every((waiter) => [staff.waiterA1.id, staff.waiterA2.id].includes(waiter.staff_id))
      && tablesA.every((tableId) => contextA.tables.some((table) => table.table_id === tableId))
      && contextA.tables.every((table) => table.table_id !== tableB));

    await expectUserReject("B. Manager B cannot retrieve Tenant A assignment dataset", staff.managerB.user,
      "select public.get_waiter_table_assignment_context($1)", [restaurantA]);

    await asUser(staff.managerA.user, "select * from public.assign_waiter_tables($1,$2,$3)",
      [restaurantA, staff.waiterA1.id, tablesA.slice(0, 3)]);
    const waiterA1Assignments = await db.query("select table_id from public.restaurant_table_waiter_assignments where restaurant_id=$1 and waiter_staff_id=$2 and active order by table_id", [restaurantA, staff.waiterA1.id]);
    check("C. Manager A assigns A1/A2/A3 to Waiter A1", waiterA1Assignments.rows.length === 3
      && tablesA.slice(0, 3).every((tableId) => waiterA1Assignments.rows.some((row) => row.table_id === tableId)));
    const firstActiveCount = Number((await db.query("select count(*) count from public.restaurant_table_waiter_assignments where restaurant_id=$1 and active", [restaurantA])).rows[0].count);
    check("D. Bulk assignment creates exactly three active assignments", firstActiveCount === 3);

    await asUser(staff.managerA.user, "select * from public.assign_waiter_tables($1,$2,$3)",
      [restaurantA, staff.waiterA2.id, tablesA.slice(3, 5)]);
    const waiterA2Count = Number((await db.query("select count(*) count from public.restaurant_table_waiter_assignments where restaurant_id=$1 and waiter_staff_id=$2 and active", [restaurantA, staff.waiterA2.id])).rows[0].count);
    check("E. Manager A assigns A4/A5 to Waiter A2", waiterA2Count === 2);

    const orderBefore = (await db.query("select created_by_waiter_id,dining_session_status,table_released_at,operational_status,status,total_price from public.orders where id=$1", [orderA])).rows[0];
    const invoiceBefore = (await db.query("select status,payment_status,payment_method,total_price from public.order_invoices where id=$1", [invoiceA])).rows[0];
    await asUser(staff.managerA.user, "select * from public.assign_waiter_tables($1,$2,$3)",
      [restaurantA, staff.waiterA2.id, [tablesA[2], tablesA[3], tablesA[4]]]);
    const currentA3 = (await db.query("select waiter_staff_id from public.restaurant_table_waiter_assignments where restaurant_id=$1 and table_id=$2 and active", [restaurantA, tablesA[2]])).rows[0];
    check("F. Table A3 reassigns from Waiter A1 to Waiter A2", currentA3.waiter_staff_id === staff.waiterA2.id);
    const endedA3 = (await db.query("select active,ended_at,ended_by_staff_id from public.restaurant_table_waiter_assignments where restaurant_id=$1 and table_id=$2 and waiter_staff_id=$3", [restaurantA, tablesA[2], staff.waiterA1.id])).rows[0];
    check("G. Previous A3 assignment is inactive and ended", endedA3.active === false && endedA3.ended_at && endedA3.ended_by_staff_id === staff.managerA.id);

    const orderAfter = (await db.query("select created_by_waiter_id,dining_session_status,table_released_at,operational_status,status,total_price from public.orders where id=$1", [orderA])).rows[0];
    const invoiceAfter = (await db.query("select status,payment_status,payment_method,total_price from public.order_invoices where id=$1", [invoiceA])).rows[0];
    check("H. Historical order waiter attribution remains unchanged", orderAfter.created_by_waiter_id === orderBefore.created_by_waiter_id);
    check("I. Occupied table remains occupied after reassignment", orderAfter.dining_session_status === "open" && orderAfter.table_released_at === null);
    check("J. Payment state remains unchanged", JSON.stringify(invoiceAfter) === JSON.stringify(invoiceBefore));
    check("K. Kitchen/order operational state remains unchanged", orderAfter.operational_status === orderBefore.operational_status && orderAfter.status === orderBefore.status);

    await expectUserReject("L. Cross-tenant Waiter assignment is rejected", staff.managerA.user,
      "select * from public.assign_waiter_tables($1,$2,$3)", [restaurantA, staff.waiterB.id, [tablesA[0]]], /Active Waiter not found/i);
    const beforeCrossTable = (await db.query("select table_id,waiter_staff_id from public.restaurant_table_waiter_assignments where restaurant_id=$1 and active order by table_id", [restaurantA])).rows;
    await expectUserReject("M. Cross-tenant table assignment is rejected atomically", staff.managerA.user,
      "select * from public.assign_waiter_tables($1,$2,$3)", [restaurantA, staff.waiterA1.id, [tablesA[0], tableB]], /active restaurant tables/i);
    const afterCrossTable = (await db.query("select table_id,waiter_staff_id from public.restaurant_table_waiter_assignments where restaurant_id=$1 and active order by table_id", [restaurantA])).rows;
    if (JSON.stringify(beforeCrossTable) !== JSON.stringify(afterCrossTable)) throw new Error("Cross-tenant table rejection changed the active assignment set.");

    await expectUserReject("N. Waiter cannot self-assign tables", staff.waiterA1.user,
      "select * from public.assign_waiter_tables($1,$2,$3)", [restaurantA, staff.waiterA1.id, [tablesA[0]]]);
    await expectUserReject("O. Cashier cannot manage assignments", staff.cashierA.user,
      "select * from public.assign_waiter_tables($1,$2,$3)", [restaurantA, staff.waiterA1.id, [tablesA[0]]]);
    await expectUserReject("P. Chef cannot manage assignments", staff.chefA.user,
      "select * from public.assign_waiter_tables($1,$2,$3)", [restaurantA, staff.waiterA1.id, [tablesA[0]]]);

    await db.query("savepoint anonymous_rejection");
    try {
      await db.query("set local role anon");
      await db.query("select set_config('request.jwt.claim.sub','',true)");
      await db.query("select * from public.assign_waiter_tables($1,$2,$3)", [restaurantA, staff.waiterA1.id, [tablesA[0]]]);
      await db.query("reset role");
      await db.query("rollback to savepoint anonymous_rejection");
      check("Q. Public and anonymous callers are denied", false, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint anonymous_rejection");
      await db.query("reset role");
      check("Q. Public and anonymous callers are denied", /permission denied|Authentication required/i.test(error.message), error.message);
    }

    await db.query("savepoint active_conflict");
    try {
      await db.query(`update public.restaurant_table_waiter_assignments
        set active=true,ended_at=null,ended_by_staff_id=null
        where restaurant_id=$1 and table_id=$2 and waiter_staff_id=$3`,
      [restaurantA, tablesA[2], staff.waiterA1.id]);
      await db.query("rollback to savepoint active_conflict");
      check("R. One table cannot have conflicting active Waiters", false, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint active_conflict");
      check("R. One table cannot have conflicting active Waiters", /restaurant_table_waiter_assignments_active_table_key/i.test(error.message), error.message);
    }

    await asUser(staff.managerA.user, "select * from public.unassign_waiter_tables($1,$2)", [restaurantA, [tablesA[2]]]);
    const unassignedA3 = await db.query("select 1 from public.restaurant_table_waiter_assignments where restaurant_id=$1 and table_id=$2 and active", [restaurantA, tablesA[2]]);
    const occupiedAfterUnassign = (await db.query("select dining_session_status,table_released_at,created_by_waiter_id from public.orders where id=$1", [orderA])).rows[0];
    check("S. Unassignment preserves occupied service and order attribution", unassignedA3.rowCount === 0
      && occupiedAfterUnassign.dining_session_status === "open" && occupiedAfterUnassign.table_released_at === null
      && occupiedAfterUnassign.created_by_waiter_id === staff.waiterA1.id);

    const reassignmentLog = (await db.query(`select performed_by_staff_id,details from public.staff_activity_log
      where restaurant_id=$1 and action='waiter_tables_assigned' and details->>'assignment_action'='reassigned'
        and details->>'table_id'=$2 order by created_at desc limit 1`, [restaurantA, tablesA[2]])).rows[0];
    check("T. Reassignment attribution preserves table, previous/new Waiter, actor, and timestamp", Boolean(reassignmentLog)
      && reassignmentLog.performed_by_staff_id === staff.managerA.id
      && reassignmentLog.details.previous_waiter_staff_id === staff.waiterA1.id
      && reassignmentLog.details.new_waiter_staff_id === staff.waiterA2.id
      && Boolean(reassignmentLog.details.changed_at));

    await db.query("rollback");
    const passed = results.filter((result) => result.ok).length;
    console.log(`${passed}/${results.length} passed; hosted audit rolled back. Realtime publication verified.`);
    if (passed !== results.length) process.exitCode = 1;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
