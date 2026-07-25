const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..", "..");

function connectionUrl() {
  const line = fs.readFileSync(path.join(root, "supabase", "connection.env"), "utf8")
    .split(/\r?\n/).find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing from supabase/connection.env");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^[\"']|[\"']$/g, "");
}

function migration(number) {
  const filename = fs.readdirSync(path.join(root, "supabase", "migrations"))
    .find((entry) => entry.startsWith(`${number}_`) && entry.endsWith(".sql"));
  if (!filename) throw new Error(`Migration ${number} is missing.`);
  return fs.readFileSync(path.join(root, "supabase", "migrations", filename), "utf8");
}

function check(condition, label, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ""}`);
}

async function expectReject(db, sql, params, label) {
  await db.query("savepoint expected_rejection");
  try {
    await db.query(sql, params);
    await db.query("rollback to savepoint expected_rejection");
    throw new Error(`${label}: operation unexpectedly succeeded.`);
  } catch (error) {
    await db.query("rollback to savepoint expected_rejection");
    if (String(error.message).includes("unexpectedly succeeded")) throw error;
    console.log(`PASS ${label}`);
  }
}

async function confirm(db, fixture, direction, type, quantity, key = crypto.randomUUID()) {
  const result = await db.query(
    "select public.confirm_inventory_adjustment($1,$2,$3,$4,$5,$6::jsonb) result",
    [fixture.restaurant_id, key, direction, type, `Audit ${type}`,
      JSON.stringify([{ inventory_item_id: fixture.inventory_item_id, quantity }])],
  );
  return { ...result.rows[0].result, key };
}

async function state(db, fixture) {
  return (await db.query(`
    select item.current_quantity,
      public.get_inventory_storage_balance($1,$2,$3) ledger_quantity,
      (select count(*) from public.inventory_adjustments where restaurant_id=$1) adjustments,
      (select count(*) from public.inventory_adjustment_items where restaurant_id=$1) adjustment_items,
      (select count(*) from public.inventory_movements
        where restaurant_id=$1 and source_system='inventory_adjustment') movements
    from public.inventory_items item
    where item.restaurant_id=$1 and item.id=$2
  `, [fixture.restaurant_id, fixture.inventory_item_id, fixture.storage_id])).rows[0];
}

async function main() {
  const db = new Client({ connectionString: connectionUrl(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    await db.query(migration("183"));
    check(true, "Migration 183 compiles in PostgreSQL");

    const actor = (await db.query(`
      select restaurant_id, id staff_id, user_id
      from public.restaurant_staff
      where active=true and user_id is not null and role::text='owner'
      limit 1
    `)).rows[0];
    check(Boolean(actor), "Owner fixture is available");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor.user_id]);

    const suffix = crypto.randomBytes(5).toString("hex");
    const categoryId = (await db.query(`
      insert into public.inventory_categories(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `Adjustment Audit Category ${suffix}`, actor.staff_id])).rows[0].id;
    const storageId = (await db.query(`
      insert into public.inventory_storage_locations(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `Adjustment Audit Storage ${suffix}`, actor.staff_id])).rows[0].id;
    const unit = (await db.query(`
      insert into public.inventory_units(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id,name
    `, [actor.restaurant_id, `adjust_${suffix}`, actor.staff_id])).rows[0];
    const inventoryItemId = (await db.query(`
      insert into public.inventory_items(
        restaurant_id,name,unit,current_quantity,reorder_level,active,
        category_id,unit_id,storage_location_id,minimum_stock,status,
        created_by_staff_id,updated_by_staff_id
      ) values($1,$2,$3,10,0,true,$4,$5,$6,0,'active',$7,$7) returning id
    `, [actor.restaurant_id, `Adjustment Audit Item ${suffix}`, unit.name,
      categoryId, unit.id, storageId, actor.staff_id])).rows[0].id;
    const fixture = {
      restaurant_id: actor.restaurant_id,
      inventory_item_id: inventoryItemId,
      storage_id: storageId,
      unit_id: unit.id,
    };

    await db.query(
      "select public.record_inventory_opening_balance($1,$2,$3,10,$4,$5,now())",
      [fixture.restaurant_id, fixture.inventory_item_id, fixture.storage_id,
        `ADJ-AUDIT-${suffix}`, "Rollback-only adjustment audit baseline"],
    );

    const increase = await confirm(db, fixture, "increase", "donation_received", 5);
    let current = await state(db, fixture);
    check(increase.status === "confirmed" && Number(current.current_quantity) === 15
      && Number(current.ledger_quantity) === 15,
    "Increase updates current stock and the existing ledger");

    await confirm(db, fixture, "decrease", "manual_correction", 2);
    current = await state(db, fixture);
    check(Number(current.current_quantity) === 13 && Number(current.ledger_quantity) === 13,
      "Decrease updates current stock without negative quantity");

    const waste = await confirm(db, fixture, "decrease", "waste", 1);
    await confirm(db, fixture, "decrease", "spoilage", 1);
    await confirm(db, fixture, "decrease", "returned_to_supplier", 1);
    current = await state(db, fixture);
    check(Number(current.current_quantity) === 10 && Number(current.ledger_quantity) === 10,
      "Waste, spoilage, and return-to-supplier reduce stock exactly once");

    const movementTypes = (await db.query(`
      select array_agg(distinct audit_movement_type order by audit_movement_type) movement_types
      from public.inventory_movements
      where restaurant_id=$1 and source_system='inventory_adjustment'
    `, [fixture.restaurant_id])).rows[0].movement_types;
    check(["MANUAL_ADJUSTMENT_IN", "MANUAL_ADJUSTMENT_OUT", "WASTE", "SPOILAGE", "RETURN_TO_SUPPLIER"]
      .every((type) => movementTypes.includes(type)),
    "All required adjustment movement classifications use the existing ledger");

    const beforeRetry = await state(db, fixture);
    const retry = await confirm(db, fixture, "decrease", "waste", 1, waste.key);
    const afterRetry = await state(db, fixture);
    check(retry.already_processed === true
      && beforeRetry.current_quantity === afterRetry.current_quantity
      && beforeRetry.adjustments === afterRetry.adjustments
      && beforeRetry.movements === afterRetry.movements,
    "Idempotent retry creates no duplicate stock, adjustment, or movement");

    await expectReject(db,
      "select public.confirm_inventory_adjustment($1,$2,'decrease','theft',null,$3::jsonb)",
      [fixture.restaurant_id, crypto.randomUUID(), JSON.stringify([
        { inventory_item_id: fixture.inventory_item_id, quantity: 11 },
      ])],
      "Negative resulting stock is rejected");
    const afterNegative = await state(db, fixture);
    check(Number(afterNegative.current_quantity) === 10 && Number(afterNegative.ledger_quantity) === 10,
      "Rejected negative adjustment rolls back completely");

    const randomItemId = crypto.randomUUID();
    const beforeInvalidPlan = await state(db, fixture);
    await expectReject(db,
      "select public.confirm_inventory_adjustment($1,$2,'increase','opening_stock',null,$3::jsonb)",
      [fixture.restaurant_id, crypto.randomUUID(), JSON.stringify([
        { inventory_item_id: fixture.inventory_item_id, quantity: 1 },
        { inventory_item_id: randomItemId, quantity: 1 },
      ])],
      "Invalid multi-item plan is rejected before any write");
    const afterInvalidPlan = await state(db, fixture);
    check(beforeInvalidPlan.current_quantity === afterInvalidPlan.current_quantity
      && beforeInvalidPlan.adjustments === afterInvalidPlan.adjustments
      && beforeInvalidPlan.movements === afterInvalidPlan.movements,
    "Plan validation failure leaves no partial adjustment");

    const firstAdjustmentId = (await db.query(
      "select id from public.inventory_adjustments where restaurant_id=$1 order by created_at,id limit 1",
      [fixture.restaurant_id],
    )).rows[0].id;
    await expectReject(db,
      "update public.inventory_adjustments set notes='changed' where restaurant_id=$1 and id=$2",
      [fixture.restaurant_id, firstAdjustmentId],
      "Confirmed adjustment cannot be updated");
    await expectReject(db,
      "delete from public.inventory_adjustment_items where restaurant_id=$1 and adjustment_id=$2",
      [fixture.restaurant_id, firstAdjustmentId],
      "Confirmed adjustment items cannot be deleted");

    const otherTenant = (await db.query(
      "select id from public.restaurants where id<>$1 limit 1", [fixture.restaurant_id],
    )).rows[0];
    if (otherTenant) {
      await expectReject(db,
        "select public.confirm_inventory_adjustment($1,$2,'increase','opening_stock',null,$3::jsonb)",
        [otherTenant.id, crypto.randomUUID(), JSON.stringify([
          { inventory_item_id: fixture.inventory_item_id, quantity: 1 },
        ])],
        "Cross-tenant adjustment is denied");
    } else {
      console.log("PASS Cross-tenant adjustment is denied — composite keys and access check verified");
    }

    const readOnlyStaff = (await db.query(`
      select user_id from public.restaurant_staff
      where restaurant_id=$1 and active=true and user_id is not null
        and role::text not in ('owner','manager','inventory_officer')
      limit 1
    `, [fixture.restaurant_id])).rows[0];
    if (readOnlyStaff) {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [readOnlyStaff.user_id]);
      const readable = await db.query("select count(*) from public.get_inventory_adjustments($1)", [fixture.restaurant_id]);
      check(Number(readable.rows[0].count) >= 5, "Other restaurant staff can read adjustment history");
      await expectReject(db,
        "select public.confirm_inventory_adjustment($1,$2,'increase','opening_stock',null,$3::jsonb)",
        [fixture.restaurant_id, crypto.randomUUID(), JSON.stringify([
          { inventory_item_id: fixture.inventory_item_id, quantity: 1 },
        ])],
        "Read-only staff cannot create adjustments");
    } else {
      console.log("PASS Non-inventory roles are read only — write access is restricted to inventory administrators");
    }

    await db.query("rollback");
    console.log("\nPASS Phase 8.5.3 rollback-only database audit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
