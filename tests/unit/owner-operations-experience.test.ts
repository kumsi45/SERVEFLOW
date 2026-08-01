import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const owner = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const ownerStyles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");
const inventoryStyles = readFileSync("src/modules/inventory/styles/inventoryDashboard.css", "utf8");

describe("Phase 10B operations experience", () => {
  it("applies the shared operations surface to every owner module", () => {
    for (const name of ["orders", "menu", "kitchen", "customers", "staff", "qr"]) {
      expect(owner).toContain(`od-${name}-experience`);
    }
  });

  it("retains operational search, filters, assignments, and availability", () => {
    expect(owner).toContain('aria-label="Search menu items"');
    expect(owner).toContain('aria-label="Filter menu by category"');
    expect(owner).toContain('aria-label="Filter menu by availability"');
    expect(owner).toContain('aria-label="Filter menu by kitchen station"');
    expect(owner).toContain("Smart Item Library");
  });

  it("provides responsive order, menu, kitchen, staff, customer, and QR presentation", () => {
    expect(ownerStyles).toContain(".od-orders-experience .od-kanban");
    expect(ownerStyles).toContain(".od-menu-experience .od-table tbody");
    expect(ownerStyles).toContain(".od-kitchen-experience .od-station-grid");
    expect(ownerStyles).toContain(".od-staff-experience .od-staff-layout");
    expect(ownerStyles).toContain(".od-customers-experience");
    expect(ownerStyles).toContain(".od-qr-experience");
  });

  it("aligns inventory presentation without changing its services", () => {
    expect(inventoryStyles).toContain("Phase 10B premium inventory operations surface");
    expect(inventoryStyles).toContain("--ia-green:#176b47");
  });

  it("keeps performance reporting only in Reports and hides internal identifiers", () => {
    expect(owner).not.toContain("<IndependentModuleReport");
    expect(owner).toContain('return "Item Price"');
    expect(owner).toContain('return "Name"');
    expect(owner).toContain('"menu_item_id", "kitchen_station_id", "station_id", "staff_id"');
    expect(owner).toContain('title === "Kitchen Performance" && header === "average_prep_time"');
    expect(owner).toContain('title === "Table Performance" && header === "average_stay"');
    expect(owner).toContain('"customers_served"');
  });
});
