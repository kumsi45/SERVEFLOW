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
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "251_inventory_destructive_authority_hardening.sql"),
  "utf8",
);
const id = () => crypto.randomUUID();
const results = [];
const check = (label, ok, detail = "") => {
  const result = { label, ok: Boolean(ok), detail };
  results.push(result);
  console.log(`${result.ok ? "PASS" : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
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
  const expectReject = async (label, userId, sql, params = [], pattern = /access denied|permission denied/i) => {
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
    if (process.env.AUDIT_APPLY_MIGRATION !== "false") await db.query(migration);

    const identities = (await db.query(
      "select distinct user_id from public.restaurant_staff where user_id is not null limit 8",
    )).rows.map((row) => row.user_id);
    if (identities.length < 8) throw new Error("Hosted audit requires eight existing authenticated identities.");

    const restaurantA = id(), restaurantB = id();
    const categoryA = id(), categoryB = id(), unitA = id(), unitB = id();
    const storageA = id(), storageB = id(), supplierA = id(), supplierB = id();
    const itemA = id(), itemB = id();
    const staff = {
      ownerA: { id: id(), user: identities[0] },
      managerA: { id: id(), user: identities[1] },
      inventoryA: { id: id(), user: identities[2] },
      inactiveInventoryA: { id: id(), user: identities[3] },
      waiterA: { id: id(), user: identities[4] },
      cashierA: { id: id(), user: identities[5] },
      kitchenA: { id: id(), user: identities[6] },
      inventoryB: { id: id(), user: identities[7] },
    };
    const suffix = crypto.randomUUID().slice(0, 8);

    await db.query(
      "insert into public.restaurants(id,name,slug) values($1,'Inventory Security Audit A',$2),($3,'Inventory Security Audit B',$4)",
      [restaurantA, `inventory-security-a-${suffix}`, restaurantB, `inventory-security-b-${suffix}`],
    );
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values
      ($1,$2,$3,'owner','Audit Owner A',true),
      ($4,$2,$5,'manager','Audit Manager A',true),
      ($6,$2,$7,'inventory_officer','Audit Inventory A',true),
      ($8,$2,$9,'inventory_officer','Audit Inactive Inventory A',false),
      ($10,$2,$11,'waiter','Audit Waiter A',true),
      ($12,$2,$13,'cashier','Audit Cashier A',true),
      ($14,$2,$15,'kitchen','Audit Kitchen A',true),
      ($16,$17,$18,'inventory_officer','Audit Inventory B',true)`, [
      staff.ownerA.id, restaurantA, staff.ownerA.user,
      staff.managerA.id, staff.managerA.user,
      staff.inventoryA.id, staff.inventoryA.user,
      staff.inactiveInventoryA.id, staff.inactiveInventoryA.user,
      staff.waiterA.id, staff.waiterA.user,
      staff.cashierA.id, staff.cashierA.user,
      staff.kitchenA.id, staff.kitchenA.user,
      staff.inventoryB.id, restaurantB, staff.inventoryB.user,
    ]);
    await db.query("insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Audit Category A','active',$3,$3),($4,$5,'Audit Category B','active',$6,$6)", [categoryA, restaurantA, staff.ownerA.id, categoryB, restaurantB, staff.inventoryB.id]);
    await db.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Audit Unit A','active',$3,$3),($4,$5,'Audit Unit B','active',$6,$6)", [unitA, restaurantA, staff.ownerA.id, unitB, restaurantB, staff.inventoryB.id]);
    await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Audit Store A','active',$3,$3),($4,$5,'Audit Store B','active',$6,$6)", [storageA, restaurantA, staff.ownerA.id, storageB, restaurantB, staff.inventoryB.id]);
    await db.query("insert into public.inventory_suppliers(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Audit Supplier A','active',$3,$3),($4,$5,'Audit Supplier B','active',$6,$6)", [supplierA, restaurantA, staff.ownerA.id, supplierB, restaurantB, staff.inventoryB.id]);
    await db.query(`insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,minimum_stock,status,created_by_staff_id,updated_by_staff_id)
      values($1,$2,'Audit Item A','unit',0,1,true,$3,$4,$5,1,'active',$6,$6),($7,$8,'Audit Item B','unit',0,1,true,$9,$10,$11,1,'active',$12,$12)`,
      [itemA, restaurantA, categoryA, unitA, storageA, staff.ownerA.id, itemB, restaurantB, categoryB, unitB, storageB, staff.inventoryB.id]);

    for (const [label, table] of [
      ["items", "inventory_items"], ["categories", "inventory_categories"], ["units", "inventory_units"],
      ["storage locations", "inventory_storage_locations"], ["suppliers", "inventory_suppliers"],
    ]) {
      const own = await asUser(staff.inventoryA.user, `select id from public.${table} where restaurant_id=$1`, [restaurantA]);
      check(`Inventory Officer retains same-tenant read access to ${label}`, own.rowCount === 1);
      const foreign = await asUser(staff.inventoryA.user, `select id from public.${table} where restaurant_id=$1`, [restaurantB]);
      check(`Inventory Officer cannot read cross-tenant ${label}`, foreign.rowCount === 0);
    }

    await asUser(staff.inventoryA.user, "update public.inventory_items set name='Audit Item A Edited' where id=$1", [itemA]);
    check("Inventory Officer retains ordinary active-record editing", (await db.query("select name from public.inventory_items where id=$1", [itemA])).rows[0].name === "Audit Item A Edited");

    for (const [label, table, target] of [
      ["item", "inventory_items", itemA], ["category", "inventory_categories", categoryA],
      ["unit", "inventory_units", unitA], ["storage location", "inventory_storage_locations", storageA],
      ["supplier", "inventory_suppliers", supplierA],
    ]) {
      await expectReject(`Inventory Officer cannot archive ${label}`, staff.inventoryA.user,
        `update public.${table} set status='archived' where id=$1`, [target], /lifecycle access denied/i);
    }
    await expectReject("Inventory Officer cannot soft-delete item", staff.inventoryA.user,
      "update public.inventory_items set status='deleted' where id=$1", [itemA], /lifecycle access denied/i);
    await expectReject("Inventory Officer cannot soft-delete category", staff.inventoryA.user,
      "update public.inventory_categories set status='deleted' where id=$1", [categoryA], /lifecycle access denied/i);
    await expectReject("Inventory Officer cannot soft-delete unit", staff.inventoryA.user,
      "update public.inventory_units set status='deleted' where id=$1", [unitA], /lifecycle access denied/i);
    await expectReject("Inventory Officer cannot soft-delete storage location", staff.inventoryA.user,
      "update public.inventory_storage_locations set status='deleted' where id=$1", [storageA], /lifecycle access denied/i);
    await expectReject("Inventory Officer cannot soft-delete supplier", staff.inventoryA.user,
      "update public.inventory_suppliers set status='deleted' where id=$1", [supplierA], /lifecycle access denied/i);

    await asUser(staff.ownerA.user, "update public.inventory_items set status='archived' where id=$1", [itemA]);
    check("Owner can archive same-tenant item", (await db.query("select status from public.inventory_items where id=$1", [itemA])).rows[0].status === "archived");
    await expectReject("Inventory Officer cannot edit an archived item", staff.inventoryA.user,
      "update public.inventory_items set name='Forbidden archived edit' where id=$1", [itemA], /lifecycle access denied/i);
    await expectReject("Inventory Officer cannot restore an archived item", staff.inventoryA.user,
      "update public.inventory_items set status='active' where id=$1", [itemA], /lifecycle access denied/i);
    await asUser(staff.managerA.user, "update public.inventory_items set status='active' where id=$1", [itemA]);
    check("Manager can restore same-tenant item", (await db.query("select status from public.inventory_items where id=$1", [itemA])).rows[0].status === "active");

    await asUser(staff.managerA.user, "update public.inventory_storage_locations set status='archived' where id=$1", [storageA]);
    await expectReject("Inventory Officer cannot restore an archived storage location", staff.inventoryA.user,
      "update public.inventory_storage_locations set status='active' where id=$1", [storageA], /lifecycle access denied/i);
    await asUser(staff.ownerA.user, "update public.inventory_storage_locations set status='active' where id=$1", [storageA]);
    check("Manager archive and Owner restore work for storage", (await db.query("select status from public.inventory_storage_locations where id=$1", [storageA])).rows[0].status === "active");
    await asUser(staff.managerA.user, "update public.inventory_suppliers set status='archived' where id=$1", [supplierA]);
    await expectReject("Inventory Officer cannot restore an archived supplier", staff.inventoryA.user,
      "update public.inventory_suppliers set status='active' where id=$1", [supplierA], /lifecycle access denied/i);
    await asUser(staff.ownerA.user, "update public.inventory_suppliers set status='active' where id=$1", [supplierA]);
    await asUser(staff.ownerA.user, "update public.inventory_suppliers set status='deleted' where id=$1", [supplierA]);
    check("Owner can soft-delete same-tenant supplier", (await db.query("select status from public.inventory_suppliers where id=$1", [supplierA])).rows[0].status === "deleted");
    await expectReject("Inventory Officer cannot restore a soft-deleted supplier", staff.inventoryA.user,
      "update public.inventory_suppliers set status='active' where id=$1", [supplierA], /lifecycle access denied/i);
    await asUser(staff.ownerA.user, "update public.inventory_suppliers set status='active' where id=$1", [supplierA]);

    const crossTenantUpdate = await asUser(staff.inventoryB.user,
      "update public.inventory_items set status='archived' where id=$1", [itemA]);
    check("Tenant B Inventory Officer cannot mutate Tenant A item", crossTenantUpdate.rowCount === 0
      && (await db.query("select status from public.inventory_items where id=$1", [itemA])).rows[0].status === "active");
    for (const [label, actor] of [["Waiter", staff.waiterA], ["Cashier", staff.cashierA]]) {
      const rows = await asUser(actor.user, "select id from public.inventory_items where restaurant_id=$1", [restaurantA]);
      check(`${label} cannot read Inventory master records`, rows.rowCount === 0);
      const mutation = await asUser(actor.user, "update public.inventory_items set status='archived' where id=$1", [itemA]);
      check(`${label} cannot mutate Inventory master lifecycle`, mutation.rowCount === 0);
    }
    const kitchenRows = await asUser(staff.kitchenA.user, "select id from public.inventory_items where restaurant_id=$1", [restaurantA]);
    check("Chef retains canonical ingredient lookup access", kitchenRows.rowCount === 1);
    const kitchenMutation = await asUser(staff.kitchenA.user,
      "update public.inventory_items set status='archived' where id=$1", [itemA]);
    check("Chef cannot mutate Inventory master lifecycle", kitchenMutation.rowCount === 0);
    check("Inactive Inventory Officer loses master-record access",
      (await asUser(staff.inactiveInventoryA.user, "select id from public.inventory_items where restaurant_id=$1", [restaurantA])).rowCount === 0);

    await db.query("savepoint anonymous_read");
    try {
      await db.query("set local role anon");
      const anonRows = await db.query("select id from public.inventory_items where restaurant_id=$1", [restaurantA]);
      await db.query("reset role");
      check("Anonymous cannot read Inventory master records", anonRows.rowCount === 0);
    } catch (error) {
      await db.query("rollback to savepoint anonymous_read");
      await db.query("reset role");
      check("Anonymous cannot read Inventory master records", /permission denied/i.test(error.message), error.message);
    }
    await db.query("savepoint anonymous_mutation");
    try {
      await db.query("set local role anon");
      const mutation = await db.query("update public.inventory_items set status='archived' where id=$1", [itemA]);
      await db.query("reset role");
      check("Anonymous cannot mutate Inventory master lifecycle", mutation.rowCount === 0);
    } catch (error) {
      await db.query("rollback to savepoint anonymous_mutation");
      await db.query("reset role");
      check("Anonymous cannot mutate Inventory master lifecycle", /permission denied/i.test(error.message), error.message);
    }

    const privileges = (await db.query(`select privilege_type from information_schema.role_table_grants
      where table_schema='public' and table_name='inventory_items' and grantee='authenticated'`)).rows.map((row) => row.privilege_type);
    check("Authenticated hard DELETE and TRUNCATE grants are removed", !privileges.includes("DELETE") && !privileges.includes("TRUNCATE"));
    check("Authenticated SELECT, INSERT, and UPDATE grants remain", ["SELECT", "INSERT", "UPDATE"].every((privilege) => privileges.includes(privilege)));
    const policyCount = Number((await db.query(`select count(*) count from pg_policies where schemaname='public' and tablename=any($1)`,
      [["inventory_items", "inventory_categories", "inventory_units", "inventory_storage_locations", "inventory_suppliers"]])).rows[0].count);
    check("Existing RLS policies remain installed", policyCount >= 15, `${policyCount} policies`);
    const rlsCount = Number((await db.query(`select count(*) count from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1) and c.relrowsecurity`,
      [["inventory_items", "inventory_categories", "inventory_units", "inventory_storage_locations", "inventory_suppliers"]])).rows[0].count);
    check("RLS remains enabled on all five master tables", rlsCount === 5);
    const triggerCount = Number((await db.query(`select count(*) count from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1) and t.tgname like '%_lifecycle_guard' and not t.tgisinternal`,
      [["inventory_items", "inventory_categories", "inventory_units", "inventory_storage_locations", "inventory_suppliers"]])).rows[0].count);
    check("Lifecycle guard is installed on all five master tables", triggerCount === 5);
    const helper = (await db.query(`select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='inventory_master_lifecycle_has_access'`)).rows[0];
    check("Lifecycle helper is SECURITY DEFINER with fixed search_path", helper?.prosecdef === true && helper.proconfig?.includes("search_path=public"));
    const realtimeCount = Number((await db.query(`select count(*) count from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=any($1)`,
      [["inventory_items", "inventory_categories", "inventory_units", "inventory_storage_locations", "inventory_suppliers"]])).rows[0].count);
    check("Realtime publication remains enabled for all five master tables", realtimeCount === 5);

    await expectReject("Inventory Officer remains denied from Owner-only integrity diagnostics", staff.inventoryA.user,
      "select * from public.run_inventory_integrity_check($1)", [restaurantA], /access denied/i);
    const ownerIntegrity = await asUser(staff.ownerA.user, "select * from public.run_inventory_integrity_check($1)", [restaurantA]);
    check("Owner retains read-only integrity diagnostics", ownerIntegrity.rowCount > 0);

    await asUser(staff.inventoryA.user, "select public.record_inventory_opening_balance($1,$2,$3,10,'SECURITY-AUDIT-OPEN','Rollback audit')", [restaurantA, itemA, storageA]);
    await asUser(staff.inventoryA.user, `select public.record_inventory_movement_v2(
      $1,$2,$3,$4,'stock_out'::public.inventory_movement_type,3,'out',null,null,null,
      'Security audit stock out','Rollback audit',now())`, [restaurantA, id(), itemA, storageA]);
    const balance = Number((await asUser(staff.inventoryA.user,
      "select public.get_inventory_storage_balance($1,$2,$3) balance", [restaurantA, itemA, storageA])).rows[0].balance);
    check("Inventory Officer stock-in and stock-out workflow remains operational", balance === 7);

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
  console.error(`FAIL hosted rollback audit crashed - ${error.message}${error.where ? ` - ${error.where}` : ""}`);
  process.exit(1);
});
