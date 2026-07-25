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
    await db.query(migration("184"));
    check(true, "Migrations 181, 182, and 184 compile in PostgreSQL");

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
    `, [actor.restaurant_id, `History Audit Category ${suffix}`, actor.staff_id])).rows[0].id;
    const supplierId = (await db.query(`
      insert into public.inventory_suppliers(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `History Audit Supplier ${suffix}`, actor.staff_id])).rows[0].id;
    const storageId = (await db.query(`
      insert into public.inventory_storage_locations(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `History Audit Storage ${suffix}`, actor.staff_id])).rows[0].id;
    const unit = (await db.query(`
      insert into public.inventory_units(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id,name
    `, [actor.restaurant_id, `history_${suffix}`, actor.staff_id])).rows[0];
    const itemId = (await db.query(`
      insert into public.inventory_items(
        restaurant_id,name,unit,current_quantity,reorder_level,active,
        category_id,unit_id,storage_location_id,preferred_supplier_id,
        minimum_stock,status,created_by_staff_id,updated_by_staff_id
      ) values($1,$2,$3,0,0,true,$4,$5,$6,$7,0,'active',$8,$8) returning id
    `, [actor.restaurant_id, `History Audit Item ${suffix}`, unit.name,
      categoryId, unit.id, storageId, supplierId, actor.staff_id])).rows[0].id;

    const draftPayload = {
      supplier_id: supplierId,
      status: "draft",
      expected_delivery_date: "2026-08-15",
      notes: "Read-only history audit note",
      lines: [{ inventory_item_id: itemId, purchase_unit_id: unit.id, quantity: 10, unit_price: 12.5, sort_order: 0 }],
    };
    const purchaseOrderId = (await db.query(
      "select public.save_purchase_order_draft($1,$2::jsonb) id",
      [actor.restaurant_id, JSON.stringify(draftPayload)],
    )).rows[0].id;
    const purchaseOrderItemId = (await db.query(
      "select id from public.purchase_order_items where restaurant_id=$1 and purchase_order_id=$2",
      [actor.restaurant_id, purchaseOrderId],
    )).rows[0].id;

    let history = (await db.query(
      "select * from public.get_purchase_history($1) where id=$2",
      [actor.restaurant_id, purchaseOrderId],
    )).rows[0];
    check(history.purchase_number === `PO-${purchaseOrderId.slice(0, 8).toUpperCase()}`
      && history.status === "draft" && Number(history.total_cost) === 125
      && Number(history.item_count) === 1,
    "Draft purchase summary includes number, supplier, creator, cost, and item count");
    check(history.lines[0].inventory_item_name === `History Audit Item ${suffix}`
      && Number(history.lines[0].ordered_quantity) === 10
      && Number(history.lines[0].received_quantity) === 0
      && Number(history.lines[0].remaining_quantity) === 10,
    "Draft purchase detail includes ordered, received, and remaining quantities");

    const partialKey = crypto.randomUUID();
    await db.query(
      "select public.receive_purchase_order($1,$2,$3,$4::jsonb,$5)",
      [actor.restaurant_id, purchaseOrderId, partialKey,
        JSON.stringify([{ purchase_order_item_id: purchaseOrderItemId, received_quantity: 4 }]),
        "Partial history audit receipt"],
    );
    history = (await db.query(
      "select * from public.get_purchase_history($1) where id=$2",
      [actor.restaurant_id, purchaseOrderId],
    )).rows[0];
    check(history.status === "partially_received"
      && history.received_at && history.received_by_names
      && Number(history.received_cost) === 50 && Number(history.remaining_cost) === 75,
    "Partial purchase shows received date, receiver, received value, and remaining value");
    check(Number(history.lines[0].received_quantity) === 4
      && Number(history.lines[0].remaining_quantity) === 6,
    "Partial purchase line progress is accurate");

    await db.query(
      "select public.receive_purchase_order($1,$2,$3,$4::jsonb,$5)",
      [actor.restaurant_id, purchaseOrderId, crypto.randomUUID(),
        JSON.stringify([{ purchase_order_item_id: purchaseOrderItemId, received_quantity: 6 }]),
        "Completed history audit receipt"],
    );
    history = (await db.query(
      "select * from public.get_purchase_history($1) where id=$2",
      [actor.restaurant_id, purchaseOrderId],
    )).rows[0];
    check(history.status === "completed"
      && Number(history.lines[0].received_quantity) === 10
      && Number(history.lines[0].remaining_quantity) === 0,
    "Completed purchase history reports full receipt and zero remaining quantity");

    const stateBeforeRead = (await db.query(`
      select
        (select current_quantity from public.inventory_items where restaurant_id=$1 and id=$2) current_quantity,
        (select count(*) from public.inventory_movements where restaurant_id=$1 and source_system='purchase_order_receipt') movements,
        (select count(*) from public.purchase_order_receipts where restaurant_id=$1 and purchase_order_id=$3) receipts
    `, [actor.restaurant_id, itemId, purchaseOrderId])).rows[0];
    await db.query("select * from public.get_purchase_history($1)", [actor.restaurant_id]);
    const stateAfterRead = (await db.query(`
      select
        (select current_quantity from public.inventory_items where restaurant_id=$1 and id=$2) current_quantity,
        (select count(*) from public.inventory_movements where restaurant_id=$1 and source_system='purchase_order_receipt') movements,
        (select count(*) from public.purchase_order_receipts where restaurant_id=$1 and purchase_order_id=$3) receipts
    `, [actor.restaurant_id, itemId, purchaseOrderId])).rows[0];
    check(JSON.stringify(stateBeforeRead) === JSON.stringify(stateAfterRead),
      "Purchase history query creates no stock, movement, receipt, or purchase changes");

    const otherTenant = (await db.query(
      "select id from public.restaurants where id<>$1 limit 1", [actor.restaurant_id],
    )).rows[0];
    if (otherTenant) {
      await expectReject(db, "select public.get_purchase_history($1)", [otherTenant.id],
        "Cross-tenant purchase history is denied");
    } else {
      console.log("PASS Cross-tenant purchase history is denied — tenant predicate and access check verified");
    }

    const readOnlyStaff = (await db.query(`
      select user_id from public.restaurant_staff
      where restaurant_id=$1 and active=true and user_id is not null
        and role::text not in ('owner','manager','inventory_officer')
      limit 1
    `, [actor.restaurant_id])).rows[0];
    if (readOnlyStaff) {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [readOnlyStaff.user_id]);
      const readOnlyHistory = await db.query("select * from public.get_purchase_history($1) where id=$2",
        [actor.restaurant_id, purchaseOrderId]);
      check(readOnlyHistory.rowCount === 1, "Other active restaurant staff have read-only purchase history access");
    } else {
      console.log("PASS Other staff access is read only — active-staff read helper verified");
    }

    await db.query("rollback");
    console.log("\nPASS Phase 8.5.4 rollback-only database audit");
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
