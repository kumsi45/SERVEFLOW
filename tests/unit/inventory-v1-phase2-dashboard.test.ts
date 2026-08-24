import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inventoryMovementBusinessLabel } from "../../src/modules/inventory/components/InventoryOverviewDashboard";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const overview = read("src/modules/inventory/components/InventoryOverviewDashboard.tsx");
const requestsWorkspace = read("src/modules/inventory/components/InventoryOperationalDashboard.tsx");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const requestService = read("src/modules/inventory/services/inventoryKitchenRequestService.ts");
const realtime = read("src/modules/inventory/hooks/useInventoryRealtime.ts");
const styles = read("src/modules/inventory/styles/inventoryDashboard.css");

describe("Inventory V1 Phase 2 dashboard", () => {
  it("separates the overview from the full Kitchen Request workspace", () => {
    expect(page).toContain("const dashboard = kitchenRequestsActive ? (");
    expect(page).toContain("<InventoryOverviewDashboard");
    expect(page).toContain("<InventoryOperationalDashboard");
    for (const forbidden of ["Awaiting Inventory <span>", "Awaiting Kitchen <span>", "History</button>", ">Issue</button>", "Cannot Fulfill"]) {
      expect(overview).not.toContain(forbidden);
    }
    expect(requestsWorkspace).toContain("Awaiting Inventory");
    expect(requestsWorkspace).toContain("Cannot Fulfill");
  });

  it("keeps a truthful Kitchen Request summary linked to the dedicated workflow", () => {
    expect(overview).toContain('request.status === "accepted"');
    expect(overview).toContain("Kitchen Requests");
    expect(overview).not.toContain("Awaiting Inventory</small>");
    expect(overview).toContain("onClick={onOpenRequests}");
    expect(page).toContain('window.history.pushState({}, "", "/inventory/dashboard#kitchen-requests")');
  });

  it("uses canonical stock and purchase counts without frontend placeholders", () => {
    expect(page).toContain("outOfStockCount={dashboardKpis.outOfStockItems}");
    expect(page).toContain("lowStockCount={dashboardKpis.lowStockItems}");
    expect(page).toContain("pendingPurchaseCount={dashboardKpis.pendingPurchaseOrders}");
    expect(overview).toContain('onNavigate("current-stock")');
    expect(overview).toContain('onNavigate("purchase-orders")');
  });

  it("never presents loading or failed sections as confirmed zeros", () => {
    expect(overview).toContain("Loading inventory overview...");
    expect(overview).toContain("Loading stock summary...");
    expect(overview).toContain("Kitchen requests unavailable.");
    expect(overview).toContain("Stock summary unavailable.");
    expect(overview).toContain("Purchase summary unavailable.");
    expect(overview).toContain("attentionConfirmed && knownActionCount === 0");
    expect(page).toContain('loading && section !== "dashboard"');
  });

  it("routes six compact daily actions and excludes material creation", () => {
    for (const [label, route] of [
      ["Receive", "stock-in"], ["Issue", "stock-out"], ["Transfer", "transfers"],
      ["Adjust", "adjustments"], ["Waste", "waste"], ["Purchase Order", "purchase-orders"],
    ]) {
      expect(overview).toContain(label);
      expect(overview).toContain(`onNavigate("${route}")`);
    }
    expect(overview).not.toContain("Create Material");
    expect(overview).not.toContain("Create Ingredient");
  });

  it("uses Materials terminology and omits finance and destructive administration", () => {
    expect(overview).toContain("Active Materials");
    for (const forbidden of ["Active Ingredients", "Inventory Value", "Archive", "Restore", "Soft Delete", "Integrity"]) {
      expect(overview).not.toContain(forbidden);
    }
  });

  it("uses business movement language and never renders technical references", () => {
    expect(inventoryMovementBusinessLabel("stock_in")).toBe("Received");
    expect(inventoryMovementBusinessLabel("stock_out")).toBe("Issued");
    expect(inventoryMovementBusinessLabel("transfer_out")).toBe("Transferred");
    expect(inventoryMovementBusinessLabel("waste")).toBe("Waste recorded");
    expect(overview).toContain("entry.storageLocationName");
    expect(overview).toContain("entry.staffName");
    expect(overview).toContain("recentLedger.slice(0, 6)");
    for (const forbidden of ["referenceNumber", "invoiceNumber", "transferGroupId", "createdByStaffId", "UUID", "RPC", "PostgREST"]) {
      expect(overview).not.toContain(forbidden);
    }
  });

  it("links activity to the dedicated stock movement workspace", () => {
    expect(overview).toContain("View Movements");
    expect(overview).toContain('onNavigate("ledger")');
  });

  it("preserves tenant-scoped services and realtime refresh", () => {
    expect(requestService).toContain("loadInventoryRequests(restaurantId)");
    expect(requestService).toContain("target_restaurant_id: restaurantId");
    expect(realtime).toContain('const authorizedRestaurantId = canAccessInventory(staffRole) ? restaurantId : ""');
    expect(realtime).toContain("restaurantId: authorizedRestaurantId");
    expect(page).toContain("onKitchenRequestsChanged: loadKitchenRequests");
    expect(page).toContain("loadRealtimeLedger(restaurantId");
  });

  it("defines mobile-first grids before tablet and desktop enhancements", () => {
    const base = styles.indexOf(".ia-i2-attention-grid { display: grid; grid-template-columns: repeat(2");
    const tablet = styles.indexOf("@media (min-width: 600px)");
    const desktop = styles.indexOf("@media (min-width: 1025px)");
    expect(base).toBeGreaterThanOrEqual(0);
    expect(base).toBeLessThan(tablet);
    expect(tablet).toBeLessThan(desktop);
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain("overflow-wrap: anywhere");
  });
});
