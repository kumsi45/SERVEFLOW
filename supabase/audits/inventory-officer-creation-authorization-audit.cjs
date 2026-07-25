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
  const emails = { owner: `io-owner-${suffix}@serveflow.test`, manager: `io-manager-${suffix}@serveflow.test`, ownerOfficer: `io-by-owner-${suffix}@serveflow.test`, managerOfficer: `io-by-manager-${suffix}@serveflow.test` };
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

    const create = async (actor, fullName, email, role) => actor.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName, email, pinPassword: password, role } });
    const managerCreated = await create(owner, "Audit Manager", emails.manager, "manager");
    if (managerCreated.error || !managerCreated.data?.staffId) throw new Error(managerCreated.data?.error || managerCreated.error?.message || "Manager creation failed");
    const managerRow = (await db.query("select user_id from restaurant_staff where id=$1", [managerCreated.data.staffId])).rows[0]; authIds.push(managerRow.user_id);
    if ((await manager.auth.signInWithPassword({ email: emails.manager, password })).error) throw new Error("Manager login failed");

    const byOwner = await create(owner, "Owner Created Officer", emails.ownerOfficer, "inventory_officer");
    check("Owner creates Inventory Officer", !byOwner.error && byOwner.data?.staffId);
    const byManager = await create(manager, "Manager Created Officer", emails.managerOfficer, "inventory_officer");
    check("Manager creates Inventory Officer", !byManager.error && byManager.data?.staffId);
    for (const result of [byOwner, byManager]) if (result.data?.staffId) authIds.push((await db.query("select user_id from restaurant_staff where id=$1", [result.data.staffId])).rows[0].user_id);

    const officerLogin = await officer.auth.signInWithPassword({ email: emails.managerOfficer, password });
    check("Inventory Officer logs in", !officerLogin.error);
    const officerCreate = await create(officer, "Forbidden Staff", `io-forbidden-${suffix}@serveflow.test`, "cashier");
    check("Inventory Officer cannot create staff", Boolean(officerCreate.error));
    check("Manager cannot create Manager", Boolean((await create(manager, "Forbidden Manager", `io-manager2-${suffix}@serveflow.test`, "manager")).error));
    const ownerTarget = await manager.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName: "Forbidden Owner", email: `io-owner2-${suffix}@serveflow.test`, pinPassword: password, role: "owner" } });
    check("Manager cannot create Owner", Boolean(ownerTarget.error));
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
