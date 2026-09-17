// Candidate-only validation. It never commits the parked original Migration 264 candidate or its fixtures.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");

const root = path.resolve(__dirname, "../..");
const migration = fs.readFileSync(path.join(root, "supabase/parked-migrations/owner_menu_item_creation_atomic_idempotent.PARKED.sql"), "utf8");
const config = fs.readFileSync(path.join(root, "supabase/connection.env"), "utf8");
const url = config.match(/^\s*SUPABASE_DB_URL\s*=\s*(.+)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, "");
if (!url) throw new Error("SUPABASE_DB_URL missing");
const client = () => new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
const check = (label, condition) => { assert.ok(condition, label); console.log(`PASS ${label}`); };

async function asUser(db, userId, action) {
  await db.query("savepoint owner_menu_actor");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [userId, JSON.stringify({ sub: userId, role: "authenticated", iss: "https://rollback-validation.supabase.co/auth/v1" })]);
    return await action();
  } catch (error) {
    await db.query("rollback to savepoint owner_menu_actor");
    throw error;
  } finally {
    await db.query("reset role");
    await db.query("release savepoint owner_menu_actor");
  }
}
async function denied(db, label, action) {
  let error;
  try { await action(); } catch (caught) { error = caught; }
  check(label, Boolean(error));
}
const call = (db, restaurant, request, payload) => db.query("select public.create_owner_menu_item_v1($1,$2,$3::jsonb) result", [restaurant, request, JSON.stringify(payload)]).then(r => r.rows[0].result);

async function main() {
  const db = client();
  await db.connect();
  const baseline = await db.query("select to_regclass('public.menu_item_creation_operations') operation_table, to_regprocedure('public.create_owner_menu_item_v1(uuid,uuid,jsonb)') create_function, to_regprocedure('public.finalize_owner_menu_item_photo_v1(uuid,uuid,uuid,text)') finalize_function");
  const f = { a: randomUUID(), b: randomUUID(), ownerA: randomUUID(), ownerB: randomUUID(), manager: randomUUID(), cashier: randomUUID(), kitchen: randomUUID(), waiter: randomUUID(), inactive: randomUUID(), ownerStaffA: randomUUID(), ownerStaffB: randomUUID(), categoryA: randomUUID(), categoryB: randomUUID(), stationA: randomUUID(), stationB: randomUUID(), inventoryCategoryA: randomUUID(), inventoryCategoryB: randomUUID(), unitA: randomUUID(), unitB: randomUUID(), storageA: randomUUID(), storageB: randomUUID(), inventoryA: randomUUID(), inventoryB: randomUUID() };
  const userIds = [f.ownerA, f.ownerB, f.manager, f.cashier, f.kitchen, f.waiter, f.inactive];
  const payload = { name: "Rollback no tracking", description: null, price: 12.5, category_id: f.categoryA, new_category_name: null, tracking_mode: "no_tracking", recipe_id: null, direct_inventory_item_id: null, kitchen_station_id: f.stationA, available: false, ingredients: [], preparation_time_minutes: 0, calories: null, protein_g: null, carbohydrates_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null, photo_content_type: null };
  try {
    await db.query("begin");
    await db.query("set local lock_timeout='3s'; set local statement_timeout='8s'");
    await db.query(migration);
    check("Parked original Migration 264 candidate applies inside caller transaction without an internal envelope", true);
    for (const id of userIds) await db.query("insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),now())", [id, `${id}@owner-menu-rollback.invalid`]);
    await db.query("insert into public.restaurants(id,name,slug,total_tables,table_count) values($1,'Owner menu rollback A',$2,1,1),($3,'Owner menu rollback B',$4,1,1)", [f.a, `owner-menu-a-${f.a}`, f.b, `owner-menu-b-${f.b}`]);
    for (const [staffId, user, restaurant, role, active] of [[f.ownerStaffA,f.ownerA,f.a,"owner",true],[f.ownerStaffB,f.ownerB,f.b,"owner",true],[randomUUID(),f.manager,f.a,"manager",true],[randomUUID(),f.cashier,f.a,"cashier",true],[randomUUID(),f.kitchen,f.a,"kitchen",true],[randomUUID(),f.waiter,f.a,"waiter",true],[randomUUID(),f.inactive,f.a,"owner",false]]) await db.query("insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,email,active) values($1,$2,$3,$4,$5,$6,$7)", [staffId, restaurant, user, role, role, `${user}@owner-menu-rollback.invalid`, active]);
    await db.query("insert into public.categories(id,restaurant_id,name) values($1,$2,'Rollback Category'),($3,$4,'Other Category')", [f.categoryA,f.a,f.categoryB,f.b]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name,active,is_default) values($1,$2,'Rollback Station',true,true),($3,$4,'Other Station',true,true)", [f.stationA,f.a,f.stationB,f.b]);
    await db.query("insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Rollback inventory A','active',$3,$3),($4,$5,'Rollback inventory B','active',$6,$6)", [f.inventoryCategoryA,f.a,f.ownerStaffA,f.inventoryCategoryB,f.b,f.ownerStaffB]);
    await db.query("insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'unit','active',$3,$3),($4,$5,'unit','active',$6,$6)", [f.unitA,f.a,f.ownerStaffA,f.unitB,f.b,f.ownerStaffB]);
    await db.query("insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Rollback storage A','active',$3,$3),($4,$5,'Rollback storage B','active',$6,$6)", [f.storageA,f.a,f.ownerStaffA,f.storageB,f.b,f.ownerStaffB]);
    await db.query("insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,minimum_stock,status,created_by_staff_id,updated_by_staff_id) values($1,$2,'Rollback inventory item A','unit',1,0,true,$3,$4,$5,0,'active',$6,$6),($7,$8,'Rollback inventory item B','unit',1,0,true,$9,$10,$11,0,'active',$12,$12)", [f.inventoryA,f.a,f.inventoryCategoryA,f.unitA,f.storageA,f.ownerStaffA,f.inventoryB,f.b,f.inventoryCategoryB,f.unitB,f.storageB,f.ownerStaffB]);
    const request = randomUUID();
    const first = await asUser(db, f.ownerA, () => call(db, f.a, request, payload));
    check("Owner creates one unavailable No Tracking item with explicit same-tenant station", first.menu_item.available === false && first.menu_item.kitchen_station_id === f.stationA && first.tracking_mode === "no_tracking");
    const replay = await asUser(db, f.ownerA, () => call(db, f.a, request, payload));
    check("same request and canonical payload replays the canonical item", replay.replayed === true && replay.menu_item.id === first.menu_item.id);
    await denied(db, "same request with different payload fails closed", () => asUser(db, f.ownerA, () => call(db, f.a, request, { ...payload, price: 13 })));
    const duplicateName = await asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), payload));
    check("different request IDs permit legitimate same-name menu items", duplicateName.menu_item.id !== first.menu_item.id);
    const categoryRequest = randomUUID();
    const newCategory = await asUser(db, f.ownerA, () => call(db, f.a, categoryRequest, { ...payload, name: "New category item", category_id: null, new_category_name: "  New Category  ", kitchen_station_id: null }));
    check("normalized new category creation is part of the authoritative result", Boolean(newCategory.category.id));
    await denied(db, "forged restaurant is denied", () => asUser(db, f.ownerA, () => call(db, f.b, randomUUID(), payload)));
    await denied(db, "cross-tenant category is denied", () => asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), { ...payload, category_id: f.categoryB })));
    await denied(db, "cross-tenant station is denied", () => asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), { ...payload, kitchen_station_id: f.stationB })));
    for (const [label, user] of [["Manager",f.manager],["Cashier",f.cashier],["Kitchen",f.kitchen],["Waiter",f.waiter],["inactive Owner",f.inactive]]) {
      console.log(`CHECK ${label} denial`);
      await denied(db, `${label} is denied`, () => asUser(db, user, () => call(db, f.a, randomUUID(), payload)));
    }
    await denied(db, "anonymous is denied", async () => { await db.query("savepoint anonymous_owner_menu; set local role anon"); try { await call(db, f.a, randomUUID(), payload); } catch (error) { await db.query("rollback to savepoint anonymous_owner_menu"); throw error; } finally { await db.query("reset role; release savepoint anonymous_owner_menu"); } });
    await denied(db, "direct client mutation of the operation table is denied", () => asUser(db, f.ownerA, () => db.query("insert into public.menu_item_creation_operations(restaurant_id,request_id,actor_user_id,request_fingerprint,menu_item_id,result,photo_state) values($1,$2,$3,'forged',$4,'{}','none')", [f.a, randomUUID(), f.ownerA, first.menu_item.id])));

    const recipeA = await asUser(db, f.ownerA, () => db.query("select public.manage_recipe('create', $1::jsonb) recipe", [JSON.stringify({ restaurant_id: f.a, name: "Rollback active recipe", status: "active", yield_quantity: 1, yield_unit: "serving" })]).then(r => r.rows[0].recipe));
    const recipeB = await asUser(db, f.ownerB, () => db.query("select public.manage_recipe('create', $1::jsonb) recipe", [JSON.stringify({ restaurant_id: f.b, name: "Rollback foreign recipe", status: "active", yield_quantity: 1, yield_unit: "serving" })]).then(r => r.rows[0].recipe));
    const recipeItem = await asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), { ...payload, name: "Existing recipe item", tracking_mode: "recipe", recipe_id: recipeA.id, kitchen_station_id: null }));
    check("existing active same-tenant Recipe is retained", recipeItem.recipe_id === recipeA.id && recipeItem.auto_created_recipe === false);
    await denied(db, "invalid Recipe is denied", () => asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), { ...payload, tracking_mode: "recipe", recipe_id: randomUUID() })));
    await denied(db, "cross-tenant Recipe is denied", () => asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), { ...payload, tracking_mode: "recipe", recipe_id: recipeB.id })));
    const automaticRecipeRequest = randomUUID();
    const automaticRecipe = await asUser(db, f.ownerA, () => call(db, f.a, automaticRecipeRequest, { ...payload, name: "Automatic recipe item", tracking_mode: "recipe", recipe_id: null, kitchen_station_id: null }));
    const automaticReplay = await asUser(db, f.ownerA, () => call(db, f.a, automaticRecipeRequest, { ...payload, name: "Automatic recipe item", tracking_mode: "recipe", recipe_id: null, kitchen_station_id: null }));
    check("operation-created Recipe is atomic and same-key replay creates no second Recipe", automaticRecipe.auto_created_recipe === true && automaticRecipe.recipe_id && automaticReplay.recipe_id === automaticRecipe.recipe_id && automaticReplay.replayed === true);

    const directItem = await asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), { ...payload, name: "Direct inventory item", tracking_mode: "direct_inventory", direct_inventory_item_id: f.inventoryA, kitchen_station_id: null }));
    check("active same-tenant Direct Inventory is retained", directItem.menu_item.direct_inventory_item_id === f.inventoryA);
    await denied(db, "cross-tenant Direct Inventory is denied", () => asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), { ...payload, tracking_mode: "direct_inventory", direct_inventory_item_id: f.inventoryB })));
    await denied(db, "Recipe and Direct Inventory together are denied", () => asUser(db, f.ownerA, () => call(db, f.a, randomUUID(), { ...payload, tracking_mode: "recipe", recipe_id: recipeA.id, direct_inventory_item_id: f.inventoryA })));

    const photoRequest = randomUUID();
    const photo = await asUser(db, f.ownerA, () => call(db, f.a, photoRequest, { ...payload, name: "Photo item", kitchen_station_id: null, photo_content_type: "image/png" }));
    check("photo creation returns the deterministic tenant/item/request path", photo.photo_object_path === `${f.a}/${photo.menu_item.id}/${photoRequest}.png` && photo.photo_state === "pending");
    await denied(db, "photo finalization before upload is denied", () => asUser(db, f.ownerA, () => db.query("select public.finalize_owner_menu_item_photo_v1($1,$2,$3,$4)", [f.a, photoRequest, photo.menu_item.id, photo.photo_object_path])));
    await db.query("insert into storage.objects(bucket_id,name) values('menu-photos',$1)", [photo.photo_object_path]);
    await denied(db, "arbitrary photo path is denied", () => asUser(db, f.ownerA, () => db.query("select public.finalize_owner_menu_item_photo_v1($1,$2,$3,$4)", [f.a, photoRequest, photo.menu_item.id, `${f.a}/${randomUUID()}.png`])));
    const finalized = await asUser(db, f.ownerA, () => db.query("select public.finalize_owner_menu_item_photo_v1($1,$2,$3,$4) result", [f.a, photoRequest, photo.menu_item.id, photo.photo_object_path]).then(r => r.rows[0].result));
    const finalReplay = await asUser(db, f.ownerA, () => db.query("select public.finalize_owner_menu_item_photo_v1($1,$2,$3,$4) result", [f.a, photoRequest, photo.menu_item.id, photo.photo_object_path]).then(r => r.rows[0].result));
    check("uploaded exact photo finalizes once with a JWT-issuer URL and then replays", finalized.photo_state === "attached" && finalized.image_url === `https://rollback-validation.supabase.co/storage/v1/object/public/menu-photos/${photo.photo_object_path}` && finalReplay.replayed === true);
    const count = await db.query("select count(*)::int count from public.menu_item_creation_operations where restaurant_id=$1", [f.a]);
    check("operation table persists one row per successful logical request", count.rows[0].count === 7);
    await db.query("rollback");
    const restored = await db.query("select to_regclass('public.menu_item_creation_operations') operation_table, to_regprocedure('public.create_owner_menu_item_v1(uuid,uuid,jsonb)') create_function, to_regprocedure('public.finalize_owner_menu_item_photo_v1(uuid,uuid,uuid,text)') finalize_function");
    check("rollback removes all candidate objects and fixtures", JSON.stringify(restored.rows[0]) === JSON.stringify(baseline.rows[0]));
  } finally { await db.query("rollback").catch(() => {}); await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
