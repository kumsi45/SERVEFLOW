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

function check(condition, label, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  console.log(`PASS ${label}${detail ? ` - ${detail}` : ""}`);
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

async function state(db, fixture) {
  return (await db.query(`
    select item.current_quantity,
      public.get_inventory_storage_balance($1,$2,$3) storage_quantity,
      (select count(*) from public.inventory_movements movement
        where movement.restaurant_id=$1 and movement.inventory_item_id=$2
          and movement.storage_location_id=$3 and movement.source_system='inventory_adjustment') movement_count
    from public.inventory_items item
    where item.restaurant_id=$1 and item.id=$2
  `, [fixture.restaurant_id, fixture.inventory_item_id, fixture.storage_id])).rows[0];
}

async function setActor(db, userId) {
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ?? ""]);
}

async function main() {
  const db = new Client({ connectionString: connectionUrl(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");

    const contract = (await db.query(`
      select pg_get_function_identity_arguments(procedure.oid) arguments,
        has_function_privilege('authenticated', procedure.oid, 'execute') authenticated_execute,
        has_function_privilege('anon', procedure.oid, 'execute') anon_execute
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public' and procedure.proname='confirm_inventory_storage_adjustment'
    `)).rows;
    check(contract.length === 1, "One unambiguous storage Adjustment RPC is deployed");
    check(contract[0].arguments === "target_restaurant_id uuid, target_idempotency_key uuid, target_direction text, target_adjustment_type text, target_notes text, target_lines jsonb",
      "Deployed Adjustment RPC argument names and PostgreSQL types match the frontend");
    check(contract[0].authenticated_execute && !contract[0].anon_execute,
      "Adjustment RPC is exposed to authenticated users and denied to anonymous users");

    const fixture = (await db.query(`
      select item.restaurant_id, item.id inventory_item_id, storage.id storage_id,
        actor.id staff_id, actor.user_id, actor.role::text actor_role
      from public.inventory_items item
      join public.inventory_storage_locations storage
        on storage.restaurant_id=item.restaurant_id and lower(storage.name)=lower('Freezer') and storage.status='active'
      join lateral (
        select staff.id, staff.user_id, staff.role
        from public.restaurant_staff staff
        where staff.restaurant_id=item.restaurant_id and staff.active=true and staff.user_id is not null
          and staff.role::text in ('inventory_officer','manager','owner')
        order by case staff.role::text when 'inventory_officer' then 0 when 'manager' then 1 else 2 end, staff.id
        limit 1
      ) actor on true
      where lower(item.name)=lower('Timatima') and item.status='active' and item.active=true
      limit 1
    `)).rows[0];
    check(Boolean(fixture), "Timatima / Freezer / authorized staff fixture is available");

    await setActor(db, fixture.user_id);
    const before = await state(db, fixture);
    check(Number(before.storage_quantity) === 12, "Timatima starts at 12 kg in Freezer");

    const idempotencyKey = crypto.randomUUID();
    const payload = JSON.stringify([{
      inventory_item_id: fixture.inventory_item_id,
      storage_location_id: fixture.storage_id,
      quantity: 1,
    }]);
    const first = (await db.query(
      "select public.confirm_inventory_storage_adjustment($1,$2,'increase','manual_correction',$3,$4::jsonb) result",
      [fixture.restaurant_id, idempotencyKey, "Correction reason: Manual Correction\nRollback-only hosted audit", payload],
    )).rows[0].result;
    const after = await state(db, fixture);
    check(first.status === "confirmed" && first.already_processed === false,
      "Timatima +1 kg Adjustment confirms successfully");
    check(Number(after.storage_quantity) === 13 && Number(after.current_quantity) === Number(before.current_quantity) + 1,
      "Freezer and Current Stock read models become 13 kg / increase once");
    check(Number(after.movement_count) === Number(before.movement_count) + 1,
      "Exactly one Stock Movement is created");

    const provenance = (await db.query(`
      select adjustment.restaurant_id, adjustment.created_by, adjustment_item.storage_location_id,
        movement.performed_by_staff_id, movement.quantity, movement.quantity_effect
      from public.inventory_adjustments adjustment
      join public.inventory_adjustment_items adjustment_item
        on adjustment_item.adjustment_id=adjustment.id and adjustment_item.restaurant_id=adjustment.restaurant_id
      join public.inventory_movements movement
        on movement.id=adjustment_item.movement_id and movement.restaurant_id=adjustment.restaurant_id
      where adjustment.id=$1
    `, [first.adjustment_id])).rows;
    check(provenance.length === 1
      && provenance[0].restaurant_id === fixture.restaurant_id
      && provenance[0].created_by === fixture.staff_id
      && provenance[0].performed_by_staff_id === fixture.staff_id
      && provenance[0].storage_location_id === fixture.storage_id
      && Number(provenance[0].quantity) === 1
      && provenance[0].quantity_effect === "in",
    "Movement preserves tenant, staff, Freezer, quantity, and direction provenance");

    const history = (await db.query(
      "select items from public.get_inventory_adjustments($1) where id=$2",
      [fixture.restaurant_id, first.adjustment_id],
    )).rows[0];
    check(history && history.items.length === 1 && history.items[0].storage_location_name === "Freezer",
      "Adjustment history projects the Freezer storage context");

    const retry = (await db.query(
      "select public.confirm_inventory_storage_adjustment($1,$2,'increase','manual_correction',$3,$4::jsonb) result",
      [fixture.restaurant_id, idempotencyKey, "Correction reason: Manual Correction\nRollback-only hosted audit", payload],
    )).rows[0].result;
    const afterRetry = await state(db, fixture);
    check(retry.already_processed === true
      && afterRetry.current_quantity === after.current_quantity
      && afterRetry.storage_quantity === after.storage_quantity
      && afterRetry.movement_count === after.movement_count,
    "Repeated idempotency key creates no second balance update or movement");

    const otherTenant = (await db.query("select id from public.restaurants where id<>$1 limit 1", [fixture.restaurant_id])).rows[0];
    if (otherTenant) {
      await expectReject(db,
        "select public.confirm_inventory_storage_adjustment($1,$2,'increase','manual_correction',null,$3::jsonb)",
        [otherTenant.id, crypto.randomUUID(), payload], "Cross-tenant Adjustment is denied");
    }

    for (const role of ["waiter", "kitchen"]) {
      const staff = (await db.query(`
        select restaurant_id, user_id from public.restaurant_staff
        where active=true and user_id is not null and role::text=$1 limit 1
      `, [role])).rows[0];
      if (staff) {
        await setActor(db, staff.user_id);
        await expectReject(db,
          "select public.confirm_inventory_storage_adjustment($1,$2,'increase','manual_correction',null,$3::jsonb)",
          [staff.restaurant_id, crypto.randomUUID(), payload], `${role} cannot create Inventory Adjustments`);
      }
    }

    await setActor(db, null);
    await expectReject(db,
      "select public.confirm_inventory_storage_adjustment($1,$2,'increase','manual_correction',null,$3::jsonb)",
      [fixture.restaurant_id, crypto.randomUUID(), payload], "Missing authenticated identity is denied");

    await db.query("rollback");
    console.log("\nPASS Storage-aware Inventory Adjustment hosted rollback audit");
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
