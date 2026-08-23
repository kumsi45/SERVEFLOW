const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const root = path.join(__dirname, "..", "..");
const env = Object.fromEntries(fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8")
  .split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "249_kitchen_material_request_expansion.sql"), "utf8");
const id = () => crypto.randomUUID();
const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
};

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
      await asUser(userId, sql, params);
      await db.query("rollback to savepoint expected_rejection");
      check(label, false, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint expected_rejection");
      await db.query("reset role");
      check(label, pattern.test(error.message), error.message);
    }
  };
  const expectAnonReject = async (label, sql, params, pattern) => {
    await db.query("savepoint expected_anon_rejection");
    try {
      await db.query("set local role anon");
      await db.query(sql, params);
      await db.query("rollback to savepoint expected_anon_rejection");
      check(label, false, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint expected_anon_rejection");
      await db.query("reset role");
      check(label, pattern.test(error.message), error.message);
    }
  };

  try {
    await db.query("begin");
    if (process.env.AUDIT_APPLY_MIGRATION !== "false") await db.query(migration);

    const identities = (await db.query("select distinct user_id from public.restaurant_staff where user_id is not null limit 7")).rows.map((row) => row.user_id);
    if (identities.length < 7) throw new Error("Hosted audit requires seven existing authenticated identities.");

    const restaurantA = id(), restaurantB = id();
    const stationA = id(), stationB = id();
    const categoryA = id(), categoryB = id(), unitA = id(), unitB = id();
    const storageA = id(), storageB = id(), itemA = id(), itemB = id();
    const staff = {
      managerA: { id: id(), user: identities[0] }, inventoryA: { id: id(), user: identities[1] },
      chefA: { id: id(), user: identities[2] }, waiterA: { id: id(), user: identities[3] },
      cashierA: { id: id(), user: identities[4] }, managerB: { id: id(), user: identities[4] },
      inventoryB: { id: id(), user: identities[5] }, chefB: { id: id(), user: identities[6] },
    };
    const suffix = crypto.randomUUID().slice(0, 8);

    await db.query("insert into public.restaurants(id,name,slug) values($1,'KMR Audit A',$2),($3,'KMR Audit B',$4)",
      [restaurantA, `kmr-a-${suffix}`, restaurantB, `kmr-b-${suffix}`]);
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values
      ($1,$2,$3,'manager','KMR Manager A',true),($4,$2,$5,'inventory_officer','KMR Inventory A',true),
      ($6,$2,$7,'kitchen','KMR Chef A',true),($8,$2,$9,'waiter','KMR Waiter A',true),
      ($10,$2,$11,'cashier','KMR Cashier A',true),($12,$13,$14,'manager','KMR Manager B',true),
      ($15,$13,$16,'inventory_officer','KMR Inventory B',true),($17,$13,$18,'kitchen','KMR Chef B',true)`, [
      staff.managerA.id,restaurantA,staff.managerA.user,staff.inventoryA.id,staff.inventoryA.user,
      staff.chefA.id,staff.chefA.user,staff.waiterA.id,staff.waiterA.user,
      staff.cashierA.id,staff.cashierA.user,staff.managerB.id,restaurantB,staff.managerB.user,
      staff.inventoryB.id,staff.inventoryB.user,staff.chefB.id,staff.chefB.user,
    ]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name) values($1,$2,'KMR Kitchen A'),($3,$4,'KMR Kitchen B')",
      [stationA,restaurantA,stationB,restaurantB]);
    await db.query("update public.restaurant_staff set assigned_kitchen_station_id=$1 where id=$2", [stationA,staff.chefA.id]);
    await db.query("update public.restaurant_staff set assigned_kitchen_station_id=$1 where id=$2", [stationB,staff.chefB.id]);
    await db.query("insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'KMR Category A','active',$3,$3),($4,$5,'KMR Category B','active',$6,$6)",
      [categoryA,restaurantA,staff.inventoryA.id,categoryB,restaurantB,staff.inventoryB.id]);
    await db.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'piece','active',$3,$3),($4,$5,'piece','active',$6,$6)",
      [unitA,restaurantA,staff.inventoryA.id,unitB,restaurantB,staff.inventoryB.id]);
    await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'KMR Store A','active',$3,$3),($4,$5,'KMR Store B','active',$6,$6)",
      [storageA,restaurantA,staff.inventoryA.id,storageB,restaurantB,staff.inventoryB.id]);
    await db.query(`insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,minimum_stock,status,created_by_staff_id,updated_by_staff_id)
      values($1,$2,'KMR Flour A','piece',10,2,true,$3,$4,$5,2,'active',$6,$6),
      ($7,$8,'KMR Flour B','piece',10,2,true,$9,$10,$11,2,'active',$12,$12)`,
      [itemA,restaurantA,categoryA,unitA,storageA,staff.inventoryA.id,itemB,restaurantB,categoryB,unitB,storageB,staff.inventoryB.id]);
    await asUser(staff.inventoryA.user,"select public.record_inventory_opening_balance($1,$2,$3,10,'KMR-OPEN-A','Rollback audit')",[restaurantA,itemA,storageA]);
    await asUser(staff.inventoryB.user,"select public.record_inventory_opening_balance($1,$2,$3,10,'KMR-OPEN-B','Rollback audit')",[restaurantB,itemB,storageB]);

    const ingredientId = (await asUser(staff.chefA.user,
      "select public.create_kitchen_inventory_request($1,'forged',2,'forged','high',$2,'Ingredient',$3,'ingredient') id",
      [restaurantA,stationA,itemA])).rows[0].id;
    const ingredient = (await db.query("select * from public.kitchen_inventory_requests where id=$1",[ingredientId])).rows[0];
    check("Same-tenant ingredient request succeeds", ingredient.request_type === "ingredient" && ingredient.item_name === "KMR Flour A" && ingredient.unit === "piece");

    const toolId = (await asUser(staff.chefA.user,
      "select public.create_kitchen_inventory_request($1,'Metal tray',3,'PIECE','normal',$2,'Service prep',null,'tool') id",
      [restaurantA,stationA])).rows[0].id;
    const tool = (await db.query("select * from public.kitchen_inventory_requests where id=$1",[toolId])).rows[0];
    check("Same-tenant tool free-text request succeeds", tool.request_type === "tool" && tool.inventory_item_id === null && tool.item_name === "Metal tray" && tool.unit === "piece");

    const cleaningId = (await asUser(staff.chefA.user,
      "select public.create_kitchen_inventory_request($1,'Cleaning brush',1,'pack','normal',$2,'Cleaning need',null,'cleaning') id",
      [restaurantA,stationA])).rows[0].id;
    check("Same-tenant cleaning request succeeds", Boolean(cleaningId));

    await expectReject("Cross-tenant inventory item is rejected",staff.chefA.user,
      "select public.create_kitchen_inventory_request($1,'x',1,'piece','normal',$2,null,$3,'ingredient')",
      [restaurantA,stationA,itemB],/Inventory item is invalid/i);
    await expectReject("Cross-tenant station is rejected",staff.chefA.user,
      "select public.create_kitchen_inventory_request($1,'Tray',1,'piece','normal',$2,null,null,'tool')",
      [restaurantA,stationB],/Station is invalid/i);
    await expectReject("Waiter creation is denied",staff.waiterA.user,
      "select public.create_kitchen_inventory_request($1,'Tray',1,'piece','normal',$2,null,null,'tool')",
      [restaurantA,stationA],/access denied/i);
    await expectReject("Cashier creation is denied",staff.cashierA.user,
      "select public.create_kitchen_inventory_request($1,'Tray',1,'piece','normal',$2,null,null,'tool')",
      [restaurantA,stationA],/access denied/i);
    await expectAnonReject("Anonymous creation is denied",
      "select public.create_kitchen_inventory_request($1,'Tray',1,'piece','normal',$2,null,null,'tool')",
      [restaurantA,stationA],/permission denied/i);

    const movementBeforeApproval = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1",[restaurantA])).rows[0].count);
    await asUser(staff.managerA.user,"select public.process_kitchen_inventory_request($1,$2,'accept',null)",[restaurantA,toolId]);
    const approvedTool = (await db.query("select status from public.kitchen_inventory_requests where id=$1",[toolId])).rows[0];
    check("Manager approval works for a non-ingredient", approvedTool.status === "accepted");
    const movementAfterApproval = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1",[restaurantA])).rows[0].count);
    check("Manager approval creates no stock movement", movementAfterApproval === movementBeforeApproval);
    const queue = (await asUser(staff.inventoryA.user,"select * from public.get_inventory_kitchen_request_queue($1)",[restaurantA])).rows;
    check("Inventory queue includes approved free-text material", queue.some((row) => row.request_id === toolId && row.request_type === "tool" && row.inventory_item_id === null));

    await asUser(staff.managerA.user,"select public.process_kitchen_inventory_request($1,$2,'accept',null)",[restaurantA,ingredientId]);
    const movementId = (await asUser(staff.inventoryA.user,"select public.issue_kitchen_inventory_request($1,$2) id",[restaurantA,ingredientId])).rows[0].id;
    check("Inventory-backed issue creates exactly one stock-out", Number((await db.query("select count(*) count from public.inventory_movements where id=$1 and movement_type='stock_out'",[movementId])).rows[0].count) === 1);
    await expectReject("Repeated inventory issue is rejected",staff.inventoryA.user,
      "select public.issue_kitchen_inventory_request($1,$2)",[restaurantA,ingredientId],/already issued|not awaiting/i);

    const freeMovementBefore = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1",[restaurantA])).rows[0].count);
    await expectReject("Free-text material cannot create fake stock movement",staff.inventoryA.user,
      "select public.issue_kitchen_inventory_request($1,$2)",[restaurantA,toolId],/Inventory link is required/i);
    const freeMovementAfter = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1",[restaurantA])).rows[0].count);
    check("Free-text issue attempt leaves stock ledger unchanged", freeMovementAfter === freeMovementBefore);
    await asUser(staff.inventoryA.user,"select public.mark_kitchen_inventory_request_unable_to_fulfill($1,$2,'Requires purchasing')",[restaurantA,toolId]);
    check("Cannot Fulfill works for non-stock material", (await db.query("select status from public.kitchen_inventory_requests where id=$1",[toolId])).rows[0].status === "unable_to_fulfill");

    const beforeConfirm = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1",[restaurantA])).rows[0].count);
    await asUser(staff.chefA.user,"select public.confirm_kitchen_inventory_request_receipt($1,$2)",[restaurantA,ingredientId]);
    const confirmed = (await db.query("select status from public.kitchen_inventory_requests where id=$1",[ingredientId])).rows[0];
    const afterConfirm = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1",[restaurantA])).rows[0].count);
    check("Kitchen confirms legitimately issued inventory material", confirmed.status === "delivered" && beforeConfirm === afterConfirm);

    const createdEvent = (await db.query("select details from public.inventory_request_events where request_id=$1 and event_type='created'",[toolId])).rows[0];
    check("Event history preserves request type and material", createdEvent.details.request_type === "tool" && createdEvent.details.item_name === "Metal tray");
    check("Request row preserves complete requested provenance", tool.requested_by_staff_id === staff.chefA.id && tool.station_id === stationA && Number(tool.quantity) === 3);

    const tenantBRead = await asUser(staff.managerB.user,"select id from public.kitchen_inventory_requests where id=$1",[toolId]);
    check("Tenant B cannot read Tenant A free-text request", tenantBRead.rowCount === 0);
    await expectReject("Tenant B Manager cannot approve Tenant A request",staff.managerB.user,
      "select public.process_kitchen_inventory_request($1,$2,'accept',null)",[restaurantA,cleaningId],/access denied/i);
    await expectReject("Tenant B Inventory cannot open Tenant A queue",staff.inventoryB.user,
      "select * from public.get_inventory_kitchen_request_queue($1)",[restaurantA],/access denied/i);

    const legacyId = (await asUser(staff.chefA.user,
      "select public.create_kitchen_inventory_request($1,'legacy',1,'legacy','normal',$2,null,$3) id",
      [restaurantA,stationA,itemA])).rows[0].id;
    check("Legacy inventory-backed create call infers ingredient", (await db.query("select request_type from public.kitchen_inventory_requests where id=$1",[legacyId])).rows[0].request_type === "ingredient");
    const publication = Number((await db.query("select count(*) count from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kitchen_inventory_requests'")).rows[0].count);
    check("Existing realtime publication remains present", publication === 1);
    const rls = (await db.query("select relrowsecurity from pg_class where oid='public.kitchen_inventory_requests'::regclass")).rows[0];
    check("Request table RLS remains enabled", rls.relrowsecurity === true);

    await db.query("rollback");
  } catch (error) {
    try { await db.query("rollback"); } catch {}
    throw error;
  } finally {
    await db.end();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`RESULT ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`AUDIT ERROR ${error.message}`);
  process.exitCode = 1;
});
