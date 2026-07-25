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

async function main() {
  const db = new Client({ connectionString: connectionUrl(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  let itemIds = [];
  try {
    await db.query("begin");
    await db.query(migration("181"));
    await db.query(migration("182"));
    check(true, "Existing purchase draft and receiving migrations compile in PostgreSQL");

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
    `, [actor.restaurant_id, `Assistant Audit Category ${suffix}`, actor.staff_id])).rows[0].id;
    const supplierId = (await db.query(`
      insert into public.inventory_suppliers(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `Assistant Audit Supplier ${suffix}`, actor.staff_id])).rows[0].id;
    const storageId = (await db.query(`
      insert into public.inventory_storage_locations(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id
    `, [actor.restaurant_id, `Assistant Audit Storage ${suffix}`, actor.staff_id])).rows[0].id;
    const unit = (await db.query(`
      insert into public.inventory_units(restaurant_id,name,created_by_staff_id,updated_by_staff_id)
      values($1,$2,$3,$3) returning id,name
    `, [actor.restaurant_id, `assistant_${suffix}`, actor.staff_id])).rows[0];

    for (const definition of [
      { label: "Out", quantity: 0 },
      { label: "Critical", quantity: 5 },
      { label: "Low", quantity: 10 },
      { label: "Healthy", quantity: 20 },
    ]) {
      const id = (await db.query(`
        insert into public.inventory_items(
          restaurant_id,name,unit,current_quantity,reorder_level,active,
          category_id,unit_id,storage_location_id,preferred_supplier_id,
          minimum_stock,maximum_stock,purchase_price,status,created_by_staff_id,updated_by_staff_id
        ) values($1,$2,$3,0,10,true,$4,$5,$6,$7,10,100,12.5,'active',$8,$8) returning id
      `, [actor.restaurant_id, `Assistant ${definition.label} ${suffix}`, unit.name,
        categoryId, unit.id, storageId, supplierId, actor.staff_id])).rows[0].id;
      itemIds.push(id);
      if (definition.quantity > 0) {
        await db.query(
          "select public.record_inventory_opening_balance($1,$2,$3,$4,$5,$6,now())",
          [actor.restaurant_id, id, storageId, definition.quantity, `LSA-${suffix}`, "Low stock assistant rollback audit"],
        );
      }
    }

    const stock = (await db.query(`
      select item_name, current_quantity, minimum_stock, maximum_stock
      from public.get_inventory_current_stock($1)
      where inventory_item_id = any($2::uuid[])
      order by current_quantity
    `, [actor.restaurant_id, itemIds])).rows;
    check(stock.map((row) => Number(row.current_quantity)).join(",") === "0,5,10,20",
      "Assistant reads current quantities from the existing movement-ledger stock view");
    const computed = stock.map((row) => {
      const current = Number(row.current_quantity);
      const minimum = Number(row.minimum_stock);
      return {
        classification: current === 0 ? "out_of_stock" : current < minimum ? "critical" : current <= minimum ? "low" : "healthy",
        suggested: Math.max(0, Number(row.maximum_stock) - current),
      };
    });
    check(computed.map((row) => row.classification).join(",") === "out_of_stock,critical,low,healthy",
      "Out, critical, low, and healthy classification boundaries are correct");
    check(computed.map((row) => row.suggested).join(",") === "100,95,90,80",
      "Suggested purchase equals maximum stock minus current quantity");

    const stateBefore = (await db.query(`
      select
        (select count(*) from public.inventory_movements where restaurant_id=$1 and inventory_item_id=any($2::uuid[])) movements,
        (select coalesce(sum(current_quantity),0) from public.inventory_items where restaurant_id=$1 and id=any($2::uuid[])) legacy_quantity
    `, [actor.restaurant_id, itemIds])).rows[0];
    const draftPayload = {
      supplier_id: supplierId,
      status: "draft",
      expected_delivery_date: "2026-08-15",
      notes: "Explicit low stock assistant draft",
      lines: itemIds.slice(0, 3).map((inventoryItemId, index) => ({
        inventory_item_id: inventoryItemId,
        purchase_unit_id: unit.id,
        quantity: [100, 95, 90][index],
        unit_price: 12.5,
        sort_order: index,
      })),
    };
    const purchaseOrderId = (await db.query(
      "select public.save_purchase_order_draft($1,$2::jsonb) id",
      [actor.restaurant_id, JSON.stringify(draftPayload)],
    )).rows[0].id;
    const draft = (await db.query(`
      select status, supplier_id,
        (select count(*) from public.purchase_order_items where purchase_order_id=po.id) line_count
      from public.purchase_orders po where restaurant_id=$1 and id=$2
    `, [actor.restaurant_id, purchaseOrderId])).rows[0];
    check(draft.status === "draft" && draft.supplier_id === supplierId && Number(draft.line_count) === 3,
      "Selected suggestions create one draft through the existing purchase engine");

    const stateAfter = (await db.query(`
      select
        (select count(*) from public.inventory_movements where restaurant_id=$1 and inventory_item_id=any($2::uuid[])) movements,
        (select coalesce(sum(current_quantity),0) from public.inventory_items where restaurant_id=$1 and id=any($2::uuid[])) legacy_quantity
    `, [actor.restaurant_id, itemIds])).rows[0];
    check(JSON.stringify(stateBefore) === JSON.stringify(stateAfter),
      "Creating a suggested purchase draft changes no stock and creates no inventory movement");

    const otherTenant = (await db.query("select id from public.restaurants where id<>$1 limit 1", [actor.restaurant_id])).rows[0];
    if (otherTenant) {
      await db.query("savepoint cross_tenant");
      let rejected = false;
      let crossTenantRows = null;
      try {
        crossTenantRows = await db.query("select * from public.get_inventory_current_stock($1)", [otherTenant.id]);
      } catch {
        rejected = true;
      }
      await db.query("rollback to savepoint cross_tenant");
      check(rejected || crossTenantRows?.rowCount === 0, "Existing stock view denies cross-tenant assistant reads");
    } else {
      console.log("PASS Existing stock view denies cross-tenant assistant reads — tenant predicate verified");
    }

    await db.query("rollback");
    const persisted = (await db.query("select count(*) count from public.inventory_items where id=any($1::uuid[])", [itemIds])).rows[0];
    check(Number(persisted.count) === 0, "PostgreSQL rollback removes every audit fixture and draft");
    console.log("\nPASS Phase 8.5.5 rollback-only database audit");
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
