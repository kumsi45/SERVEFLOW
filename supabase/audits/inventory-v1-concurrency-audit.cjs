const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..", "..");
const url = fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8")
  .split(/\r?\n/).find((line) => /^\s*SUPABASE_DB_URL\s*=/.test(line))
  .replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^[\"']|[\"']$/g, "");
const id = () => crypto.randomUUID();
const connect = async () => {
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  return db;
};
const check = (condition, label, detail = "") => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  console.log(`PASS ${label}${detail ? ` - ${detail}` : ""}`);
};

async function actorClient(userId) {
  const db = await connect();
  await db.query("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  return db;
}

async function main() {
  const setup = await connect();
  const restaurantId = id(), staffId = id(), categoryId = id(), unitId = id(), storageId = id(), itemId = id();
  let userId;
  try {
    userId = (await setup.query("select user_id from public.restaurant_staff where user_id is not null limit 1")).rows[0]?.user_id;
    if (!userId) throw new Error("An authenticated hosted identity is required.");
    const suffix = crypto.randomBytes(5).toString("hex");
    await setup.query("begin");
    await setup.query("insert into public.restaurants(id,name,slug) values($1,'Inventory Concurrency Audit',$2)",
      [restaurantId, `inventory-concurrency-${suffix}`]);
    await setup.query("insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values($1,$2,$3,'inventory_officer','Concurrency Auditor',true)",
      [staffId, restaurantId, userId]);
    await setup.query("insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Audit','active',$3,$3)",
      [categoryId, restaurantId, staffId]);
    await setup.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'kg','active',$3,$3)",
      [unitId, restaurantId, staffId]);
    await setup.query("insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Main','active',$3,$3)",
      [storageId, restaurantId, staffId]);
    await setup.query(`insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,minimum_stock,status,created_by_staff_id,updated_by_staff_id)
      values($1,$2,'Concurrent Coffee','kg',0,0,true,$3,$4,$5,0,'active',$6,$6)`,
      [itemId, restaurantId, categoryId, unitId, storageId, staffId]);
    await setup.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    await setup.query("select public.record_inventory_opening_balance($1,$2,$3,10,null,null,now())", [restaurantId, itemId, storageId]);
    await setup.query("commit");

    const first = await actorClient(userId);
    const second = await actorClient(userId);
    try {
      const calls = [first, second].map((db) => db.query(
        "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_out',6,null,null,null,null,'Concurrency issue',null,null) result",
        [restaurantId, id(), itemId, storageId],
      ));
      const settled = await Promise.allSettled(calls);
      const successes = settled.filter((result) => result.status === "fulfilled").length;
      const failures = settled.filter((result) => result.status === "rejected").length;
      check(successes === 1 && failures === 1, "Two concurrent Issues cannot overdraw stock", `${successes} committed, ${failures} denied`);
    } finally {
      await first.end();
      await second.end();
    }

    await setup.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
    const afterIssue = Number((await setup.query("select public.get_inventory_storage_balance($1,$2,$3) balance",
      [restaurantId, itemId, storageId])).rows[0].balance);
    check(afterIssue === 4, "Concurrent Issue leaves a nonnegative exact balance", `balance=${afterIssue}`);

    const retryKey = id();
    const retryA = await actorClient(userId);
    const retryB = await actorClient(userId);
    try {
      const settled = await Promise.all([retryA, retryB].map((db) => db.query(
        "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_in',1,null,null,null,null,'Concurrent retry',null,null) result",
        [restaurantId, retryKey, itemId, storageId],
      )));
      const already = settled.map((result) => result.rows[0].result.already_processed).sort();
      check(already[0] === false && already[1] === true, "Concurrent same-key retry applies exactly once");
    } finally {
      await retryA.end();
      await retryB.end();
    }
    const finalBalance = Number((await setup.query("select public.get_inventory_storage_balance($1,$2,$3) balance",
      [restaurantId, itemId, storageId])).rows[0].balance);
    const retryMovements = Number((await setup.query(`select count(*) count from public.inventory_movements movement
      join public.inventory_operation_idempotency operation on operation.result_id=movement.id and operation.restaurant_id=movement.restaurant_id
      where operation.restaurant_id=$1 and operation.idempotency_key=$2`, [restaurantId, retryKey])).rows[0].count);
    check(finalBalance === 5 && retryMovements === 1, "Concurrent retry creates one movement and one balance change",
      `balance=${finalBalance}, movements=${retryMovements}`);
  } finally {
    await setup.query("reset role").catch(() => {});
    await setup.query("delete from public.restaurants where id=$1", [restaurantId]).catch(() => {});
    await setup.end();
  }
  console.log("\nRESULT 4/4 PASS");
}

main().catch((error) => {
  console.error(`AUDIT ERROR ${error.message}`);
  process.exitCode = 1;
});
