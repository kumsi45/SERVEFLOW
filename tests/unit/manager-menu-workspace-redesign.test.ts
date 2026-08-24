import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerMenuWorkspacePage.tsx");
const service = read("src/modules/manager/services/managerMenuService.ts");
const styles = read("src/modules/manager/styles/managerMenuWorkspace.css");
const route = read("src/modules/staff-auth/pages/ProtectedManagerRoute.tsx");

describe("Manager Menu operational workspace", () => {
  it("replaces the recipe and appearance wall with the focused menu workspace", () => {
    for (const label of ["Overview", "Menu Items", "Categories", "Customer Menu Preview"]) expect(page).toContain(`label: "${label}"`);
    expect(route).toContain("ManagerMenuWorkspacePage");
    expect(route).not.toContain("manager-menu-studio-stack");
    expect(route).not.toContain("MenuRecipeLinkingPage");
  });

  it("shows compact operational states without inventing sold-out semantics", () => {
    for (const label of ["Available", "Sold out", "Hidden", "Recipe missing"]) expect(page).toContain(label);
    expect(page).toContain("Not tracked separately");
    expect(page).toContain('item.available ? "Available" : "Hidden"');
    expect(page).not.toContain("setSoldOut");
  });

  it("keeps every menu read and write tenant-scoped", () => {
    expect(service.match(/\.eq\("restaurant_id", restaurantId\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(service).not.toContain("service_role");
    expect(page).toContain("useTenantRealtime");
    expect(page).toContain('"menu_items", "categories", "kitchen_stations", "recipes"');
  });

  it("uses existing manager item authority for contextual edits and availability", () => {
    expect(page).toContain("setManagerMenuItemAvailability");
    expect(page).toContain("updateManagerMenuItem");
    expect(page).toContain('role="dialog"');
    expect(page).toContain("Open Recipes");
    expect(page).not.toContain("Create menu item");
  });

  it("keeps appearance secondary and provides a truthful customer preview", () => {
    expect(page).toContain("mmw-appearance-button");
    expect(page).toContain("ThemeCustomizationStudio");
    expect(page).toContain("Only currently available items appear");
    expect(page).toContain('target="_blank"');
  });

  it("reflows rows, previews, filters, and inspectors for mobile", () => {
    expect(styles).toContain("@media(max-width:1100px)");
    expect(styles).toContain("@media(max-width:767px)");
    expect(styles).toContain("@media(max-width:359px)");
    expect(styles).toContain(".mmw-drawer{width:100%}");
    expect(styles).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
  });

  it("keeps the station visible in the compact overview without row-action overlap", () => {
    expect(page).toContain('itemRows((snapshot?.items ?? []).filter');
    expect(page).toContain('.slice(0, 6), true)');
    expect(page).toContain('{!compact && <span>Actions</span>}');
    expect(styles).toContain(".mmw-list.compact .mmw-row");
    expect(styles).toContain(".mmw-row>span:nth-child(6),.mmw-row-head>span:nth-child(6){display:block}");
  });
});
