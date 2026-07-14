const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

function envFile(file) {
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const split = line.indexOf("=");
    return [line.slice(0, split).trim(), line.slice(split + 1).trim().replace(/^['"]|['"]$/g, "")];
  }));
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const env = { ...envFile(path.join(root, ".env.local")), ...envFile(path.join(root, "supabase", "connection.env")) };
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ownerClient = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const managerClient = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  const restaurantId = crypto.randomUUID();
  const ownerEmail = `phase110-owner-${suffix}@serveflow.test`;
  const managerEmail = `phase110-manager-${suffix}@serveflow.test`;
  const ownerPassword = `Owner-${suffix}-A9!`;
  let ownerUserId = null;
  let managerUserId = null;
  const checks = [];
  const check = (label, value, detail = "") => checks.push({ label, value: Boolean(value), detail });

  await db.connect();
  try {
    const ownerAuth = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
    if (ownerAuth.error || !ownerAuth.data.user) throw new Error(ownerAuth.error?.message || "Could not seed audit owner.");
    ownerUserId = ownerAuth.data.user.id;
    await db.query("insert into public.restaurants(id,name,slug) values($1,$2,$3)", [restaurantId, "Phase 110 Audit", `phase-110-${suffix}`]);
    await db.query("insert into public.users(id,restaurant_id,role) values($1,$2,'owner')", [ownerUserId, restaurantId]);
    await db.query("insert into public.restaurant_staff(restaurant_id,user_id,role,display_name,email,active) values($1,$2,'owner','Phase 110 Owner',$3,true)", [restaurantId, ownerUserId, ownerEmail]);

    const ownerLogin = await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
    if (ownerLogin.error) throw new Error(ownerLogin.error.message);
    const created = await ownerClient.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName: "Phase 110 Manager", email: managerEmail, phoneNumber: "+251900000000", role: "manager" } });
    if (created.error || !created.data?.staffId || !created.data?.temporaryPassword) throw new Error(created.data?.error || created.error?.message || "Owner could not create Manager.");
    const managerRow = (await db.query("select id,user_id,role,active,phone_number from public.restaurant_staff where id=$1", [created.data.staffId])).rows[0];
    managerUserId = managerRow.user_id;
    check("Owner creates Manager through the existing staff function", managerRow.role === "manager" && managerRow.active && managerRow.phone_number === "+251900000000", JSON.stringify(managerRow));

    const updated = await ownerClient.functions.invoke("manage-staff", { body: { action: "update-staff", restaurantId, staffId: managerRow.id, fullName: "Phase 110 Manager Updated", phoneNumber: "+251911111111", role: "manager" } });
    check("Owner edits Manager details", !updated.error && updated.data?.ok === true);
    const deactivated = await ownerClient.functions.invoke("manage-staff", { body: { action: "deactivate-staff", restaurantId, staffId: managerRow.id } });
    const inactive = (await db.query("select active,staff_session_active from public.restaurant_staff where id=$1", [managerRow.id])).rows[0];
    check("Owner deactivates Manager", !deactivated.error && inactive.active === false && inactive.staff_session_active === false);
    const reactivated = await ownerClient.functions.invoke("manage-staff", { body: { action: "reactivate-staff", restaurantId, staffId: managerRow.id } });
    check("Owner reactivates Manager", !reactivated.error && reactivated.data?.ok === true);
    const reset = await ownerClient.functions.invoke("manage-staff", { body: { action: "generate-temporary-password", restaurantId, staffId: managerRow.id } });
    if (reset.error || !reset.data?.temporaryPassword) throw new Error(reset.data?.error || reset.error?.message || "Manager password reset failed.");
    check("Owner resets Manager password", Boolean(reset.data.temporaryPassword));

    const managerLogin = await managerClient.auth.signInWithPassword({ email: managerEmail, password: reset.data.temporaryPassword });
    check("Manager signs in successfully", !managerLogin.error && managerLogin.data.user?.id === managerUserId, managerLogin.error?.message || "");
    const self = await managerClient.from("restaurant_staff").select("id,role,active,restaurants(id,name)").eq("restaurant_id", restaurantId);
    check("Manager authentication resolves the Manager membership", !self.error && self.data?.length === 1 && self.data[0].role === "manager");
    const loginRecord = await managerClient.rpc("record_staff_login", { target_restaurant_id: restaurantId });
    const managerPresence = (await db.query("select last_login_at,staff_session_active from public.restaurant_staff where id=$1", [managerRow.id])).rows[0];
    check("Manager integrates with login and shift-presence tracking", !loginRecord.error && managerPresence.last_login_at && managerPresence.staff_session_active === true);

    const forbiddenCreate = await managerClient.functions.invoke("manage-staff", { body: { action: "create-staff", restaurantId, fullName: "Forbidden Manager", email: `forbidden-${suffix}@serveflow.test`, role: "manager" } });
    check("Manager cannot create another Manager", Boolean(forbiddenCreate.error) || forbiddenCreate.data?.error === "Only active restaurant owners can manage staff.");
    const managerReport = await managerClient.rpc("get_owner_ai_business_insights", { target_restaurant_id: restaurantId, range_start: new Date(Date.now() - 86400000).toISOString(), range_end: new Date().toISOString() });
    check("Manager receives no Owner AI report data", managerReport.error || managerReport.data === null);

    const ownerDirectory = await ownerClient.from("restaurant_staff").select("id,role,active").eq("restaurant_id", restaurantId).eq("id", managerRow.id).single();
    check("Manager appears in the Owner Staff Directory", !ownerDirectory.error && ownerDirectory.data?.role === "manager");
    const activity = await db.query("select action,details from public.staff_activity_log where restaurant_id=$1 and target_staff_id=$2 order by created_at", [restaurantId, managerRow.id]);
    check("Manager actions integrate with staff audit logs", activity.rows.some((row) => row.action === "staff_created") && activity.rows.some((row) => row.action === "staff_updated") && activity.rows.some((row) => row.action === "staff_deactivated") && activity.rows.some((row) => row.action === "staff_reactivated") && activity.rows.some((row) => row.action === "temporary_password_generated"), JSON.stringify(activity.rows));
  } finally {
    await ownerClient.auth.signOut().catch(() => {});
    await managerClient.auth.signOut().catch(() => {});
    if (managerUserId) await admin.auth.admin.deleteUser(managerUserId).catch(() => {});
    if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId).catch(() => {});
    await db.query("delete from public.restaurants where id=$1", [restaurantId]).catch(() => {});
    await db.end();
  }

  for (const result of checks) console.log(`${result.value ? "PASS" : "FAIL"} ${result.label}${result.detail ? ` - ${result.detail}` : ""}`);
  if (checks.some((result) => !result.value)) process.exitCode = 1;
  else console.log("\nPASS");
}

main().catch((error) => { console.error(`FAIL audit crashed - ${error.message}`); process.exit(1); });
