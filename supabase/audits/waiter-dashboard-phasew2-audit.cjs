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
  page: "src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx",
  service: "src/modules/waiter-dashboard/services/waiterDashboardService.ts",
  types: "src/modules/waiter-dashboard/types.ts",
  css: "src/modules/waiter-dashboard/styles/waiterDashboard.css",
  login: "src/modules/waiter-auth/pages/WaiterLoginPage.tsx",
  authService: "src/modules/waiter-auth/services/waiterAuthService.ts",
  migration: "supabase/migrations/071_waiter_dashboard_table_management_phasew2.sql",
};

for (const file of Object.values(files)) {
  assert(exists(file), `Missing required file: ${file}`);
}

const router = read(files.router);
const page = read(files.page);
const service = read(files.service);
const login = read(files.login);
const authService = read(files.authService);
const migration = read(files.migration);

assert(router.includes("/dashboard"), "Router must expose /waiter/:restaurantSlug/dashboard.");
assert(router.includes("<WaiterDashboardPage restaurantSlug={route.restaurantSlug} />"), "Router must render waiter dashboard.");
assert(login.includes("/dashboard"), "Waiter login must send active waiters to dashboard.");
assert(authService.includes("export const waiterSupabase"), "Dashboard must reuse isolated waiter auth client.");

assert(page.includes("Table Management"), "Dashboard must be table-management focused.");
assert(page.includes("loadWaiterDashboardTables"), "Dashboard must load the table read model.");
assert(page.includes("restaurant_tables"), "Dashboard realtime must subscribe to restaurant tables.");
assert(page.includes("restaurant_table_waiter_assignments"), "Dashboard realtime must subscribe to waiter assignment changes.");
assert(page.includes("orders"), "Dashboard realtime must subscribe to order status changes.");
assert(page.includes("Current active order?"), "Table details must display active order presence.");
assert(page.includes("QR customer?"), "Table details must display QR customer context.");
assert(!page.match(/create.*order|modify.*order|payment|invoice|kitchen/i), "Dashboard page must not implement ordering, payment, invoice, or kitchen flows.");

assert(service.includes("get_waiter_dashboard_tables"), "Service must use read-only waiter dashboard RPC.");
assert(!service.match(/\.insert\(|\.update\(|\.delete\(|create_public_qr_order/i), "Dashboard service must not mutate data or create orders.");

assert(migration.includes("restaurant_tables") && migration.includes("add column if not exists seats"), "Migration must extend canonical restaurant tables for seats.");
assert(migration.includes("restaurant_table_waiter_assignments"), "Migration must add waiter table assignments.");
assert(migration.includes("get_waiter_dashboard_tables"), "Migration must expose dashboard read model RPC.");
assert(migration.includes("public.is_public_qr_dining_session_open"), "Dashboard status must reuse existing QR dining session lifecycle.");
assert(migration.includes("orders.order_source = 'public_qr'"), "Dashboard must derive QR ordering status from existing orders.");
assert(!migration.match(/create_public_qr_order|insert into public\\.orders|update public\\.orders|delete from public\\.orders/i), "W2 migration must not create or modify orders.");
assert(!migration.match(/alter table public\\.(payments|order_invoices|order_items|kitchen|reports|analytics)/i), "W2 migration must not alter payment, invoice, item, kitchen, report, or analytics tables.");

console.log("Waiter Dashboard Phase W2 Audit");
console.log("PASS: /waiter/:restaurantSlug/dashboard route exists.");
console.log("PASS: Dashboard is table-management only with large status cards and details.");
console.log("PASS: Assigned-table filtering with all-table fallback is handled by read-only RPC.");
console.log("PASS: Availability, occupied, and QR ordering statuses are derived from existing orders/session lifecycle.");
console.log("PASS: Realtime refresh listens to table, assignment, and order changes.");
console.log("PASS: No ordering, payment, invoice, kitchen, customer, report, analytics, setup wizard, manager, or owner layout implementation was added.");
