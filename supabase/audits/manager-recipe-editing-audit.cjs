const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function connectionUrl() {
  const line = fs.readFileSync(path.join(__dirname, "..", "connection.env"), "utf8")
    .split(/\r?\n/).find((entry) => /^\s*SUPABASE_DB_URL\s*=/.test(entry));
  if (!line) throw new Error("SUPABASE_DB_URL missing");
  return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
}

async function asUser(client, userId) {
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
}

async function expectRejected(client, name, action) {
  await client.query(`savepoint ${name}`);
  let rejected = false;
  try { await action(); } catch { rejected = true; }
  await client.query(`rollback to savepoint ${name}`);
  return rejected;
}

async function main() {
  const client = new Client({ connectionString: connectionUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const staff = await client.query(`
      select restaurant_id, user_id, role::text
      from restaurant_staff
      where active and user_id is not null and role::text in ('owner','manager','inventory_officer')
      order by restaurant_id, case role::text when 'manager' then 0 when 'owner' then 1 else 2 end
    `);
    const managers = staff.rows.filter((row) => row.role === "owner" || row.role === "manager");
    const actorA = managers.find((row) => managers.some((other) => other.restaurant_id !== row.restaurant_id));
    const actorB = actorA && managers.find((row) => row.restaurant_id !== actorA.restaurant_id);
    if (!actorA || !actorB) throw new Error("Audit requires owner/manager fixtures in two restaurants.");

    await client.query("begin");
    const nonce = Date.now();
    async function createCatalogFixture(restaurantId, label) {
      const unit = (await client.query(
        "insert into inventory_units(restaurant_id,name) values($1,$2) returning id",
        [restaurantId, `AuditUnit${label}${nonce}`.slice(0, 40)],
      )).rows[0];
      const category = (await client.query(
        "insert into inventory_categories(restaurant_id,name) values($1,$2) returning id",
        [restaurantId, `Recipe Audit Category ${label} ${nonce}`],
      )).rows[0];
      const location = (await client.query(
        "insert into inventory_storage_locations(restaurant_id,name) values($1,$2) returning id",
        [restaurantId, `Recipe Audit Storage ${label} ${nonce}`],
      )).rows[0];
      const item = (await client.query(`
        insert into inventory_items(
          restaurant_id,name,unit,current_quantity,reorder_level,active,
          category_id,unit_id,storage_location_id,status
        ) values($1,$2,$3,0,0,true,$4,$5,$6,'active') returning id
      `, [restaurantId, `Recipe Audit Item ${label} ${nonce}`, `AuditUnit${label}${nonce}`.slice(0, 40), category.id, unit.id, location.id])).rows[0];
      return { item_id: item.id, unit_id: unit.id };
    }
    const catalogA = await createCatalogFixture(actorA.restaurant_id, "A");
    const catalogB = await createCatalogFixture(actorB.restaurant_id, "B");
    await asUser(client, actorA.user_id);
    const recipeA = (await client.query("select manage_recipe($1,$2::jsonb) value", ["create", JSON.stringify({
      restaurant_id: actorA.restaurant_id, name: `Manager Recipe Audit A ${Date.now()}`, description: null,
      category_id: null, preparation_time_minutes: 10, yield_quantity: 1, yield_unit: "serving", status: "draft",
    })])).rows[0].value;

    await client.query("reset role");
    await asUser(client, actorB.user_id);
    const recipeB = (await client.query("select manage_recipe($1,$2::jsonb) value", ["create", JSON.stringify({
      restaurant_id: actorB.restaurant_id, name: `Manager Recipe Audit B ${Date.now()}`, description: null,
      category_id: null, preparation_time_minutes: 10, yield_quantity: 1, yield_unit: "serving", status: "draft",
    })])).rows[0].value;
    const ingredientB = (await client.query("select manage_recipe_ingredient($1,$2::jsonb) value", ["create", JSON.stringify({
      restaurant_id: actorB.restaurant_id, recipe_id: recipeB.id, inventory_item_id: catalogB.item_id,
      quantity_required: 1, unit_id: catalogB.unit_id, optional_notes: null, sort_order: 100,
    })])).rows[0].value;

    await client.query("reset role");
    await asUser(client, actorA.user_id);
    const tenantBInventoryVisible = Number((await client.query(
      "select count(*) count from inventory_items where restaurant_id=$1", [actorB.restaurant_id],
    )).rows[0].count);
    const crossTenantAddDenied = await expectRejected(client, "cross_tenant_add", () => client.query(
      "select manage_recipe_ingredient($1,$2::jsonb)", ["create", JSON.stringify({
        restaurant_id: actorA.restaurant_id, recipe_id: recipeA.id, inventory_item_id: catalogB.item_id,
        quantity_required: 1, unit_id: catalogA.unit_id, optional_notes: null, sort_order: 100,
      })],
    ));
    const crossTenantRecipeEditDenied = await expectRejected(client, "cross_tenant_recipe_edit", () => client.query(
      "select manage_recipe($1,$2::jsonb)", ["update", JSON.stringify({ ...recipeB, restaurant_id: actorB.restaurant_id, recipe_id: recipeB.id })],
    ));
    const crossTenantRemoveDenied = await expectRejected(client, "cross_tenant_remove", () => client.query(
      "select manage_recipe_ingredient($1,$2::jsonb)", ["delete", JSON.stringify({
        restaurant_id: actorB.restaurant_id, recipe_id: recipeB.id, ingredient_id: ingredientB.id,
      })],
    ));

    const readOnly = staff.rows.find((row) => row.role === "inventory_officer");
    let unauthorizedRoleDenied = true;
    if (readOnly) {
      await client.query("reset role");
      await asUser(client, readOnly.user_id);
      unauthorizedRoleDenied = await expectRejected(client, "unauthorized_role", () => client.query(
        "select manage_recipe_ingredient($1,$2::jsonb)", ["delete", JSON.stringify({
          restaurant_id: readOnly.restaurant_id, recipe_id: recipeA.id, ingredient_id: ingredientB.id,
        })],
      ));
    }

    await client.query("reset role");
    await client.query("rollback");
    const checks = {
      tenantBInventoryHidden: tenantBInventoryVisible === 0,
      crossTenantAddDenied,
      crossTenantRecipeEditDenied,
      crossTenantRemoveDenied,
      unauthorizedRoleDenied,
      unauthorizedFixtureTested: Boolean(readOnly),
    };
    const passed = Object.entries(checks).filter(([key]) => key !== "unauthorizedFixtureTested").every(([, value]) => value);
    console.log(JSON.stringify({ passed, checks }));
    if (!passed) process.exitCode = 1;
  } catch (error) {
    await client.query("reset role").catch(() => undefined);
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { await client.end(); }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
