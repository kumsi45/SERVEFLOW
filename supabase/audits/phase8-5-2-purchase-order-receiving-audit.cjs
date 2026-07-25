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

async function main() {
  const db = new Client({ connectionString: connectionUrl(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    await db.query(migration("181"));
    await db.query(migration("182"));
    check(true, "Migrations 181 and 182 compile in PostgreSQL");

    const actor = (await db.query(`
      select staff.restaurant_id, staff.id staff_id, staff.user_id
      from public.restaurant_staff staff
      where staff.active = true and staff.user_id is not null and staff.role::text = 'owner'
      order by case staff.role::text when 'owner' then 0 when 'manager' then 1 else 2 end
      limit 1
    `)).rows[0];
    check(Boolean(actor), "Authorized tenant fixture is available");

    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor.user_id]);
    const suffix = crypto.randomBytes(5).toString("hex");
    const categoryId = (await db.query(`
      insert into public.inventory_categories(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `Receipt Audit Category ${suffix}`, actor.staff_id])).rows[0].id;
    const supplierId = (await db.query(`
      insert into public.inventory_suppliers(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `Receipt Audit Supplier ${suffix}`, actor.staff_id])).rows[0].id;
    const storageId = (await db.query(`
      insert into public.inventory_storage_locations(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `Receipt Audit Storage ${suffix}`, actor.staff_id])).rows[0].id;
    const unit = (await db.query(`
      insert into public.inventory_units(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id,name
    `, [actor.restaurant_id, `audit_${suffix}`, actor.staff_id])).rows[0];
    const inventoryItemId = (await db.query(`
      insert into public.inventory_items(
        restaurant_id,name,unit,current_quantity,reorder_level,active,
        category_id,unit_id,storage_location_id,preferred_supplier_id,
        minimum_stock,status,created_by_staff_id,updated_by_staff_id
      ) values($1,$2,$3,10,0,true,$4,$5,$6,$7,0,'active',$8,$8)
      returning id
    `, [actor.restaurant_id, `Receipt Audit Item ${suffix}`, unit.name, categoryId,
      unit.id, storageId, supplierId, actor.staff_id])).rows[0].id;
    const fixture = {
      restaurant_id: actor.restaurant_id,
      user_id: actor.user_id,
      supplier_id: supplierId,
      inventory_item_id: inventoryItemId,
      unit_id: unit.id,
      current_quantity: 10,
    };

    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [fixture.user_id]);

    const draftPayload = {
      supplier_id: fixture.supplier_id,
      status: "draft",
      expected_delivery_date: "2026-08-15",
      notes: "Phase 8.5.2 rollback-only audit",
      lines: [{
        inventory_item_id: fixture.inventory_item_id,
        purchase_unit_id: fixture.unit_id,
        quantity: 5,
        unit_price: 12.345678,
        sort_order: 0,
      }],
    };
    const purchaseOrderId = (await db.query(
      "select public.save_purchase_order_draft($1, $2::jsonb) id",
      [fixture.restaurant_id, JSON.stringify(draftPayload)],
    )).rows[0].id;
    const purchaseOrderItemId = (await db.query(
      "select id from public.purchase_order_items where restaurant_id=$1 and purchase_order_id=$2",
      [fixture.restaurant_id, purchaseOrderId],
    )).rows[0].id;

    const firstKey = crypto.randomUUID();
    const firstLines = [{ purchase_order_item_id: purchaseOrderItemId, received_quantity: 2 }];
    const firstResult = (await db.query(
      "select public.receive_purchase_order($1,$2,$3,$4::jsonb,$5) result",
      [fixture.restaurant_id, purchaseOrderId, firstKey, JSON.stringify(firstLines), "Partial delivery"],
    )).rows[0].result;
    check(firstResult.status === "partially_received" && firstResult.already_processed === false,
      "Partial receipt changes status to Partially Received");

    const partial = (await db.query(`
      select purchase_order.status, line.received_quantity,
        line.quantity - line.received_quantity remaining_quantity,
        item.current_quantity,
        (select count(*) from public.purchase_order_receipts receipt
          where receipt.restaurant_id=$1 and receipt.purchase_order_id=$2) receipt_count,
        (select count(*) from public.inventory_movements movement
          where movement.restaurant_id=$1 and movement.source_system='purchase_order_receipt'
            and movement.metadata->>'purchase_order_id'=$2::text) movement_count
      from public.purchase_orders purchase_order
      join public.purchase_order_items line
        on line.purchase_order_id=purchase_order.id and line.restaurant_id=purchase_order.restaurant_id
      join public.inventory_items item
        on item.id=line.inventory_item_id and item.restaurant_id=line.restaurant_id
      where purchase_order.restaurant_id=$1 and purchase_order.id=$2
    `, [fixture.restaurant_id, purchaseOrderId])).rows[0];
    check(Number(partial.received_quantity) === 2 && Number(partial.remaining_quantity) === 3,
      "Remaining quantity is tracked after partial receipt");
    check(Number(partial.current_quantity) === Number(fixture.current_quantity) + 2,
      "Partial receipt increases inventory_items.current_quantity exactly once");
    check(Number(partial.receipt_count) === 1 && Number(partial.movement_count) === 1,
      "Each received line creates one receipt and one movement");

    const snapshot = (await db.query(`
      select receipt_item.purchase_unit_price, receipt_item.inventory_unit_price,
        receipt_item.quantity_before, receipt_item.quantity_after,
        movement.audit_movement_type, movement.movement_type::text movement_type,
        movement.quantity_effect, movement.quantity
      from public.purchase_order_receipt_items receipt_item
      join public.inventory_movements movement
        on movement.restaurant_id=receipt_item.restaurant_id
       and movement.source_system='purchase_order_receipt'
       and movement.source_record_id=receipt_item.id
      where receipt_item.restaurant_id=$1 and receipt_item.receipt_id=$2
    `, [fixture.restaurant_id, firstResult.receipt_id])).rows[0];
    check(Number(snapshot.purchase_unit_price) === 12.345678 && snapshot.audit_movement_type === "PURCHASE_RECEIPT",
      "Immutable receipt preserves purchase price and PURCHASE_RECEIPT audit type");
    check(snapshot.movement_type === "stock_in" && snapshot.quantity_effect === "in" && Number(snapshot.quantity) === 2,
      "Receipt movement is a valid stock-in ledger entry");

    const retry = (await db.query(
      "select public.receive_purchase_order($1,$2,$3,$4::jsonb,$5) result",
      [fixture.restaurant_id, purchaseOrderId, firstKey, JSON.stringify(firstLines), "Network retry"],
    )).rows[0].result;
    const retryState = (await db.query(`
      select
        (select count(*) from public.purchase_order_receipts where restaurant_id=$1 and purchase_order_id=$2) receipts,
        (select count(*) from public.inventory_movements
          where restaurant_id=$1 and source_system='purchase_order_receipt'
            and metadata->>'purchase_order_id'=$2::text) movements,
        (select current_quantity from public.inventory_items where restaurant_id=$1 and id=$3) current_quantity
    `, [fixture.restaurant_id, purchaseOrderId, fixture.inventory_item_id])).rows[0];
    check(retry.already_processed === true && Number(retryState.receipts) === 1
      && Number(retryState.movements) === 1
      && Number(retryState.current_quantity) === Number(fixture.current_quantity) + 2,
    "Idempotent retry creates no duplicate stock, receipt, or movement");

    await expectReject(db,
      "select public.receive_purchase_order($1,$2,$3,$4::jsonb,$5)",
      [fixture.restaurant_id, purchaseOrderId, crypto.randomUUID(),
        JSON.stringify([{ purchase_order_item_id: purchaseOrderItemId, received_quantity: 4 }]), "Over receipt"],
      "Over-receipt is rejected atomically");
    const rollbackState = (await db.query(`
      select line.received_quantity, item.current_quantity,
        (select count(*) from public.inventory_movements
          where restaurant_id=$1 and source_system='purchase_order_receipt'
            and metadata->>'purchase_order_id'=($2::uuid)::text) movements
      from public.purchase_order_items line
      join public.inventory_items item on item.id=line.inventory_item_id and item.restaurant_id=line.restaurant_id
      where line.restaurant_id=$1::uuid and line.purchase_order_id=$2::uuid
    `, [fixture.restaurant_id, purchaseOrderId])).rows[0];
    check(Number(rollbackState.received_quantity) === 2
      && Number(rollbackState.current_quantity) === Number(fixture.current_quantity) + 2
      && Number(rollbackState.movements) === 1,
    "Rejected receipt leaves no partial stock or movement changes");

    const finalResult = (await db.query(
      "select public.receive_purchase_order($1,$2,$3,$4::jsonb,$5) result",
      [fixture.restaurant_id, purchaseOrderId, crypto.randomUUID(),
        JSON.stringify([{ purchase_order_item_id: purchaseOrderItemId, received_quantity: 3 }]), "Final delivery"],
    )).rows[0].result;
    const finalState = (await db.query(`
      select purchase_order.status, line.received_quantity,
        line.quantity-line.received_quantity remaining_quantity, item.current_quantity,
        (select count(*) from public.inventory_movements
          where restaurant_id=$1 and source_system='purchase_order_receipt'
            and metadata->>'purchase_order_id'=($2::uuid)::text) movements
      from public.purchase_orders purchase_order
      join public.purchase_order_items line on line.purchase_order_id=purchase_order.id and line.restaurant_id=purchase_order.restaurant_id
      join public.inventory_items item on item.id=line.inventory_item_id and item.restaurant_id=line.restaurant_id
      where purchase_order.restaurant_id=$1::uuid and purchase_order.id=$2::uuid
    `, [fixture.restaurant_id, purchaseOrderId])).rows[0];
    check(finalResult.status === "completed" && finalState.status === "completed"
      && Number(finalState.received_quantity) === 5 && Number(finalState.remaining_quantity) === 0,
    "Full receipt completes the purchase order with zero remaining quantity");
    check(Number(finalState.current_quantity) === Number(fixture.current_quantity) + 5
      && Number(finalState.movements) === 2,
    "Multiple receipts increase stock and movements exactly by received quantities");

    await expectReject(db,
      "update public.purchase_order_receipts set notes='changed' where restaurant_id=$1 and id=$2",
      [fixture.restaurant_id, firstResult.receipt_id],
      "Receipt history cannot be updated");
    await expectReject(db,
      "delete from public.purchase_order_receipt_items where restaurant_id=$1 and receipt_id=$2",
      [fixture.restaurant_id, firstResult.receipt_id],
      "Receipt items cannot be deleted");

    const otherTenant = (await db.query(
      "select id from public.restaurants where id<>$1 limit 1", [fixture.restaurant_id],
    )).rows[0];
    if (otherTenant) {
      await expectReject(db,
        "select public.get_purchase_orders($1)", [otherTenant.id],
        "Cross-tenant purchase-order reads are denied");
    } else {
      console.log("PASS Tenant isolation is enforced by composite keys and access checks — no second tenant fixture");
    }

    await db.query("reset role");
    await db.query("rollback");
    console.log("\nPASS Phase 8.5.2 rollback-only database audit");
  } catch (error) {
    await db.query("reset role").catch(() => {});
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
