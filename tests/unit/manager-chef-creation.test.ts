import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canCreateStaffRole } from "../../supabase/functions/manage-staff/authorization";
import {
  initialKitchenStationId,
  staffCreationEmailRequired,
} from "../../supabase/functions/manage-staff/creationPolicy";
import {
  managerStaffEmailRequired,
  validateManagerStaffCreation,
} from "../../src/modules/manager/services/managerStaffCreationValidation";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerStaffOperationsPage.tsx");
const service = read("src/modules/manager/services/managerStaffOperationsService.ts");
const manageStaff = read("supabase/functions/manage-staff/index.ts");
const kitchenAuth = read("src/modules/staff-auth/services/staffAuthService.ts");
const kitchenPage = read("src/modules/kitchen/pages/KitchenDashboardPage.tsx");
const migration = read("supabase/migrations/241_manager_chef_creation_without_station.sql");
const queueFunction = migration.slice(
  migration.indexOf("create or replace function public.get_station_kitchen_orders"),
  migration.indexOf("create or replace function public.resolve_kitchen_action_context"),
);
const actionContextFunction = migration.slice(
  migration.indexOf("create or replace function public.resolve_kitchen_action_context"),
  migration.indexOf("comment on function public.get_kitchen_dashboard_context"),
);

const valid = (role: "waiter" | "cashier" | "kitchen" | "inventory_officer", email = "staff@example.com") => ({
  fullName: "Test Staff",
  email,
  pin: "1234",
  role,
});

describe("Manager Chef creation without station assignment", () => {
  it("allows a manager to create the canonical kitchen role without a station", () => {
    expect(canCreateStaffRole("manager", "kitchen")).toBe(true);
    expect(initialKitchenStationId("manager", "kitchen", undefined)).toBeNull();
    expect(initialKitchenStationId("manager", "kitchen", "00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(service).not.toContain("assignedKitchenStationId?:");
  });

  it("stores Chef as kitchen with a null initial station", () => {
    expect(page).toContain('role: "kitchen", label: "Chef", available: true');
    expect(manageStaff).toContain("role,");
    expect(manageStaff).toContain("assigned_kitchen_station_id: assignedKitchenStationId");
    expect(manageStaff).toContain("initialKitchenStationId(");
  });

  it("shows the created role as Chef in Directory", () => {
    expect(page).toContain('if (role === "kitchen") return "Chef"');
    expect(page).toContain('<option value="kitchen">Chef</option>');
  });

  it("shows an honest unassigned current-work state", () => {
    expect(page).toContain('member.assignedKitchenStationName ?? "Unassigned"');
  });

  it("keeps an unassigned Chef authorized for Kitchen without silently assigning a station", () => {
    expect(kitchenAuth).toContain('if (restaurant.role === "kitchen")');
    expect(migration).toContain("and role in ('kitchen', 'owner')");
    expect(migration).not.toContain("set assigned_kitchen_station_id");
    expect(kitchenPage).toContain('context.role === "kitchen" && !context.assignedStation');
  });

  it("removes the database trigger that forced null Chef assignments to Main Kitchen", () => {
    expect(migration).toContain("drop trigger if exists assign_default_kitchen_station_to_staff on public.restaurant_staff");
    expect(migration).not.toContain("new.assigned_kitchen_station_id :=");
    expect(migration).not.toContain("create trigger assign_default_kitchen_station_to_staff");
  });

  it("rejects station queue access for an unassigned Chef without exposing all stations", () => {
    expect(queueFunction).toContain("if acting_staff.assigned_kitchen_station_id is null then");
    expect(queueFunction).toContain("raise exception 'Kitchen station assignment required.'");
    expect(queueFunction).not.toContain("set assigned_kitchen_station_id");
    expect(queueFunction).not.toContain("ensure_main_kitchen_station_for_restaurant");
  });

  it("rejects station-dependent mutations for an unassigned Chef without persisting a fallback", () => {
    expect(actionContextFunction).toContain("station_id := staff.assigned_kitchen_station_id");
    expect(actionContextFunction).toContain("raise exception 'Kitchen station assignment required.'");
    expect(actionContextFunction).not.toContain("set assigned_kitchen_station_id");
    expect(actionContextFunction).not.toContain("ensure_main_kitchen_station_for_restaurant");
  });

  it("preserves explicit tenant-scoped Manager Kitchen assignment", () => {
    expect(page).not.toContain("assignedKitchenStationId");
    expect(service).toContain("assignedKitchenStationId: string | null");
    expect(manageStaff).toContain("nextStation = await requireActiveKitchenStation(nextStationId)");
    expect(manageStaff).toContain('.eq("restaurant_id", restaurantId)');
  });

  it("keeps waiter email optional", () => {
    expect(managerStaffEmailRequired("waiter")).toBe(false);
    expect(staffCreationEmailRequired("waiter")).toBe(false);
    expect(validateManagerStaffCreation(valid("waiter", ""))).toBeNull();
  });

  it.each(["cashier", "kitchen", "inventory_officer"] as const)("requires email for %s", (role) => {
    expect(managerStaffEmailRequired(role)).toBe(true);
    expect(staffCreationEmailRequired(role)).toBe(true);
    expect(validateManagerStaffCreation(valid(role, ""))).toMatch(/email is required/i);
  });

  it("rejects an invalid email for every role, including optional waiter email", () => {
    for (const role of ["waiter", "cashier", "kitchen", "inventory_officer"] as const) {
      expect(validateManagerStaffCreation(valid(role, "invalid-email"))).toBe("Enter a valid email address.");
    }
    expect(manageStaff).toContain("normalizeEmail(payload.email)");
  });

  it("requires exactly four PIN digits for Manager Staff creation", () => {
    expect(validateManagerStaffCreation({ ...valid("kitchen"), pin: "12ab" })).toBe("PIN must be exactly 4 digits.");
    expect(validateManagerStaffCreation({ ...valid("kitchen"), pin: "12345" })).toBe("PIN must be exactly 4 digits.");
    expect(page).toContain('<span>4-digit PIN *</span>');
    expect(manageStaff).toContain('role === "waiter" || actingStaff.role === "manager"');
  });

  it("denies cross-tenant creation through server-derived membership", () => {
    expect(manageStaff).toContain('.eq("restaurant_id", restaurantId)');
    expect(manageStaff).toContain('.eq("user_id", userData.user.id)');
    expect(manageStaff).toContain("actingStaff.restaurant_id !== restaurantId");
  });

  it("denies unauthorized actors and Manager role escalation", () => {
    expect(manageStaff).toContain('.in("role", ["owner", "manager"])');
    expect(manageStaff).toContain("canCreateStaffRole");
    for (const role of ["manager", "reception", "inventory"] as const) {
      expect(canCreateStaffRole("manager", role)).toBe(false);
    }
  });

  it.each(["waiter", "cashier", "inventory_officer"] as const)("preserves existing Manager %s creation", (role) => {
    expect(canCreateStaffRole("manager", role)).toBe(true);
    expect(validateManagerStaffCreation(valid(role, role === "waiter" ? "" : `${role}@example.com`))).toBeNull();
  });

  it("does not create or request a fake/default station for Manager Chef creation", () => {
    expect(initialKitchenStationId("manager", "kitchen", "main-kitchen")).toBeNull();
    expect(page).not.toContain("assignedKitchenStationId");
    expect(page).not.toContain("Main Kitchen");
  });

  it("preserves Owner station-aware creation without changing Owner UI", () => {
    const stationId = "00000000-0000-4000-8000-000000000001";
    expect(initialKitchenStationId("owner", "kitchen", stationId)).toBe(stationId);
  });

  it("uses role-specific labels and primary actions in the simple Staff form", () => {
    expect(page).toContain('managerStaffEmailRequired(form.role) ? "Email *" : "Email (optional)"');
    expect(page).toContain('`Create ${roleLabel(form.role)}`');
    expect(page).not.toContain("mso-inline-limitation");
  });
});
