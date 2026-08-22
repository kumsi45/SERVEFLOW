const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

function envFile(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^["']|["']$/g, "")];
  }));
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const env = { ...envFile(path.join(root, ".env.local")), ...envFile(path.join(root, "supabase", "connection.env")) };
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = client(), manager = client(), officer = client();
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  const suffix = crypto.randomUUID().slice(0, 8), restaurantId = crypto.randomUUID(), otherRestaurantId = crypto.randomUUID();
  const password = `Audit-${suffix}-A9!`;
  const emails = { owner: `io-owner-${suffix}@serveflow.test`, manager: `io-manager-${suffix}@serveflow.test`, ownerOfficer: `io-by-owner-${suffix}@serveflow.test`, managerOfficer: `io-by-manager-${suffix}@serveflow.test`, chef: `io-chef-${suffix}@serveflow.test` };
  const authIds = [];
  const checks = [];
  const check = (label, value) => checks.push({ label, value: Boolean(value) });

  await db.connect();
  try {
    const seededOwner = await admin.auth.admin.createUser({ email: emails.owner, password, email_confirm: true });
    if (seededOwner.error || !seededOwner.data.user) throw new Error(seededOwner.error?.message || "Owner seed failed");
    authIds.push(seededOwner.data.user.id);
    await db.query("insert into restaurants(id,name,slug) values($1,'IO Auth Audit',$2),($3,'IO Isolation Audit',$4)", [restaurantId, `io-auth-${suffix}`, otherRestaurantId, `io-other-${suffix}`]);
    await db.query("insert into users(id,restaurant_id,role) values($1,$2,'owner')", [seededOwner.data.user.id, restaurantId]);
    await db.query("insert into restaurant_staff(restaurant_id,user_id,role,display_name,email,active) values($1,$2,'owner','Audit Owner',$3,true)", [restaurantId, seededOwner.data.user.id, emails.owner]);
    if ((await owner.auth.signInWithPassword({ email: emails.owner, password })).error) throw new Error("Owner login failed");

    const create = async (actor, fullName, email, role) => actor.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName, email, password, role } });
    const managerCreated = await create(owner, "Audit Manager", emails.manager, "manager");
    if (managerCreated.error || !managerCreated.data?.staffId) throw new Error(managerCreated.data?.error || managerCreated.error?.message || "Manager creation failed");
    const managerRow = (await db.query("select user_id from restaurant_staff where id=$1", [managerCreated.data.staffId])).rows[0]; authIds.push(managerRow.user_id);
    if ((await manager.auth.signInWithPassword({ email: emails.manager, password })).error) throw new Error("Manager login failed");
    const managerReadiness = (await db.query("select readiness from staff_credential_readiness where staff_id=$1", [managerCreated.data.staffId])).rows[0];
    check("New Manager is password ready", managerReadiness?.readiness === "password_ready");
    const terminalRows = await client().rpc("get_restaurant_terminal_staff", { target_restaurant_slug: `io-auth-${suffix}` });
    check("New Manager is excluded from legacy terminal", !terminalRows.error && !(terminalRows.data || []).some((row) => row.staff_id === managerCreated.data.staffId));

    const byOwner = await create(owner, "Owner Created Officer", emails.ownerOfficer, "inventory_officer");
    check("Owner creates Inventory Officer", !byOwner.error && byOwner.data?.staffId);
    const byManager = await create(manager, "Manager Created Officer", emails.managerOfficer, "inventory_officer");
    check("Manager creates Inventory Officer", !byManager.error && byManager.data?.staffId);
    for (const result of [byOwner, byManager]) if (result.data?.staffId) authIds.push((await db.query("select user_id from restaurant_staff where id=$1", [result.data.staffId])).rows[0].user_id);
    const chef = await create(manager, "Unassigned Chef", emails.chef, "kitchen");
    check("Manager creates Chef with email and password", !chef.error && chef.data?.staffId);
    if (chef.data?.staffId) {
      const chefRow = (await db.query("select user_id,assigned_kitchen_station_id from restaurant_staff where id=$1", [chef.data.staffId])).rows[0];
      authIds.push(chefRow.user_id);
      check("New Chef remains unassigned", chefRow.assigned_kitchen_station_id === null);
    }
    const waiter = await manager.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName: "PIN Waiter", pin: "7391", role: "waiter" } });
    check("Manager creates Waiter with PIN and no email", !waiter.error && waiter.data?.staffId);
    if (waiter.data?.staffId) {
      const waiterRow = (await db.query("select user_id from restaurant_staff where id=$1", [waiter.data.staffId])).rows[0];
      authIds.push(waiterRow.user_id);
      const waiterReady = (await db.query("select readiness from staff_credential_readiness where staff_id=$1", [waiter.data.staffId])).rows[0];
      check("New Waiter is PIN ready", waiterReady?.readiness === "waiter_pin_ready");
    }
    const pinOnly = await manager.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName: "PIN Only Cashier", email: `pin-only-${suffix}@serveflow.test`, pin: "1234", role: "cashier" } });
    check("Privileged PIN-only creation is rejected", Boolean(pinOnly.error));

    const officerLogin = await officer.auth.signInWithPassword({ email: emails.managerOfficer, password });
    check("Inventory Officer logs in", !officerLogin.error);
    const officerCreate = await create(officer, "Forbidden Staff", `io-forbidden-${suffix}@serveflow.test`, "cashier");
    check("Inventory Officer cannot create staff", Boolean(officerCreate.error));
    check("Manager cannot create Manager", Boolean((await create(manager, "Forbidden Manager", `io-manager2-${suffix}@serveflow.test`, "manager")).error));
    const ownerTarget = await manager.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName: "Forbidden Owner", email: `io-owner2-${suffix}@serveflow.test`, password, role: "owner" } });
    check("Manager cannot create Owner", Boolean(ownerTarget.error));
    const crossTenant = await manager.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId: otherRestaurantId, fullName: "Cross Tenant", email: `cross-${suffix}@serveflow.test`, password, role: "cashier" } });
    check("Cross-tenant creation is denied", Boolean(crossTenant.error));
    const nonWaiterPin = await manager.functions.invoke("manage-staff", { body: { action: "set-waiter-pin", restaurantId, staffId: byManager.data?.staffId, pin: "5521" } });
    check("Non-Waiter cannot receive waiter PIN", Boolean(nonWaiterPin.error));
    const anonymousCreate = await client().functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName: "Anonymous", email: `anonymous-${suffix}@serveflow.test`, password, role: "cashier" } });
    check("Anonymous staff creation is denied", Boolean(anonymousCreate.error));
    const secretColumns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='restaurant_staff' and column_name ~* '(password|pin)'" )).rows;
    check("restaurant_staff stores no password or PIN column", secretColumns.length === 0);
    const foreign = await officer.from("restaurant_staff").select("id").eq("restaurant_id", otherRestaurantId);
    check("Restaurant isolation remains intact", !foreign.error && foreign.data.length === 0);
  } finally {
    await Promise.all([owner.auth.signOut(), manager.auth.signOut(), officer.auth.signOut()].map((p) => p.catch(() => {})));
    for (const id of [...new Set(authIds)]) await admin.auth.admin.deleteUser(id).catch(() => {});
    await db.query("delete from restaurants where id=any($1)", [[restaurantId, otherRestaurantId]]).catch(() => {});
    await db.end();
  }
  for (const result of checks) console.log(`${result.value ? "PASS" : "FAIL"} ${result.label}`);
  if (checks.some((result) => !result.value)) process.exit(1);
}

main().catch((error) => { console.error(`FAIL ${error.message}`); process.exit(1); });
