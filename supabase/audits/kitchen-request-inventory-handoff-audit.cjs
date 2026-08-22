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
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "242_kitchen_request_inventory_handoff.sql"), "utf8");
const id = () => crypto.randomUUID();
const results = [];
const check = (label, ok, detail = "") => {
  const result = { label, ok: Boolean(ok), detail };
  results.push(result);
  console.log(`${result.ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
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

  try {
    await db.query("begin");
    await db.query(migration);

    const identities = (await db.query("select distinct user_id from public.restaurant_staff where user_id is not null limit 7")).rows.map((row) => row.user_id);
    if (identities.length < 7) throw new Error("Hosted audit requires seven existing authenticated identities.");

    const restaurantA = id(), restaurantB = id();
    const stationA = id(), stationB = id();
    const categoryA = id(), categoryB = id(), unitA = id(), unitB = id(), storageA = id(), storageB = id();
    const itemA = id(), itemB = id();
    const staff = {
      managerA: { id: id(), user: identities[0] }, inventoryA: { id: id(), user: identities[1] }, chefA: { id: id(), user: identities[2] }, waiterA: { id: id(), user: identities[3] },
      managerB: { id: id(), user: identities[4] }, inventoryB: { id: id(), user: identities[5] }, chefB: { id: id(), user: identities[6] },
    };
    const suffix = crypto.randomUUID().slice(0, 8);

    await db.query("insert into public.restaurants(id,name,slug) values($1,'Kitchen Handoff Audit A',$2),($3,'Kitchen Handoff Audit B',$4)",
      [restaurantA, `kitchen-handoff-a-${suffix}`, restaurantB, `kitchen-handoff-b-${suffix}`]);
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values
      ($1,$2,$3,'manager','Audit Manager A',true),($4,$2,$5,'inventory_officer','Audit Inventory A',true),
      ($6,$2,$7,'kitchen','Audit Chef A',true),($8,$2,$9,'waiter','Audit Waiter A',true),
      ($10,$11,$12,'manager','Audit Manager B',true),($13,$11,$14,'inventory_officer','Audit Inventory B',true),
      ($15,$11,$16,'kitchen','Audit Chef B',true)`, [
      staff.managerA.id, restaurantA, staff.managerA.user, staff.inventoryA.id, staff.inventoryA.user,
      staff.chefA.id, staff.chefA.user, staff.waiterA.id, staff.waiterA.user,
      staff.managerB.id, restaurantB, staff.managerB.user, staff.inventoryB.id, staff.inventoryB.user,
      staff.chefB.id, staff.chefB.user,
    ]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name) values($1,$2,'Audit Kitchen A'),($3,$4,'Audit Kitchen B')", [stationA, restaurantA, stationB, restaurantB]);
    await db.query("insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Audit Category A','active',$3,$3),($4,$5,'Audit Category B','active',$6,$6)", [categoryA, restaurantA, staff.inventoryA.id, categoryB, restaurantB, staff.inventoryB.id]);
    await db.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'kg','active',$3,$3),($4,$5,'kg','active',$6,$6)", [unitA, restaurantA, staff.inventoryA.id, unitB, restaurantB, staff.inventoryB.id]);
    await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Audit Store A','active',$3,$3),($4,$5,'Audit Store B','active',$6,$6)", [storageA, restaurantA, staff.inventoryA.id, storageB, restaurantB, staff.inventoryB.id]);
    await db.query(`insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,minimum_stock,status,created_by_staff_id,updated_by_staff_id)
      values($1,$2,'Audit Sugar A','kg',10,2,true,$3,$4,$5,2,'active',$6,$6),($7,$8,'Audit Sugar B','kg',10,2,true,$9,$10,$11,2,'active',$12,$12)`,
      [itemA, restaurantA, categoryA, unitA, storageA, staff.inventoryA.id, itemB, restaurantB, categoryB, unitB, storageB, staff.inventoryB.id]);

    await asUser(staff.inventoryA.user, "select public.record_inventory_opening_balance($1,$2,$3,10,'AUDIT-OPEN-A','Rollback audit')", [restaurantA, itemA, storageA]);
    await asUser(staff.inventoryB.user, "select public.record_inventory_opening_balance($1,$2,$3,10,'AUDIT-OPEN-B','Rollback audit')", [restaurantB, itemB, storageB]);
    const beforeFinancial = (await db.query("select (select count(*) from public.orders where restaurant_id=any($1)) orders,(select count(*) from public.order_invoices where restaurant_id=any($1)) invoices", [[restaurantA, restaurantB]])).rows[0];

    const requestId = (await asUser(staff.chefA.user, "select public.create_kitchen_inventory_request($1,'forged name',3,'forged unit','high',$2,'Audit beverage demand',$3) id", [restaurantA, stationA, itemA])).rows[0].id;
    const created = (await db.query("select * from public.kitchen_inventory_requests where id=$1", [requestId])).rows[0];
    check("Chef A creates Tenant A canonical request", created.status === "pending" && created.requested_by_staff_id === staff.chefA.id && created.item_name === "Audit Sugar A" && created.unit === "kg");

    const balanceBeforeApproval = Number((await asUser(staff.inventoryA.user, "select public.get_inventory_storage_balance($1,$2,$3) balance", [restaurantA, itemA, storageA])).rows[0].balance);
    const movementsBeforeApproval = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1 and inventory_item_id=$2", [restaurantA, itemA])).rows[0].count);
    await asUser(staff.managerA.user, "select public.process_kitchen_inventory_request($1,$2,'accept',null)", [restaurantA, requestId]);
    await expectReject("Manager B cannot approve Tenant A request", staff.managerB.user, "select public.process_kitchen_inventory_request($1,$2,'accept',null)", [restaurantA, requestId], /access denied|already handled/i);
    const approved = (await db.query("select * from public.kitchen_inventory_requests where id=$1", [requestId])).rows[0];
    const balanceAfterApproval = Number((await asUser(staff.inventoryA.user, "select public.get_inventory_storage_balance($1,$2,$3) balance", [restaurantA, itemA, storageA])).rows[0].balance);
    const movementsAfterApproval = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1 and inventory_item_id=$2", [restaurantA, itemA])).rows[0].count);
    check("Manager approval records Awaiting Inventory attribution", approved.status === "accepted" && approved.reviewed_by_staff_id === staff.managerA.id && approved.reviewed_at && approved.requested_by_staff_id === staff.chefA.id);
    check("Manager approval does not change stock or create movement", balanceBeforeApproval === balanceAfterApproval && movementsBeforeApproval === movementsAfterApproval);

    const queueA = (await asUser(staff.inventoryA.user, "select * from public.get_inventory_kitchen_request_queue($1)", [restaurantA])).rows;
    check("Inventory A sees approved Tenant A request", queueA.length === 1 && queueA[0].request_id === requestId && Number(queueA[0].current_quantity) === 10);
    await expectReject("Inventory B cannot open Tenant A queue", staff.inventoryB.user, "select * from public.get_inventory_kitchen_request_queue($1)", [restaurantA], /access denied/i);
    await expectReject("Waiter cannot open Inventory queue", staff.waiterA.user, "select * from public.get_inventory_kitchen_request_queue($1)", [restaurantA], /access denied/i);
    const crossTenantRows = await asUser(staff.inventoryB.user, "select id from public.kitchen_inventory_requests where id=$1", [requestId]);
    check("RLS hides Tenant A request from Inventory B", crossTenantRows.rowCount === 0);

    const movementId = (await asUser(staff.inventoryA.user, "select public.issue_kitchen_inventory_request($1,$2) id", [restaurantA, requestId])).rows[0].id;
    const issued = (await db.query("select * from public.kitchen_inventory_requests where id=$1", [requestId])).rows[0];
    const movement = (await db.query("select * from public.inventory_movements where id=$1", [movementId])).rows[0];
    const balanceAfterIssue = Number((await asUser(staff.inventoryA.user, "select public.get_inventory_storage_balance($1,$2,$3) balance", [restaurantA, itemA, storageA])).rows[0].balance);
    check("Inventory issue transitions to awaiting Kitchen confirmation", issued.status === "issued" && issued.issued_by_staff_id === staff.inventoryA.id && issued.issued_at && Number(issued.issued_quantity) === 3);
    check("Inventory issue creates exactly one linked canonical stock-out", movement && movement.movement_type === "stock_out" && movement.quantity_effect === "out" && Number(movement.quantity) === 3 && issued.inventory_movement_id === movement.id);
    check("Inventory issue deducts the exact canonical quantity once", balanceAfterIssue === 7 && movementsAfterApproval + 1 === Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1 and inventory_item_id=$2", [restaurantA, itemA])).rows[0].count));
    await expectReject("Repeated issue is rejected", staff.inventoryA.user, "select public.issue_kitchen_inventory_request($1,$2)", [restaurantA, requestId], /already issued|not awaiting/i);
    check("Issued request leaves the actionable Inventory queue", (await asUser(staff.inventoryA.user, "select * from public.get_inventory_kitchen_request_queue($1)", [restaurantA])).rowCount === 0);

    await expectReject("Chef B cannot confirm Tenant A receipt", staff.chefB.user, "select public.confirm_kitchen_inventory_request_receipt($1,$2)", [restaurantA, requestId], /access denied/i);
    const movementCountBeforeConfirmation = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1 and inventory_item_id=$2", [restaurantA, itemA])).rows[0].count);
    await asUser(staff.chefA.user, "select public.confirm_kitchen_inventory_request_receipt($1,$2)", [restaurantA, requestId]);
    const confirmed = (await db.query("select * from public.kitchen_inventory_requests where id=$1", [requestId])).rows[0];
    const balanceAfterConfirmation = Number((await asUser(staff.inventoryA.user, "select public.get_inventory_storage_balance($1,$2,$3) balance", [restaurantA, itemA, storageA])).rows[0].balance);
    check("Chef A confirmation finalizes Fulfilled with attribution", confirmed.status === "delivered" && confirmed.confirmed_by_staff_id === staff.chefA.id && confirmed.confirmed_at && confirmed.delivered_at);
    check("Kitchen confirmation does not deduct stock again", balanceAfterConfirmation === 7 && movementCountBeforeConfirmation === Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1 and inventory_item_id=$2", [restaurantA, itemA])).rows[0].count));
    await expectReject("Repeated confirmation is rejected", staff.chefA.user, "select public.confirm_kitchen_inventory_request_receipt($1,$2)", [restaurantA, requestId], /already confirmed|not awaiting/i);

    const unableRequest = (await asUser(staff.chefA.user, "select public.create_kitchen_inventory_request($1,'ignored',2,'ignored','normal',$2,null,$3) id", [restaurantA, stationA, itemA])).rows[0].id;
    await asUser(staff.managerA.user, "select public.process_kitchen_inventory_request($1,$2,'accept',null)", [restaurantA, unableRequest]);
    await expectReject("Cannot Fulfill requires reason", staff.inventoryA.user, "select public.mark_kitchen_inventory_request_unable_to_fulfill($1,$2,$3)", [restaurantA, unableRequest, ""], /reason is required/i);
    const movementCountBeforeUnable = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1", [restaurantA])).rows[0].count);
    await asUser(staff.inventoryA.user, "select public.mark_kitchen_inventory_request_unable_to_fulfill($1,$2,$3)", [restaurantA, unableRequest, "Supplier delivery delayed"]);
    const unable = (await db.query("select * from public.kitchen_inventory_requests where id=$1", [unableRequest])).rows[0];
    check("Cannot Fulfill records terminal reason and actor without movement", unable.status === "unable_to_fulfill" && unable.unable_to_fulfill_by_staff_id === staff.inventoryA.id && unable.unable_to_fulfill_reason === "Supplier delivery delayed" && movementCountBeforeUnable === Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1", [restaurantA])).rows[0].count));

    const eventTypes = (await db.query("select event_type from public.inventory_request_events where request_id=$1 order by created_at,id", [requestId])).rows.map((row) => row.event_type);
    check("Immutable request event chain preserves created, accepted, issued, confirmed", ["created", "accepted", "issued", "confirmed"].every((event) => eventTypes.includes(event)));
    const publication = (await db.query("select count(*) count from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kitchen_inventory_requests'")).rows[0].count;
    check("Request updates use the RLS-protected realtime publication", publication === "1");
    const afterFinancial = (await db.query("select (select count(*) from public.orders where restaurant_id=any($1)) orders,(select count(*) from public.order_invoices where restaurant_id=any($1)) invoices", [[restaurantA, restaurantB]])).rows[0];
    check("Order and financial records remain untouched", beforeFinancial.orders === afterFinancial.orders && beforeFinancial.invoices === afterFinancial.invoices);

    await db.query("rollback");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} hosted rollback checks passed`);
  if (passed !== results.length) process.exit(1);
}

main().catch((error) => {
  console.error(`FAIL hosted rollback audit crashed — ${error.message}${error.where ? ` — ${error.where}` : ""}`);
  process.exit(1);
});
