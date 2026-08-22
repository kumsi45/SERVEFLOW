import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const live = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
const kitchen = read("src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx");
const kitchenService = read("src/modules/manager/services/managerKitchenSupervisionService.ts");
const staff = read("src/modules/manager/pages/ManagerStaffOperationsPage.tsx");
const manageStaff = read("supabase/functions/manage-staff/index.ts");

describe("Manager operational assignment ownership", () => {
  it("owns waiter assignment in Live Operations with workload context", () => {
    expect(live).toContain("assignWaiterTables");
    expect(live).toContain("Unassigned Locations");
    expect(live).toContain("Assign Waiter");
    expect(live).toContain("waiter.assignedTables.length");
    expect(live).toContain("waiter.activeOrders");
    expect(live).toContain('member.role === "waiter" && member.active');
  });

  it("confirms active-session waiter reassignment without lifecycle mutations", () => {
    expect(live).toContain("Active session and orders will remain unchanged.");
    expect(live).not.toContain("dining_session_status:");
    expect(live).not.toContain("kitchen_status:");
    expect(live).not.toContain("payment_status:");
  });

  it("owns chef assignment in Kitchen and preserves ticket ownership", () => {
    expect(kitchen).toContain("updateManagerStaff");
    expect(kitchen).toContain("Manage Chefs");
    expect(kitchen).toContain("Station coverage");
    expect(kitchen).toContain("Existing kitchen tickets and order state will remain unchanged.");
    expect(kitchenService).toContain('.eq("role", "kitchen")');
  });

  it("warns only for an unstaffed station with active workload", () => {
    expect(kitchen).toContain("station.queueLength > 0 && station.activeStaff === 0");
    expect(kitchenService).toContain("station.queueLength > 0 && station.activeStaff === 0");
    expect(kitchenService).toContain('if (queueLength === 0) return "idle"');
  });

  it("keeps Staff assignment summaries read-only", () => {
    expect(staff).toContain("currentWork(member)");
    expect(staff).not.toContain("assignWaiterTables");
    expect(staff).not.toContain("assignedKitchenStationId:");
  });

  it("reuses tenant and role validated server authority", () => {
    expect(manageStaff).toContain('if (action === "assign-waiter-tables")');
    expect(manageStaff).toContain('if (targetStaff.role !== "waiter")');
    expect(manageStaff).toContain('.eq("restaurant_id", restaurantId)');
    expect(manageStaff).toContain("data.restaurant_id !== actingStaff.restaurant_id");
    expect(manageStaff).toContain("requireActiveKitchenStation(nextStationId)");
  });
});
