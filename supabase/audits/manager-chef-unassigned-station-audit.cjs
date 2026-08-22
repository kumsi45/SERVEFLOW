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
const migration = fs.readFileSync("supabase/migrations/241_manager_chef_creation_without_station.sql", "utf8");
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
  const expectReject = async (label, userId, sql, params, pattern) => {
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
    await db.query(migration);

    const users = (await db.query("select distinct user_id from public.restaurant_staff where user_id is not null limit 6"))
      .rows.map((row) => row.user_id);
    if (users.length < 6) throw new Error("Hosted audit requires six existing authenticated identities.");

    const restaurantA = id();
    const restaurantB = id();
    const stationA = id();
    const stationB = id();
    const staff = {
      managerA: { id: id(), user: users[0] },
      chefA: { id: id(), user: users[1] },
      assignedChefA: { id: id(), user: users[2] },
      managerB: { id: id(), user: users[3] },
      waiterA: { id: id(), user: users[4] },
      ownerA: { id: id(), user: users[5] },
    };
    const suffix = crypto.randomUUID().slice(0, 8);

    await db.query(
      "insert into public.restaurants(id,name,slug) values($1,'Chef Assignment Audit A',$2),($3,'Chef Assignment Audit B',$4)",
      [restaurantA, `chef-assignment-a-${suffix}`, restaurantB, `chef-assignment-b-${suffix}`],
    );
    await db.query(
      "insert into public.kitchen_stations(id,restaurant_id,name,priority,active) values($1,$2,'Station A',1,true),($3,$4,'Station B',1,true)",
      [stationA, restaurantA, stationB, restaurantB],
    );
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active,assigned_kitchen_station_id) values
      ($1,$2,$3,'manager','Audit Manager A',true,null),
      ($4,$2,$5,'kitchen','Audit Chef A',true,null),
      ($6,$2,$7,'kitchen','Audit Assigned Chef A',true,$8),
      ($9,$10,$11,'manager','Audit Manager B',true,null),
      ($12,$2,$13,'waiter','Audit Waiter A',true,null),
      ($14,$2,$15,'owner','Audit Owner A',true,null)`, [
      staff.managerA.id, restaurantA, staff.managerA.user,
      staff.chefA.id, staff.chefA.user,
      staff.assignedChefA.id, staff.assignedChefA.user, stationA,
      staff.managerB.id, restaurantB, staff.managerB.user,
      staff.waiterA.id, staff.waiterA.user,
      staff.ownerA.id, staff.ownerA.user,
    ]);

    const trigger = await db.query("select 1 from pg_trigger where tgrelid='public.restaurant_staff'::regclass and tgname='assign_default_kitchen_station_to_staff' and not tgisinternal");
    const createdChef = (await db.query("select assigned_kitchen_station_id from public.restaurant_staff where id=$1", [staff.chefA.id])).rows[0];
    check("Chef creation with no station remains NULL", createdChef.assigned_kitchen_station_id === null);
    check("Forced Main Kitchen staff trigger is absent", trigger.rowCount === 0);

    const context = (await asUser(staff.chefA.user, "select public.get_kitchen_dashboard_context($1) context", [restaurantA])).rows[0].context;
    const afterContext = (await db.query("select assigned_kitchen_station_id from public.restaurant_staff where id=$1", [staff.chefA.id])).rows[0];
    check("Unassigned Chef receives honest Kitchen context", context.role === "kitchen" && context.assignedStation === null && context.restaurant.id === restaurantA);
    check("Kitchen context does not mutate assignment", afterContext.assigned_kitchen_station_id === null);

    await expectReject(
      "Unassigned Chef station queue is rejected clearly",
      staff.chefA.user,
      "select * from public.get_station_kitchen_orders($1,null,false,false)",
      [restaurantA],
      /Kitchen station assignment required/i,
    );
    const afterRejectedQueue = (await db.query("select assigned_kitchen_station_id from public.restaurant_staff where id=$1", [staff.chefA.id])).rows[0];
    check("Rejected station operation does not auto-assign", afterRejectedQueue.assigned_kitchen_station_id === null);

    await db.query("update public.restaurant_staff set assigned_kitchen_station_id=$1 where id=$2 and restaurant_id=$3", [stationA, staff.chefA.id, restaurantA]);
    const assigned = (await db.query("select assigned_kitchen_station_id from public.restaurant_staff where id=$1", [staff.chefA.id])).rows[0];
    check("Explicit same-tenant assignment persists", assigned.assigned_kitchen_station_id === stationA);
    const assignedContext = (await asUser(staff.chefA.user, "select public.get_kitchen_dashboard_context($1) context", [restaurantA])).rows[0].context;
    check("Assigned Chef Kitchen context remains intact", assignedContext.assignedStation?.id === stationA);
    const assignedQueue = await asUser(staff.chefA.user, "select * from public.get_station_kitchen_orders($1,null,false,false)", [restaurantA]);
    check("Assigned Chef station queue remains available", assignedQueue.rowCount === 0);

    await db.query("update public.restaurant_staff set assigned_kitchen_station_id=null where id=$1 and restaurant_id=$2", [staff.chefA.id, restaurantA]);
    const unassigned = (await db.query("select assigned_kitchen_station_id from public.restaurant_staff where id=$1", [staff.chefA.id])).rows[0];
    check("Explicit database unassignment remains NULL", unassigned.assigned_kitchen_station_id === null);

    await db.query("savepoint cross_tenant_station");
    try {
      await db.query("update public.restaurant_staff set assigned_kitchen_station_id=$1 where id=$2 and restaurant_id=$3", [stationB, staff.chefA.id, restaurantA]);
      await db.query("rollback to savepoint cross_tenant_station");
      check("Cross-tenant station assignment is rejected", false, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint cross_tenant_station");
      check("Cross-tenant station assignment is rejected", /foreign key|constraint/i.test(error.message), error.message);
    }

    const managerBUpdate = await asUser(
      staff.managerB.user,
      "update public.restaurant_staff set assigned_kitchen_station_id=$1 where id=$2 and restaurant_id=$3 returning id",
      [stationA, staff.chefA.id, restaurantA],
    );
    check("Manager B cannot directly assign Tenant A Chef", managerBUpdate.rowCount === 0);
    const waiterUpdate = await asUser(
      staff.waiterA.user,
      "update public.restaurant_staff set assigned_kitchen_station_id=$1 where id=$2 and restaurant_id=$3 returning id",
      [stationA, staff.chefA.id, restaurantA],
    );
    check("Waiter cannot directly assign Chef", waiterUpdate.rowCount === 0);

    const existingAssigned = (await db.query("select assigned_kitchen_station_id from public.restaurant_staff where id=$1", [staff.assignedChefA.id])).rows[0];
    check("Existing explicit Chef assignment is preserved", existingAssigned.assigned_kitchen_station_id === stationA);

    const ownerContext = (await asUser(staff.ownerA.user, "select public.get_kitchen_dashboard_context($1) context", [restaurantA])).rows[0].context;
    const mainKitchenCount = Number((await db.query("select count(*) count from public.kitchen_stations where restaurant_id=$1 and lower(btrim(name))='main kitchen'", [restaurantA])).rows[0].count);
    check("Owner Kitchen configuration remains station-aware", ownerContext.role === "owner" && ownerContext.stations.some((station) => station.id === stationA));
    check("Owner Main Kitchen configuration creation remains intact", mainKitchenCount === 1);

    const fakeUnassigned = Number((await db.query("select count(*) count from public.kitchen_stations where restaurant_id=$1 and lower(btrim(name)) like '%unassign%'", [restaurantA])).rows[0].count);
    check("No fake Unassigned station record is created", fakeUnassigned === 0);

    await db.query("rollback");
    const passed = results.filter((result) => result.ok).length;
    console.log(`${passed}/${results.length} passed; hosted audit rolled back.`);
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
