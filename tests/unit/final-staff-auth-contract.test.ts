import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  staffAuthEmailRequired,
  staffAuthRoleLabel,
  usesWaiterPin,
  validateStaffPasswordConfirmation,
  validateWaiterPin,
} from "../../supabase/functions/_shared/staffAuthPolicy";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const manageStaff = read("supabase/functions/manage-staff/index.ts");
const ownerSignup = read("supabase/functions/owner-signup/index.ts");
const ownerSignupPage = read("src/modules/owner-signup/pages/OwnerSignupPage.tsx");
const ownerPage = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const managerPage = read("src/modules/manager/pages/ManagerStaffOperationsPage.tsx");
const forgotPage = read("src/modules/staff-auth/pages/ForgotPasswordPage.tsx");
const resetPage = read("src/modules/staff-auth/pages/ResetPasswordPage.tsx");
const waiterLogin = read("supabase/functions/waiter-pin-login/index.ts");
const terminalMigration = read("supabase/migrations/244_isolate_legacy_privileged_terminal_login.sql");

describe("final V1 staff authentication contract", () => {
  it.each(["owner", "manager", "cashier", "kitchen", "inventory_officer"] as const)("uses email and password for %s", (role) => {
    expect(staffAuthEmailRequired(role)).toBe(true);
    expect(usesWaiterPin(role)).toBe(false);
    expect(validateStaffPasswordConfirmation("StrongPass1", "StrongPass1")).toBeNull();
  });

  it("keeps Waiter on optional email and exactly four PIN digits", () => {
    expect(staffAuthEmailRequired("waiter")).toBe(false);
    expect(usesWaiterPin("waiter")).toBe(true);
    expect(validateWaiterPin("1234")).toBeNull();
    expect(validateWaiterPin("12345")).toBe("Enter a 4-digit PIN.");
  });

  it("uses the same strong confirmed-password validation in creation forms", () => {
    expect(validateStaffPasswordConfirmation("1234", "1234")).toBe("Create a stronger password.");
    expect(validateStaffPasswordConfirmation("StrongPass1", "StrongPass2")).toBe("Passwords do not match.");
    expect(ownerPage).toContain("validateStaffPasswordConfirmation(formPin, formConfirmPassword)");
    expect(managerPage).toContain("validateManagerStaffCreation");
    expect(ownerSignupPage).toContain("validateStaffPasswordConfirmation(password, confirmPassword)");
  });

  it("requires Owner confirmation and sends only the password to trusted signup", () => {
    expect(ownerSignupPage).toContain('label="Confirm password"');
    expect(ownerSignupPage).toContain("body: { ownerName: trimmedOwnerName, email: trimmedEmail, password,");
    expect(ownerSignup).toContain("serviceClient.auth.admin.createUser");
    expect(ownerSignup).not.toMatch(/pinPassword|\bpin\b/);
  });

  it("enforces role-specific credentials on the trusted staff endpoint", () => {
    expect(manageStaff).toContain('? normalizePinPassword(payload.pin)');
    expect(manageStaff).toContain(': normalizeStaffPassword(payload.password)');
    expect(manageStaff).not.toContain("pinPassword");
    expect(manageStaff).toContain('role === "waiter" ? "waiter_pin_ready" : "password_ready"');
  });

  it("does not persist or audit raw credentials", () => {
    expect(manageStaff).not.toMatch(/restaurant_staff[\s\S]{0,600}(password|pin):\s*(creationCredential|payload\.)/);
    expect(manageStaff).not.toMatch(/new_values:\s*\{\s*(password|pin):/);
    expect(manageStaff).toContain("Passwords and credential material are never logged");
  });

  it("keeps Chef canonical and unassigned at creation", () => {
    expect(staffAuthRoleLabel("kitchen")).toBe("Chef");
    expect(ownerPage).toContain('<option value="kitchen">Chef</option>');
    expect(ownerPage).toContain('modal.mode === "edit" && formRole === "kitchen"');
    expect(manageStaff).toContain("initialKitchenStationId(");
  });

  it("uses Supabase email recovery for privileged self-service reset", () => {
    expect(forgotPage).toContain("supabase.auth.resetPasswordForEmail");
    expect(resetPage).toContain('"complete-staff-password-setup"');
    expect(resetPage).toContain("confirmPassword");
  });

  it("keeps waiter PIN reset trusted, tenant-scoped, and waiter-only", () => {
    expect(manageStaff).toContain('action === "set-waiter-pin"');
    expect(manageStaff).toContain('targetStaff.role !== "waiter" || targetStaff.active !== true');
    expect(waiterLogin).toContain('staff.role !== "waiter"');
    expect(waiterLogin).toContain("staff.restaurant_id !== restaurant.id");
  });

  it("excludes new password-ready privileged users from the legacy terminal", () => {
    expect(terminalMigration).toContain("readiness.readiness in ('legacy_credential', 'reset_required')");
    expect(terminalMigration).not.toMatch(/readiness\.readiness\s+in\s*\([^)]*password_ready/);
    expect(terminalMigration).toContain("s.role::text = 'waiter'");
  });

  it("preserves server-derived tenant and role authority", () => {
    expect(manageStaff).toContain('.eq("user_id", userData.user.id)');
    expect(manageStaff).toContain("actingStaff.restaurant_id !== restaurantId");
    expect(manageStaff).toContain('.in("role", ["owner", "manager"])');
    expect(manageStaff).toContain("canCreateStaffRole");
  });
});
