const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..", "..");
const connection = fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8")
  .split(/\r?\n/).find((line) => /^\s*SUPABASE_DB_URL\s*=/.test(line))
  .replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^[\"']|[\"']$/g, "");
const migration = [
  "253_inventory_operation_concurrency_idempotency.sql",
  "254_inventory_internal_seed_execution_hardening.sql",
].map((name) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8")).join("\n");
const id = () => crypto.randomUUID();
const results = [];
const check = (condition, label, detail = "") => {
  results.push(Boolean(condition));
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
};

async function main() {
  const db = new Client({ connectionString: connection, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const asUser = async (userId, sql, params = []) => {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    const result = await db.query(sql, params);
    await db.query("reset role");
    return result;
  };
  const reject = async (label, userId, sql, params = []) => {
    await db.query("savepoint expected_reject");
    try {
      await asUser(userId, sql, params);
      await db.query("rollback to savepoint expected_reject");
      check(false, label, "unexpected success");
    } catch (error) {
      await db.query("rollback to savepoint expected_reject");
      await db.query("reset role");
      check(true, label, error.message);
    }
  };

  try {
    await db.query("begin");
    if (process.env.AUDIT_APPLY_MIGRATION !== "false") await db.query(migration);

    const users = (await db.query("select distinct user_id from public.restaurant_staff where user_id is not null limit 7"))
      .rows.map((row) => row.user_id);
    if (users.length < 7) throw new Error("Seven hosted authenticated identities are required.");
    const restaurantA = id(), restaurantB = id(), suffix = crypto.randomBytes(4).toString("hex");
    const staff = {
      ownerA: { id: id(), user: users[0] }, managerA: { id: id(), user: users[1] },
      inventoryA: { id: id(), user: users[2] }, chefA: { id: id(), user: users[3] },
      waiterA: { id: id(), user: users[4] }, inventoryB: { id: id(), user: users[5] },
      inactiveA: { id: id(), user: users[6] },
    };
    const categoryA = id(), categoryB = id(), unitA = id(), unitB = id();
    const mainA = id(), kitchenA = id(), storageB = id(), supplierA = id(), supplierB = id();
    const itemA = id(), itemB = id(), stationA = id();

    await db.query("insert into public.restaurants(id,name,slug) values($1,'Inventory Freeze A',$2),($3,'Inventory Freeze B',$4)",
      [restaurantA, `inventory-freeze-a-${suffix}`, restaurantB, `inventory-freeze-b-${suffix}`]);
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values
      ($1,$2,$3,'owner','Freeze Owner A',true),($4,$2,$5,'manager','Freeze Manager A',true),
      ($6,$2,$7,'inventory_officer','Freeze Inventory A',true),($8,$2,$9,'kitchen','Freeze Chef A',true),
      ($10,$2,$11,'waiter','Freeze Waiter A',true),($12,$13,$14,'inventory_officer','Freeze Inventory B',true),
      ($15,$2,$16,'inventory_officer','Freeze Inactive A',false)`, [
      staff.ownerA.id, restaurantA, staff.ownerA.user, staff.managerA.id, staff.managerA.user,
      staff.inventoryA.id, staff.inventoryA.user, staff.chefA.id, staff.chefA.user,
      staff.waiterA.id, staff.waiterA.user, staff.inventoryB.id, restaurantB, staff.inventoryB.user,
      staff.inactiveA.id, staff.inactiveA.user,
    ]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name) values($1,$2,'Freeze Kitchen')", [stationA, restaurantA]);
    await db.query("update public.restaurant_staff set assigned_kitchen_station_id=$1 where id=$2", [stationA, staff.chefA.id]);
    await db.query("insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Coffee','active',$3,$3),($4,$5,'Other','active',$6,$6)",
      [categoryA, restaurantA, staff.ownerA.id, categoryB, restaurantB, staff.inventoryB.id]);
    await db.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'kg','active',$3,$3),($4,$5,'kg','active',$6,$6)",
      [unitA, restaurantA, staff.ownerA.id, unitB, restaurantB, staff.inventoryB.id]);
    await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Main Store','active',$3,$3),($4,$2,'Kitchen Store','active',$3,$3),($5,$6,'Foreign Store','active',$7,$7)",
      [mainA, restaurantA, staff.ownerA.id, kitchenA, storageB, restaurantB, staff.inventoryB.id]);
    await db.query("insert into public.inventory_suppliers(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Coffee Supplier','active',$3,$3),($4,$5,'Foreign Supplier','active',$6,$6)",
      [supplierA, restaurantA, staff.ownerA.id, supplierB, restaurantB, staff.inventoryB.id]);
    await db.query(`insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,preferred_supplier_id,minimum_stock,status,created_by_staff_id,updated_by_staff_id)
      values($1,$2,'Coffee','kg',0,0,true,$3,$4,$5,$6,0,'active',$7,$7),
      ($8,$9,'Foreign Coffee','kg',0,0,true,$10,$11,$12,$13,0,'active',$14,$14)`,
      [itemA, restaurantA, categoryA, unitA, mainA, supplierA, staff.ownerA.id,
        itemB, restaurantB, categoryB, unitB, storageB, supplierB, staff.inventoryB.id]);

    const inventoryTables = ["inventory_categories", "inventory_suppliers", "inventory_storage_locations", "inventory_units",
      "inventory_items", "inventory_movements", "purchase_orders", "purchase_order_items", "purchase_order_receipts",
      "purchase_order_receipt_items", "inventory_adjustments", "inventory_adjustment_items", "kitchen_inventory_requests",
      "inventory_request_events", "inventory_operation_idempotency"];
    const rlsRows = (await db.query(`select table_class.relname from pg_class table_class join pg_namespace namespace on namespace.oid=table_class.relnamespace
      where namespace.nspname='public' and table_class.relname=any($1) and table_class.relrowsecurity`, [inventoryTables])).rows;
    const rlsNames = new Set(rlsRows.map((row) => row.relname));
    const missingRls = inventoryTables.filter((table) => !rlsNames.has(table));
    check(missingRls.length === 0, "RLS is enabled on every audited Inventory table",
      missingRls.length ? `missing: ${missingRls.join(", ")}` : `${rlsRows.length}/${inventoryTables.length}`);
    const unsafeDefiners = (await db.query(`select procedure.proname from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public' and procedure.prosecdef and (procedure.proname like '%inventory%' or procedure.proname like '%purchase%')
        and not ('search_path=public'=any(coalesce(procedure.proconfig,array[]::text[])))`)).rows;
    check(unsafeDefiners.length === 0, "Inventory SECURITY DEFINER functions use fixed public search_path");
    const anonDefiners = (await db.query(`select procedure.proname from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public' and procedure.prosecdef and (procedure.proname like '%inventory%' or procedure.proname like '%purchase%')
        and has_function_privilege('anon',procedure.oid,'execute')`)).rows;
    check(anonDefiners.length === 0, "Anonymous has no Inventory SECURITY DEFINER execution grants");
    const publications = Number((await db.query(`select count(*) count from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename=any($1)`, [["inventory_movements", "kitchen_inventory_requests"]])).rows[0].count);
    check(publications === 2, "Movement and Kitchen Request realtime publications are present");

    await asUser(staff.inventoryA.user, "select public.record_inventory_opening_balance($1,$2,$3,100,null,null,now())", [restaurantA, itemA, mainA]);
    await asUser(staff.inventoryA.user, "select public.record_inventory_opening_balance($1,$2,$3,0.001,null,null,now())", [restaurantA, itemA, kitchenA]);
    const receiveKey = id();
    const receiveArgs = [restaurantA, receiveKey, itemA, mainA, "stock_in", 20, null, supplierA, null, null, "Freeze receive", null, null];
    const receive = (await asUser(staff.inventoryA.user,
      "select public.record_inventory_movement_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) result", receiveArgs)).rows[0].result;
    const retry = (await asUser(staff.inventoryA.user,
      "select public.record_inventory_movement_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) result", receiveArgs)).rows[0].result;
    check(!receive.already_processed && retry.already_processed, "Receive retry is idempotent");
    await asUser(staff.inventoryA.user,
      "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_out',10,null,null,null,null,'Freeze issue',null,null)",
      [restaurantA, id(), itemA, mainA]);
    await asUser(staff.inventoryA.user,
      "select public.record_inventory_transfer_v2($1,$2,$3,$4,$5,15,null,'Freeze transfer',null,null)",
      [restaurantA, id(), itemA, mainA, kitchenA]);
    await asUser(staff.inventoryA.user,
      "select public.record_inventory_waste_v2($1,$2,$3,$4,2,'Freeze waste',false,null,null)",
      [restaurantA, id(), itemA, kitchenA]);
    await asUser(staff.inventoryA.user,
      "select public.confirm_inventory_storage_adjustment($1,$2,'increase','manual_correction','Freeze adjustment',$3::jsonb)",
      [restaurantA, id(), JSON.stringify([{ inventory_item_id: itemA, storage_location_id: kitchenA, quantity: 1 }])]);

    const requestId = (await asUser(staff.chefA.user,
      "select public.create_kitchen_inventory_request($1,'Coffee',5,'kg','normal',$2,'Freeze request',$3,'ingredient') id",
      [restaurantA, stationA, itemA])).rows[0].id;
    await asUser(staff.managerA.user,
      "select public.process_kitchen_inventory_request($1,$2,'accept',null)", [restaurantA, requestId]);
    await asUser(staff.inventoryA.user,
      "select public.issue_kitchen_inventory_request($1,$2)", [restaurantA, requestId]);
    const beforeConfirm = Number((await asUser(staff.inventoryA.user,
      "select public.get_inventory_storage_balance($1,$2,$3) balance", [restaurantA, itemA, mainA])).rows[0].balance);
    await asUser(staff.chefA.user,
      "select public.confirm_kitchen_inventory_request_receipt($1,$2)", [restaurantA, requestId]);
    const afterConfirm = Number((await asUser(staff.inventoryA.user,
      "select public.get_inventory_storage_balance($1,$2,$3) balance", [restaurantA, itemA, mainA])).rows[0].balance);
    check(beforeConfirm === afterConfirm, "Kitchen receipt confirmation does not deduct stock again");

    const poPayload = { supplier_id: supplierA, status: "draft", expected_delivery_date: "2026-09-01", notes: "Freeze audit",
      lines: [{ inventory_item_id: itemA, purchase_unit_id: unitA, quantity: 30, unit_price: 1, sort_order: 0 }] };
    const poId = (await asUser(staff.inventoryA.user,
      "select public.save_purchase_order_draft($1,$2::jsonb) id", [restaurantA, JSON.stringify(poPayload)])).rows[0].id;
    const poLine = (await db.query("select id from public.purchase_order_items where restaurant_id=$1 and purchase_order_id=$2", [restaurantA, poId])).rows[0].id;
    const poKey = id();
    const poLines = JSON.stringify([{ purchase_order_item_id: poLine, received_quantity: 30 }]);
    const poResult = (await asUser(staff.inventoryA.user,
      "select public.receive_purchase_order($1,$2,$3,$4::jsonb,'Freeze receipt') result", [restaurantA, poId, poKey, poLines])).rows[0].result;
    const poRetry = (await asUser(staff.inventoryA.user,
      "select public.receive_purchase_order($1,$2,$3,$4::jsonb,'Freeze retry') result", [restaurantA, poId, poKey, poLines])).rows[0].result;
    check(poResult.status === "completed" && poRetry.already_processed, "Purchase receipt completes once and retry is idempotent");

    const balances = (await asUser(staff.inventoryA.user,
      "select storage_location_id,balance from public.get_inventory_balances($1)", [restaurantA])).rows;
    const main = Number(balances.find((row) => row.storage_location_id === mainA).balance);
    const kitchen = Number(balances.find((row) => row.storage_location_id === kitchenA).balance) - 0.001;
    const itemQuantity = Number((await db.query("select current_quantity from public.inventory_items where id=$1", [itemA])).rows[0].current_quantity) - 0.001;
    check(main === 120 && kitchen === 14, "End-to-end stock equation is exact", `Main=${main}, Kitchen=${kitchen}`);
    check(itemQuantity === 134, "Material quantity read model matches the authoritative ledger", `total=${itemQuantity}`);
    const movementCount = Number((await db.query("select count(*) count from public.inventory_movements where restaurant_id=$1 and inventory_item_id=$2", [restaurantA, itemA])).rows[0].count) - 1;
    check(movementCount === 9, "End-to-end journey produced exactly nine business movement rows", `${movementCount}`);

    await reject("Tenant A cannot issue against Tenant B material/storage", staff.inventoryA.user,
      "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_out',1,null,null,null,null,null,null,null)",
      [restaurantA, id(), itemB, storageB]);
    await reject("Tenant A cannot use Tenant B supplier", staff.inventoryA.user,
      "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_in',1,null,$5,null,null,null,null,null)",
      [restaurantA, id(), itemA, mainA, supplierB]);
    await reject("Tenant A cannot transfer into Tenant B storage", staff.inventoryA.user,
      "select public.record_inventory_transfer_v2($1,$2,$3,$4,$5,1,null,null,null,null)",
      [restaurantA, id(), itemA, mainA, storageB]);
    await reject("Tenant A cannot adjust Tenant B storage", staff.inventoryA.user,
      "select public.confirm_inventory_storage_adjustment($1,$2,'increase','manual_correction',null,$3::jsonb)",
      [restaurantA, id(), JSON.stringify([{ inventory_item_id: itemA, storage_location_id: storageB, quantity: 1 }])]);
    await reject("Tenant A cannot create a PO with Tenant B supplier", staff.inventoryA.user,
      "select public.save_purchase_order_draft($1,$2::jsonb)", [restaurantA, JSON.stringify({
        supplier_id: supplierB, status: "draft", lines: [{ inventory_item_id: itemA, purchase_unit_id: unitA, quantity: 1, unit_price: 1 }],
      })]);
    const foreignStock = await asUser(staff.inventoryA.user,
      "select * from public.get_inventory_current_stock($1)", [restaurantB]);
    check(foreignStock.rowCount === 0, "Tenant A cannot read Tenant B stock through Inventory RPC");
    await reject("Waiter cannot mutate Inventory", staff.waiterA.user,
      "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_in',1,null,null,null,null,null,null,null)",
      [restaurantA, id(), itemA, mainA]);
    await reject("Inactive Inventory Officer cannot mutate Inventory", staff.inactiveA.user,
      "select public.record_inventory_movement_v2($1,$2,$3,$4,'stock_in',1,null,null,null,null,null,null,null)",
      [restaurantA, id(), itemA, mainA]);
    const foreignRows = await asUser(staff.inventoryB.user,
      "select id from public.inventory_movements where restaurant_id=$1", [restaurantA]);
    check(foreignRows.rowCount === 0, "Tenant B cannot directly read Tenant A movements");
    const legacyGrant = (await db.query(`select count(*) count from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public' and procedure.proname=any($1) and has_function_privilege('authenticated',procedure.oid,'execute')`,
      [["record_inventory_movement", "record_inventory_transfer", "record_inventory_waste", "record_inventory_adjustment"]])).rows[0].count;
    check(Number(legacyGrant) === 0, "Legacy non-idempotent mutation RPCs are closed to authenticated direct calls");
    const internalSeedGrant = (await db.query(`select has_function_privilege(
      'authenticated','public.seed_inventory_default_master_data(uuid)','execute') allowed`)).rows[0].allowed;
    check(!internalSeedGrant, "Internal SECURITY DEFINER seed is closed to authenticated direct calls");

    await db.query("rollback");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
  const passed = results.filter(Boolean).length;
    console.log(`\nRESULT ${passed}/${results.length} PASS`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`AUDIT ERROR ${error.message}${error.where ? ` - ${error.where}` : ""}`);
  process.exitCode = 1;
});
