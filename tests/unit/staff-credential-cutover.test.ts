import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/243_staff_credential_readiness.sql");
const manageStaff = read("supabase/functions/manage-staff/index.ts");
const passwordSetup = read("supabase/functions/complete-staff-password-setup/index.ts");
const resetPage = read("src/modules/staff-auth/pages/ResetPasswordPage.tsx");
const staffLogin = read("src/modules/staff-auth/pages/StaffLoginPage.tsx");
const waiterLogin = read("supabase/functions/waiter-pin-login/index.ts");
const ownerPage = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const managerPage = read("src/modules/manager/pages/ManagerStaffOperationsPage.tsx");
const terminalMigration = read("supabase/migrations/244_isolate_legacy_privileged_terminal_login.sql");

describe("production credential migration and auth cutover", () => {
  it("tracks explicit tenant-scoped readiness without storing authentication secrets", () => {
    expect(migration).toContain("create table if not exists public.staff_credential_readiness");
    expect(migration).toContain("foreign key (restaurant_id, staff_id)");
    for (const state of ["legacy_credential", "reset_required", "password_ready", "waiter_pin_ready"]) expect(migration).toContain(state);
    expect(migration).not.toMatch(/password_hash|encrypted_password|\bpin\s+text/i);
    expect(migration).toContain("force row level security");
    expect(migration).toContain("actor.user_id = auth.uid()");
    expect(migration).toContain("actor.restaurant_id = staff_credential_readiness.restaurant_id");
  });

  it("initializes privileged and waiter readiness conservatively", () => {
    expect(migration).toContain("then 'waiter_pin_ready'");
    expect(migration).toContain("then 'reset_required'");
    expect(migration).toContain("else 'legacy_credential'");
    expect(migration).toContain("credential.active = true");
  });

  it("completes password setup through a trusted self-only Auth update", () => {
    expect(passwordSetup).toContain("userClient.auth.getUser()");
    expect(passwordSetup).toContain('.eq("user_id", userData.user.id)');
    expect(passwordSetup).toContain('.eq("active", true)');
    expect(passwordSetup).toContain("service.auth.admin.updateUserById(userData.user.id, { password })");
    expect(passwordSetup).toContain('readiness: "password_ready"');
    expect(passwordSetup).not.toContain("request body");
    expect(passwordSetup).not.toMatch(/console\.(log|info).*password/i);
    expect(resetPage).toContain('"complete-staff-password-setup"');
    expect(resetPage).not.toContain("supabase.auth.updateUser({ password })");
  });

  it("isolates privileged legacy PIN login from password-ready new accounts", () => {
    expect(staffLogin).toContain('loginMode === "terminal"');
    expect(staffLogin).toContain("signInOperationalStaff");
    expect(staffLogin).toContain("Enter your 4-digit PIN");
    expect(terminalMigration).toContain("readiness.readiness in ('legacy_credential', 'reset_required')");
    expect(terminalMigration).toContain("s.role::text = 'waiter'");
  });

  it("repairs waiter PIN enrollment without generating or returning a PIN", () => {
    expect(manageStaff).toContain('| "set-waiter-pin"');
    expect(manageStaff).toContain('if (targetStaff.role !== "waiter" || targetStaff.active !== true)');
    expect(manageStaff).toContain('setCredentialReadiness(serviceClient, restaurantId, staffId, "waiter_pin_ready"');
    expect(manageStaff).not.toContain("function generateWaiterPin");
    expect(manageStaff).not.toContain("generateTemporaryPassword");
    expect(waiterLogin).toContain('staff.role !== "waiter"');
    expect(waiterLogin).toContain("staff.restaurant_id !== restaurant.id");
  });

  it("uses setup links, role-specific creation credentials, and readiness labels", () => {
    for (const page of [ownerPage, managerPage]) {
      expect(page).toContain("Password setup required");
      expect(page).toContain("Password ready");
      expect(page).toContain("Waiter PIN setup required");
      expect(page).toContain("Waiter PIN ready");
      expect(page).toContain("Send password setup link");
      expect(page).toContain("Resend setup link");
      expect(page).toContain("Set/Reset Waiter PIN");
    }
    expect(managerPage).toContain("<span>4-digit PIN *</span>");
    expect(managerPage).toContain("<span>Confirm Password *</span>");
    expect(ownerPage).toContain("Confirm Password *");
  });

  it("preserves server-side tenant and role authority", () => {
    expect(manageStaff).toContain('.eq("restaurant_id", restaurantId)');
    expect(manageStaff).toContain('.eq("user_id", userData.user.id)');
    expect(manageStaff).toContain('.in("role", ["owner", "manager"])');
    expect(manageStaff).toContain("canCreateStaffRole");
    expect(manageStaff).toContain('targetStaff.role === "manager" && actingStaff.role !== "owner"');
    expect(manageStaff).toContain('role === "owner" || role === "super_admin"');
  });
});
