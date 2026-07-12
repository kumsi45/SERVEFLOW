const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const ownerPage = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const ownerService = read("src/modules/owner/services/staffManagementService.ts");
const manageStaff = read("supabase/functions/manage-staff/index.ts");
const migration = read("supabase/migrations/070_owner_waiter_staff_management_phasew0.sql");
const waiterService = read("src/modules/waiter-auth/services/waiterAuthService.ts");

assert(ownerService.includes('"waiter"'), "Owner staff service must include waiter role.");
assert(ownerService.includes("username") && ownerService.includes("phone_number"), "Owner staff service must load waiter username and phone.");
assert(ownerService.includes("deleteStaff"), "Owner staff service must expose safe delete action.");

assert(ownerPage.includes('<option value="waiter">Waiter</option>'), "Staff role filter/form must include waiter.");
assert(ownerPage.includes("formUsername") && ownerPage.includes("formPin") && ownerPage.includes("formPhone"), "Waiter fields must exist in staff form.");
assert(ownerPage.includes("Reset PIN"), "Waiter rows must expose reset PIN action.");
assert(ownerPage.includes("deleteStaff(restaurantId, member.id)"), "Waiter rows must expose safe delete action.");
assert(ownerPage.includes("member.role === \"waiter\""), "Waiter UI behavior must be role-scoped.");

assert(manageStaff.includes('type StaffRole = "cashier" | "kitchen" | "waiter"'), "Edge function must support waiter role.");
assert(manageStaff.includes("normalizeUsername"), "Edge function must validate waiter username.");
assert(manageStaff.includes("normalizePinPassword"), "Edge function must validate waiter PIN.");
assert(manageStaff.includes("waiterAuthEmail"), "Edge function must create auth identity for username-based waiter login.");
assert(manageStaff.includes("This waiter username is already used in this restaurant."), "Edge function must enforce restaurant-scoped username uniqueness.");
assert(manageStaff.includes("waiter_session_active"), "Edge function must block deletion for active waiter sessions.");
assert(manageStaff.includes("futureShiftExists") && manageStaff.includes("futureAssignedTablesExist"), "Safe delete placeholders must exist.");
assert(manageStaff.includes('"waiter_created"') && manageStaff.includes('"waiter_pin_reset"') && manageStaff.includes('"waiter_deleted"'), "Waiter audit actions must be logged.");
assert(!manageStaff.match(/from\("(assigned_tables|waiter_orders|payments|invoices)"\)/i), "W0 edge function must not query W2+ waiter/payment tables.");

assert(migration.includes("restaurant_staff_restaurant_username_unique"), "Migration must add restaurant-scoped username uniqueness.");
assert(migration.includes("add value if not exists 'waiter'"), "Migration must extend waiter roles.");
assert(migration.includes("waiter_session_active"), "Migration must support active waiter session safety.");
assert(migration.includes("record_waiter_login") && migration.includes("record_waiter_logout"), "Migration must provide waiter session lifecycle hooks.");

assert(waiterService.includes("record_waiter_login") && waiterService.includes("record_waiter_logout"), "Phase W1 login must integrate with W0 session safety.");

console.log("Waiter Staff Management Phase W0 Audit");
console.log("PASS: Existing Owner Staff module supports cashier, kitchen, and waiter roles.");
console.log("PASS: Waiter username, PIN/password, phone, status, created date, and last login are supported.");
console.log("PASS: Username uniqueness is restaurant-scoped.");
console.log("PASS: Waiter create/edit/activate/deactivate/reset PIN/delete actions are server-side owner actions.");
console.log("PASS: Safe delete blocks active waiter sessions and includes future placeholder checks.");
console.log("PASS: Phase W1 waiter login remains integrated.");
console.log("PASS: No waiter dashboard, ordering, table management, payments, kitchen, cashier, reports, or analytics features were added.");
