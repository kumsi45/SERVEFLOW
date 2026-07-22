const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const migration = read("supabase/migrations/157_phase_w27_restaurant_staff_identity.sql");
const edge = read("supabase/functions/manage-staff/index.ts");
const ownerService = read("src/modules/owner/services/staffManagementService.ts");
const managerPage = read("src/modules/manager/pages/ManagerStaffOperationsPage.tsx");
const waiterService = read("src/modules/waiter-auth/services/waiterAuthService.ts");

assert(migration.includes("employee_id text"), "Employee ID column is missing.");
assert(migration.includes("restaurant_staff_employee_id_unique"), "Restaurant employee ID uniqueness is missing.");
assert(migration.includes("next_restaurant_employee_id"), "Atomic employee ID generator is missing.");
assert(migration.includes("role::text = 'owner' or employee_id is not null"), "Operational employee IDs are not enforced.");
assert(migration.includes("get_restaurant_terminal_staff"), "Terminal-safe staff roster is missing.");
assert(migration.includes("resolve_restaurant_staff_identity"), "Employee identity resolver is missing.");
assert(edge.includes('!["waiter", "cashier", "kitchen"].includes(role)'), "Manager role boundary is missing.");
assert(edge.includes("Only owners can create manager accounts"), "Owner-to-manager authority boundary is missing.");
assert(edge.includes("employeeAuthEmail"), "Internal Supabase identity generation is missing.");
assert(edge.includes("PIN must be exactly 4 digits"), "Four-digit staff PIN validation is missing.");
assert(ownerService.includes('.neq("role", "owner")'), "Owner staff source must expose every non-owner staff member.");
assert(ownerService.includes('Exclude<ManagedStaffRole, "owner">'), "Owner must be able to create every non-owner staff role.");
assert(!managerPage.includes('placeholder="Username"'), "Manager creation UI still requests a username.");
assert(managerPage.includes('form.role === "waiter" ? "4-digit PIN" : "Temporary password"'), "Role-specific waiter PIN and staff password fields are missing.");
assert(waiterService.includes("resolve_restaurant_staff_identity"), "Waiter login is not using employee identity.");

console.log("PASS Phase W2.7 staff identity architecture audit");
