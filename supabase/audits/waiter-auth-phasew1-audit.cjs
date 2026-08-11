const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const router = read("src/app/router/AppRouter.tsx");
const service = read("src/modules/waiter-auth/services/waiterAuthService.ts");
const page = read("src/modules/waiter-auth/pages/WaiterLoginPage.tsx");
const endpoint = read("supabase/functions/waiter-pin-login/index.ts");
const shared = read("supabase/functions/_shared/waiterPin.ts");
const migration = read("supabase/migrations/228_phasea1_waiter_pin_authentication.sql");
const manageStaff = read("supabase/functions/manage-staff/index.ts");

assert(router.includes("/^\\/waiter\\/([^/]+)\\/?$/"), "Router must expose /waiter/:restaurantSlug.");
assert(page.includes("Waiter Login") && page.includes("Enter PIN"), "Waiter entry must use the focused PIN flow.");
assert(!page.includes("loadWaiterTerminalProfiles") && !page.includes("WaiterGrid"), "Waiter entry must not fetch or render the directory.");
assert(!page.includes("window.location.replace"), "Waiter entry must use warm-shell navigation.");

assert(service.includes("/functions/v1/waiter-pin-login"), "PIN-only server authentication endpoint is missing.");
assert(service.includes("waiterSupabase.auth.setSession"), "PIN login must establish a normal Supabase session.");
assert(service.includes("clearWaiterSensitiveClientState"), "Waiter logout must clear sensitive local state synchronously.");

assert(migration.includes("waiter_pin_credentials_active_pin_unique"), "Active tenant PIN uniqueness is missing.");
assert(migration.includes("enable row level security"), "PIN credential tables must enable RLS.");
assert(migration.includes("revoke all on table public.waiter_pin_credentials from public, anon, authenticated"), "PIN credentials must be server-only.");
assert(!migration.match(/\bpin\s+text\b/i), "Plaintext PIN storage is forbidden.");

assert(endpoint.includes("requireWaiterPinPepper"), "Server-only PIN pepper is required.");
assert(endpoint.includes("waiterThrottleFingerprint"), "Tenant/source throttling is required.");
assert(shared.includes("waiter-throttle:v1:${restaurantId}:${clientAddress}"), "Throttling must not trust a rotatable browser terminal ID.");
assert(endpoint.includes("waiterSupabasePassword(pepper, restaurant.id, staff.employee_id)"), "A server-only high-entropy waiter Auth password must be derived.");
assert(endpoint.includes("signInWithPassword({ email: staff.email, password: authPassword })"), "Supabase Auth must remain the session authority.");
assert(endpoint.includes('staff.role !== "waiter"') && endpoint.includes("staff.restaurant_id !== restaurant.id"), "Waiter role and tenant membership checks are required.");
assert(endpoint.includes('rpc("record_waiter_login"'), "Successful login must use the authoritative waiter login record RPC.");

assert(manageStaff.includes("saveWaiterPinCredential"), "Waiter create/reset must enroll PIN credentials.");
assert(manageStaff.includes("generateAvailableWaiterPin"), "PIN reset must avoid active tenant conflicts.");

console.log("Waiter Auth Phase A1 Audit");
console.log("PASS: PIN-only waiter entry does not fetch or render a waiter directory.");
console.log("PASS: PIN fingerprints are tenant-scoped, keyed, unique for active credentials, and server-only.");
console.log("PASS: Login is rate-limited and establishes a normal Supabase Auth session.");
console.log("PASS: Waiter creation/reset enrolls credentials and logout clears local state first.");
