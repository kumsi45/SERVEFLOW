import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const managerPages = [
  "ManagerDashboardPage.tsx",
  "ManagerOperationsCenterPage.tsx",
  "ManagerKitchenSupervisionPage.tsx",
  "ManagerStaffOperationsPage.tsx",
  "ManagerCustomerExperiencePage.tsx",
  "ManagerOperationalReportsPage.tsx",
  "ManagerRestaurantIntelligencePage.tsx",
  "ManagerRecipeWorkspacePage.tsx",
  "ManagerMenuWorkspacePage.tsx",
  "ManagerInventoryWorkspacePage.tsx",
].map((name) => read(`src/modules/manager/pages/${name}`));

describe("Manager global UI cleanup", () => {
  it("keeps every current Manager destination routed through the existing shell", () => {
    const route = read(
      "src/modules/staff-auth/pages/ProtectedManagerRoute.tsx",
    );
    for (const section of [
      "tables",
      "kitchen",
      "staff",
      "customers",
      "reports",
      "intelligence",
      "recipes",
      "menu",
      "inventory",
    ]) {
      expect(route).toContain(`section === "${section}"`);
    }
    expect(route).toContain("<ManagerDashboardPage");
    expect(route).toContain("<ManagerLayout");
  });

  it("removes repeated tenant and generic page-description copy", () => {
    const staff = managerPages[3];
    const reports = managerPages[5];
    const recipes = managerPages[7];
    const inventory = managerPages[9];

    expect(staff).not.toContain("<p>{restaurantName}</p>");
    expect(staff).not.toContain("Live workforce status");
    expect(reports).not.toContain("prepared for {managerName}");
    expect(reports).not.toContain("Historical operational truth");
    expect(recipes).not.toContain("Manage recipe standards");
    expect(inventory).not.toContain("Monitor stock health");
  });

  it("keeps technical failures out of rendered Manager messages", () => {
    const presentation = read(
      "src/modules/manager/managerPresentation.ts",
    );
    expect(presentation).toContain("TECHNICAL_ERROR_TERMS");
    expect(presentation).toContain("managerFacingMessage");

    for (const page of managerPages) {
      expect(page).not.toMatch(/>[^<{]*(?:PostgREST|schema cache|tenant-scoped|canonical normalized|published contract)[^<{]*</i);
    }
  });

  it("preserves operational facts, actions, and recipe terminology", () => {
    const kitchen = managerPages[2];
    const staff = managerPages[3];
    const recipes = managerPages[7];
    const inventory = managerPages[9];

    expect(kitchen).toContain("Current Orders");
    expect(kitchen).toContain("Station Performance");
    expect(staff).toContain("+ Add Staff");
    expect(recipes).toContain("Ingredients");
    expect(recipes).toContain("+ Add Ingredient");
    expect(inventory).toContain("Current stock");
    expect(inventory).toContain("Requested by");
    expect(inventory).toContain("Open Full Inventory");
  });
});
