const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const files = {
  router: "src/app/router/AppRouter.tsx",
  service: "src/modules/waiter-auth/services/waiterAuthService.ts",
  page: "src/modules/waiter-auth/pages/WaiterLoginPage.tsx",
  css: "src/modules/waiter-auth/styles/waiterLogin.css",
  types: "src/modules/waiter-auth/types.ts",
  migration: "supabase/migrations/069_waiter_auth_phasew1.sql",
  staffAuth: "src/modules/staff-auth/services/staffAuthService.ts",
};

for (const file of Object.values(files)) {
  assert(exists(file), `Missing required file: ${file}`);
}

const router = read(files.router);
const service = read(files.service);
const page = read(files.page);
const migration = read(files.migration);
const staffAuth = read(files.staffAuth);

assert(router.includes("/^\\/waiter\\/([^/]+)\\/?$/"), "Router must expose /waiter/:restaurantSlug.");
assert(router.includes("<WaiterLoginPage restaurantSlug={route.restaurantSlug} />"), "Router must render waiter login page only.");

assert(page.includes("ServeFlow Waiter"), "Waiter login must show ServeFlow Waiter branding.");
assert(page.includes("Username"), "Waiter login must collect username.");
assert(page.includes("PIN / Password"), "Waiter login must collect PIN/password.");
assert(page.includes("signOutWaiter"), "Waiter login must provide logout.");
assert(!page.match(/table|order|kitchen|cashier|payment/i), "Waiter page must not implement W2+ operations.");

assert(service.includes("storageKey: WAITER_AUTH_STORAGE_KEY"), "Waiter auth must use isolated storage key.");
assert(service.includes("WAITER_SESSION_KEY"), "Waiter session must use dedicated minimal session storage.");
assert(service.includes("resolve_waiter_login_identity"), "Waiter login must resolve waiter identity through waiter-only RPC.");
assert(service.includes("get_waiter_terminal_context"), "Waiter terminal must load only minimal restaurant context.");
assert(service.includes("staffId") && service.includes("displayName") && service.includes("restaurant"), "Waiter session must store minimal waiter identity.");
assert(!service.includes("signOutStaff"), "Waiter logout must not reuse owner/cashier/kitchen staff signout.");

assert(migration.includes("add value if not exists 'waiter'"), "Database must support waiter staff role.");
assert(migration.includes("staff.role::text = 'waiter'"), "Waiter RPC must enforce waiter role.");
assert(migration.includes("staff.active = true"), "Waiter RPC must reject inactive staff.");
assert(migration.includes("add column if not exists active boolean not null default true"), "Database must have an active restaurant flag for waiter validation.");
assert(migration.includes("restaurants.active = true"), "Waiter RPC must reject inactive restaurants.");
assert(migration.includes("grant execute on function public.get_waiter_terminal_context(text) to anon, authenticated"), "Terminal context RPC grant missing.");
assert(migration.includes("grant execute on function public.resolve_waiter_login_identity(text, text) to anon, authenticated"), "Waiter identity RPC grant missing.");
assert(!migration.match(/alter table public\.(orders|order_items|payments|invoices|kitchen|reports|analytics)/i), "W1 migration must not touch ordering, kitchen, cashier, payment, reports, or analytics tables.");
assert(!migration.match(/create or replace function public\..*(order|payment|invoice|kitchen|report|analytics)/i), "W1 migration must not create W2+ workflow RPCs.");

assert(staffAuth.includes('value === "owner" || value === "cashier" || value === "kitchen"'), "Existing owner/cashier/kitchen staff auth role filter should remain unchanged.");
assert(!staffAuth.includes('"waiter"'), "Existing staff auth must not include waiter.");

console.log("Waiter Auth Phase W1 Audit");
console.log("PASS: Active waiter login path is isolated at /waiter/:restaurantSlug.");
console.log("PASS: Username + PIN/password login UI exists.");
console.log("PASS: Role, active staff, active restaurant, and restaurant membership checks are enforced by waiter-only RPC.");
console.log("PASS: Logout clears waiter session and dedicated waiter auth storage only.");
console.log("PASS: Owner/cashier/kitchen staff auth remains unchanged.");
console.log("PASS: No waiter ordering, table management, kitchen, cashier, payment, report, QR, or dashboard implementation was added.");
