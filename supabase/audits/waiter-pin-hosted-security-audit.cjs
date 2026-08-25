const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const root = path.resolve(__dirname, "../..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1]] = match[2];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && anonKey && serviceKey, "Hosted Supabase credentials are unavailable.");

  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const [anonymousCredentials, anonymousEvents, serviceCredentials, serviceEvents] = await Promise.all([
    anon.from("waiter_pin_credentials").select("id", { count: "exact", head: true }),
    anon.from("waiter_pin_auth_events").select("id", { count: "exact", head: true }),
    service.from("waiter_pin_credentials").select("id", { count: "exact", head: true }),
    service.from("waiter_pin_auth_events").select("id", { count: "exact", head: true }),
  ]);
  assert(anonymousCredentials.error, "Anonymous users can read waiter PIN credentials.");
  assert(anonymousEvents.error, "Anonymous users can read waiter PIN auth events.");
  assert(!serviceCredentials.error && !serviceEvents.error, "Service-only waiter security tables are unavailable.");

  const anonymousReservation = await anon.rpc("reserve_waiter_pin_auth_attempt", {
    target_restaurant_id: "00000000-0000-4000-8000-000000000001",
    target_scope_fingerprint: "0".repeat(64),
    target_window_seconds: 120,
    target_attempt_limit: 5,
  });
  assert(anonymousReservation.error, "Anonymous users can reserve waiter PIN attempts.");
  const serviceReservationProbe = await service.rpc("reserve_waiter_pin_auth_attempt", {
    target_restaurant_id: "00000000-0000-4000-8000-000000000001",
    target_scope_fingerprint: "0".repeat(64),
    target_window_seconds: 0,
    target_attempt_limit: 5,
  });
  assert(serviceReservationProbe.error?.code === "22023", "Service role cannot execute the protected reservation RPC.");

  const endpoint = `${url}/functions/v1/waiter-pin-login`;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
  const [missingContextResponse, unknownTenantResponse] = await Promise.all([
    fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ restaurantSlug: "", pin: "9087", terminalId: "" }) }),
    fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ restaurantSlug: `missing-${Date.now()}`, pin: "9087", terminalId: "hosted-audit" }) }),
  ]);
  const [missingContext, unknownTenant] = await Promise.all([missingContextResponse.json(), unknownTenantResponse.json()]);
  assert(!missingContextResponse.ok && !unknownTenantResponse.ok, "Unauthorized waiter contexts were accepted.");
  assert(missingContext.code === "invalid_pin" && unknownTenant.code === "invalid_pin", "Public failures disclose different PIN state.");
  assert(missingContext.error === "PIN not recognized. Try again." && unknownTenant.error === missingContext.error, "Public failures expose internal authentication details.");
  assert(!JSON.stringify(missingContext).includes("9087") && !JSON.stringify(unknownTenant).includes("9087"), "A waiter PIN was echoed in a response.");

  console.log("Waiter PIN Hosted Security Audit");
  console.log("PASS: credential and attempt tables reject anonymous reads.");
  console.log("PASS: the atomic reservation RPC rejects anonymous execution.");
  console.log("PASS: the service role reaches the protected reservation gate without writing test data.");
  console.log("PASS: unauthorized terminal and tenant contexts receive the same generic PIN error.");
  console.log("PASS: hosted responses do not echo PIN material or internal errors.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
