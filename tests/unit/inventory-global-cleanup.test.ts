import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const overview = read("src/modules/inventory/components/InventoryOverviewDashboard.tsx");
const currentStock = read("src/modules/inventory/components/CurrentStockWorkspace.tsx");
const movements = read("src/modules/inventory/components/StockMovementsWorkspace.tsx");
const kitchen = read("src/modules/inventory/components/InventoryOperationalDashboard.tsx");
const operations = read("src/modules/inventory/components/StockOperationWorkspaces.tsx");
const purchasing = read("src/modules/purchasing/pages/PurchaseOrderDraftsPage.tsx");
const suppliers = read("src/modules/inventory/components/InventorySuppliersWorkspace.tsx");
const setup = read("src/modules/inventory/components/InventorySetupWorkspaces.tsx");

describe("Inventory V1 global presentation cleanup", () => {
  it("removes repeated page-level Inventory and tenant context", () => {
    expect(page).not.toContain("Today's stock operations");
    expect(page).not.toContain('<header className="ia-header"');
    expect(page).not.toContain("ia-mobile-header-title");
    expect(page).not.toContain("<span>{restaurantName}</span>");
    expect(page).toContain('<div className="ia-mobile-brand"><ServeFlowBrand variant="compact" /></div>');
  });

  it("starts the overview with operational information instead of its route name", () => {
    expect(overview).not.toContain('<h1>Dashboard</h1>');
    for (const title of ["Needs Attention", "Quick Operations", "Stock Snapshot", "Recent Activity"]) expect(overview).toContain(title);
    for (const removed of ["NOW", "DAILY WORK", "LATEST CHANGES", "Awaiting Inventory</small>", "Needs replenishment", "Below minimum level", "Open orders"]) expect(overview).not.toContain(removed);
    for (const action of [">Receive<", ">Issue<", ">Transfer<", ">Adjust<", ">Waste<", ">Purchase Order<"]) expect(overview).toContain(action);
  });

  it("removes Stock workspace subtitles without removing decisions", () => {
    for (const removed of ["LIVE STOCK", "Live stock across your storage locations"]) expect(currentStock).not.toContain(removed);
    expect(currentStock).not.toContain("<h2>Current Stock</h2>");
    for (const required of ["Material", "Storage", "Status", "Filters", "Receive", "Issue", "Transfer"]) expect(currentStock).toContain(required);
    for (const removed of ["OPERATIONAL HISTORY", "What changed in stock, where, and when"]) expect(movements).not.toContain(removed);
    expect(movements).not.toContain("<h2>Stock Movements</h2>");
  });

  it("keeps stock operation labels and review safety without introductory prose", () => {
    for (const removed of ["STOCK OPERATION", "Receive material into a storage location.", "Issue material from available stock.", "Move material between storage locations."]) expect(operations).not.toContain(removed);
    for (const required of ["Additional details", "Current stock", "Available", "Remaining", "Confirm Stock In", "Confirm Stock Out", "Confirm Transfer"]) expect(operations).toContain(required);
  });

  it("removes redundant Kitchen and Purchasing introductions", () => {
    expect(kitchen).not.toContain("Review and issue materials requested by kitchen.");
    expect(kitchen).not.toContain("KITCHEN REQUEST");
    expect(kitchen).not.toContain("<h2>Kitchen Requests</h2>");
    for (const required of ["Awaiting Inventory", "Awaiting Kitchen", "History", "Available in", "Cannot Fulfill"]) expect(kitchen).toContain(required);
    expect(purchasing).not.toContain("Track orders and receive deliveries.");
    expect(purchasing).not.toContain("<span>PURCHASE ORDER</span>");
    expect(purchasing).not.toContain("<h2>Purchase Orders</h2>");
    for (const required of ["Create Purchase Order", "Supplier", "Expected delivery", "Receive Delivery"]) expect(purchasing).toContain(required);
  });

  it("omits optional Setup card noise and preserves concise actions", () => {
    expect(suppliers).not.toContain("Manage the businesses you buy materials from.");
    expect(suppliers).not.toContain("<h2>Suppliers</h2>");
    expect(suppliers).toContain('supplier.status !== "active"');
    for (const removed of ["Materials tracked by this business.", "Places where inventory materials are kept.", "No description", "0 ingredients", "Stored Ingredients"]) expect(setup).not.toContain(removed);
    expect(setup).not.toContain("<h2>Materials</h2>");
    expect(setup).not.toContain("<h2>Storage</h2>");
    for (const required of ["Add Supplier", "Add Material", "Add Storage", "Search materials", "Edit"]) expect(`${suppliers}${setup}`).toContain(required);
  });

  it("preserves accessible names and critical confirmation context", () => {
    expect(currentStock).toContain('aria-label="Current stock search and filters"');
    expect(movements).toContain('aria-label="Stock movement search and filters"');
    expect(kitchen).toContain('aria-label="Kitchen request workflow"');
    expect(kitchen).toContain("This issues the full approved quantity and records one stock movement.");
    expect(page).toContain('aria-label="Open inventory navigation"');
  });
});
