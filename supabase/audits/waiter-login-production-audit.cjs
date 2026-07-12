const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const root = path.resolve(__dirname, "../..");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2];
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function waiterEmail(restaurantId, username) {
  return `${username}.${restaurantId.replace(/-/g, "")}@waiter.serveflow.local`;
}

async function createAuthUser(admin, email, password, role, username) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `${role} audit`, serveflow_role: role, username },
  });

  if (error || !data.user) {
    throw new Error(error?.message || `Could not create ${role} auth user.`);
  }

  return data.user;
}

async function insertStaff(admin, restaurantId, user, role, username, active = true) {
  const { data, error } = await admin
    .from("restaurant_staff")
    .insert({
      restaurant_id: restaurantId,
      user_id: user.id,
      role,
      display_name: `${role} audit`,
      email: user.email,
      username: role === "waiter" ? username : null,
      active,
    })
    .select("id,restaurant_id,user_id,role,email,username,active")
    .single();

  if (error || !data) {
    throw new Error(error?.message || `Could not create ${role} staff row.`);
  }

  return data;
}

async function signInAndLoadTables(anonUrl, anonKey, slug, username, password) {
  const client = createClient(anonUrl, anonKey, { auth: { persistSession: false } });

  const identity = await client.rpc("resolve_waiter_login_identity", {
    target_restaurant_slug: slug,
    waiter_username: username,
  });

  if (identity.error) {
    throw new Error(identity.error.message);
  }

  const row = Array.isArray(identity.data) ? identity.data[0] : null;
  if (!row?.email) {
    return { ok: false, stage: "identity", row: null };
  }

  const auth = await client.auth.signInWithPassword({ email: row.email, password });
  if (auth.error || !auth.data.user) {
    return { ok: false, stage: "password", row };
  }

  const loginRecord = await client.rpc("record_waiter_login", {
    target_restaurant_id: row.restaurant_id,
  });
  if (loginRecord.error) {
    return { ok: false, stage: "record_login", row, error: loginRecord.error.message };
  }

  const tables = await client.rpc("get_waiter_dashboard_tables", {
    target_restaurant_slug: row.restaurant_slug,
  });
  if (tables.error) {
    return { ok: false, stage: "dashboard", row, error: tables.error.message };
  }

  return { ok: true, stage: "dashboard", row, tableCount: tables.data.length };
}

async function main() {
  loadEnv();

  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  assert(url, "VITE_SUPABASE_URL missing");
  assert(anonKey, "VITE_SUPABASE_ANON_KEY missing");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY missing");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const createdUsers = [];
  const createdStaff = [];
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const waiterUsername = `wla${suffix}`;
  const inactiveUsername = `wli${suffix}`;
  const otherUsername = `wlo${suffix}`;
  const password = `1234${String(suffix).slice(-4)}`;

  try {
    const { data: restaurants, error: restaurantsError } = await admin
      .from("restaurants")
      .select("id,slug,name,active")
      .eq("active", true)
      .limit(2);

    assert(!restaurantsError, restaurantsError?.message);
    assert(restaurants && restaurants.length >= 2, "Audit requires at least two active restaurants.");

    const primary = restaurants[0];
    const other = restaurants[1];

    const waiterUser = await createAuthUser(admin, waiterEmail(primary.id, waiterUsername), password, "waiter", waiterUsername);
    createdUsers.push(waiterUser.id);
    const waiterStaff = await insertStaff(admin, primary.id, waiterUser, "waiter", waiterUsername, true);
    createdStaff.push(waiterStaff.id);

    assert(waiterStaff.user_id === waiterUser.id, "waiter staff user_id does not match auth user");
    assert(waiterStaff.restaurant_id === primary.id, "waiter restaurant_id mismatch");
    assert(waiterStaff.role === "waiter", "waiter role mismatch");
    assert(waiterStaff.active === true, "waiter active flag mismatch");
    assert(waiterStaff.username === waiterUsername, "waiter username mismatch");

    const duplicateCheck = await admin
      .from("restaurant_staff")
      .select("id")
      .eq("restaurant_id", primary.id)
      .ilike("username", waiterUsername);
    assert(!duplicateCheck.error, duplicateCheck.error?.message);
    assert(duplicateCheck.data.length === 1, "waiter username is not unique inside restaurant");

    const activeLogin = await signInAndLoadTables(url, anonKey, primary.slug, waiterUsername, password);
    assert(activeLogin.ok, `active waiter login failed at ${activeLogin.stage}`);
    assert(activeLogin.row.user_id === waiterUser.id, "RPC returned the wrong waiter auth user id");
    assert(activeLogin.row.restaurant_slug === primary.slug, "RPC did not return canonical restaurant slug");

    const nonCanonicalRestaurantIdentifier = primary.name;
    const nonCanonicalLogin = await signInAndLoadTables(url, anonKey, nonCanonicalRestaurantIdentifier, waiterUsername, password);
    assert(nonCanonicalLogin.ok, `non-canonical waiter login failed at ${nonCanonicalLogin.stage}`);
    assert(nonCanonicalLogin.row.restaurant_slug === primary.slug, "non-canonical waiter login did not return canonical slug");

    const inactiveUser = await createAuthUser(admin, waiterEmail(primary.id, inactiveUsername), password, "waiter", inactiveUsername);
    createdUsers.push(inactiveUser.id);
    const inactiveStaff = await insertStaff(admin, primary.id, inactiveUser, "waiter", inactiveUsername, false);
    createdStaff.push(inactiveStaff.id);
    const inactiveLogin = await signInAndLoadTables(url, anonKey, primary.slug, inactiveUsername, password);
    assert(!inactiveLogin.ok && inactiveLogin.stage === "identity", "inactive waiter was not rejected");

    for (const role of ["cashier", "kitchen", "owner"]) {
      const user = await createAuthUser(admin, `${role}-${suffix}@serveflow.test`, password, role, null);
      createdUsers.push(user.id);
      const staff = await insertStaff(admin, primary.id, user, role, null, true);
      createdStaff.push(staff.id);
      const login = await signInAndLoadTables(url, anonKey, primary.slug, user.email, password);
      assert(!login.ok && login.stage === "identity", `${role} could login as waiter`);
    }

    const otherUser = await createAuthUser(admin, waiterEmail(other.id, otherUsername), password, "waiter", otherUsername);
    createdUsers.push(otherUser.id);
    const otherStaff = await insertStaff(admin, other.id, otherUser, "waiter", otherUsername, true);
    createdStaff.push(otherStaff.id);
    const crossRestaurantLogin = await signInAndLoadTables(url, anonKey, primary.slug, otherUsername, password);
    assert(!crossRestaurantLogin.ok && crossRestaurantLogin.stage === "identity", "waiter from another restaurant was not rejected");

    console.log("Waiter Login Production Audit");
    console.log("PASS: waiter auth user exists and matches restaurant_staff.user_id.");
    console.log("PASS: restaurant_staff stores restaurant_id, role=waiter, active=true, and username.");
    console.log("PASS: username is unique inside the restaurant.");
    console.log("PASS: active waiter login succeeds and dashboard tables load.");
    console.log("PASS: inactive waiter is rejected.");
    console.log("PASS: cashier, kitchen, and owner cannot login as waiter.");
    console.log("PASS: waiter from another restaurant is rejected.");
  } finally {
    for (const staffId of createdStaff.reverse()) {
      await admin.from("restaurant_staff").delete().eq("id", staffId);
    }

    for (const userId of createdUsers.reverse()) {
      await admin.auth.admin.deleteUser(userId);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
