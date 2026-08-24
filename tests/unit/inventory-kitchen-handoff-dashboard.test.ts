import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatInventoryQuantity, inventoryRequestAvailability, sortInventoryRequestHistory } from "../../src/modules/inventory/components/InventoryOperationalDashboard";
import { markInventoryKitchenRequestUnable, partitionInventoryKitchenRequests, type InventoryKitchenQueueRequest } from "../../src/modules/inventory/services/inventoryKitchenRequestService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const service = read("src/modules/inventory/services/inventoryKitchenRequestService.ts");
const workspace = read("src/modules/inventory/components/InventoryOperationalDashboard.tsx");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const realtime = read("src/modules/inventory/services/inventoryRealtimeService.ts");
const migration = read("supabase/migrations/242_kitchen_request_inventory_handoff.sql");
const queueMigration = read("supabase/migrations/249_kitchen_material_request_expansion.sql");
const styles = read("src/modules/inventory/styles/inventoryKitchenRequests.css");
const request = (status: InventoryKitchenQueueRequest["status"], overrides: Partial<InventoryKitchenQueueRequest> = {}) => ({ id: `request-${status}`, restaurantId: "restaurant-a", status, inventoryItemId: "item-a", itemName: "Sugar", quantity: 5, unit: "kg", urgency: "normal", currentQuantity: 20, reorderLevel: 5, requestedAt: "2026-08-20T10:00:00Z", ...overrides } as InventoryKitchenQueueRequest);

describe("Inventory Kitchen Requests operational queue", () => {
  it("maps only real lifecycle states into the workflow tabs", () => {
    const grouped = partitionInventoryKitchenRequests([request("pending"), request("accepted"), request("issued"), request("delivered"), request("rejected"), request("unable_to_fulfill")]);
    expect(grouped.awaitingInventory.map((row) => row.status)).toEqual(["accepted"]);
    expect(grouped.awaitingKitchen.map((row) => row.status)).toEqual(["issued"]);
    expect(grouped.history.map((row) => row.status)).toEqual(["delivered", "rejected", "unable_to_fulfill"]);
  });

  it("sorts history by newest completion timestamp", () => {
    const rows = sortInventoryRequestHistory([request("delivered", { id: "old", deliveredAt: "2026-08-21T10:00:00Z" }), request("unable_to_fulfill", { id: "same-a", unableToFulfillAt: "2026-08-23T10:00:00Z" }), request("rejected", { id: "same-b", rejectedAt: "2026-08-23T10:00:00Z" })]);
    expect(rows.map((row) => row.id)).toEqual(["same-b", "same-a", "old"]);
  });

  it("classifies configured-storage availability", () => {
    expect(inventoryRequestAvailability(request("accepted", { currentQuantity: 20 }))).toBe("available");
    expect(inventoryRequestAvailability(request("accepted", { currentQuantity: 4 }))).toBe("insufficient");
    expect(inventoryRequestAvailability(request("accepted", { currentQuantity: 0 }))).toBe("out");
    expect(inventoryRequestAvailability(request("accepted", { currentQuantity: null }))).toBe("unavailable");
  });

  it("uses canonical atomic transition RPCs", () => {
    expect(service).toContain('rpc("get_inventory_kitchen_request_queue"');
    expect(service).toContain('rpc("issue_kitchen_inventory_request"');
    expect(service).toContain('rpc("mark_kitchen_inventory_request_unable_to_fulfill"');
    expect(service).not.toMatch(/recordInventory|record_inventory_movement|\.update\(|\.insert\(/);
    expect(migration).toContain("movement_id:=public.record_inventory_movement(");
    expect(migration).toContain("if request.status<>'accepted'");
    expect(migration).toContain("available_quantity<request.quantity");
  });

  it("uses the canonical configured storage balance without aggregation", () => {
    expect(queueMigration).toContain("movement.storage_location_id=item.storage_location_id");
    expect(migration).toContain("public.get_inventory_storage_balance(target_restaurant_id,item.id,item.storage_location_id)");
    expect(workspace).toContain("requestStorageLocations");
    expect(workspace).not.toContain("currentStock.find");
  });

  it("blocks impossible and partial issue presentation", () => {
    expect(workspace).toContain('availability === "available" && <button');
    expect(workspace).toContain("OUT OF STOCK");
    expect(workspace).toContain("Insufficient stock · short by");
    expect(workspace).toContain('input type="number" readOnly value={action.request.quantity}');
    expect(workspace).toContain("This issues the full approved quantity and records one stock movement.");
  });

  it("keeps Cannot Fulfill confirmed and free-text compatible", async () => {
    await expect(markInventoryKitchenRequestUnable("restaurant-a", "request-a", "  ")).rejects.toThrow("Unable to fulfill reason is required.");
    for (const reason of ["Insufficient stock", "Out of stock", "Material unavailable", "Other"]) expect(workspace).toContain(reason);
    expect(workspace).toContain("Confirm Cannot Fulfill");
  });

  it("removes dashboard duplication and technical labels", () => {
    for (const forbidden of ["Needs Attention", "Quick Operations", "Stock Snapshot", "Recent Activity", "Current Inventory Value", "Ingredient / Food Material"]) expect(workspace).not.toContain(forbidden);
    expect(workspace).not.toContain("<h2>Kitchen Requests</h2>");
    expect(workspace).not.toContain("Review and issue materials requested by kitchen.");
    expect(workspace).not.toContain("materialRequestTypeLabel");
  });

  it("keeps approval secondary and issued cards action-free", () => {
    expect(workspace).toContain("<summary>Request details</summary>");
    expect(workspace).toContain("Approved by {request.reviewerName}");
    expect(workspace).toContain("Waiting for Kitchen");
    expect(workspace).not.toContain('request.status === "issued" && canProcessRequests');
  });

  it("uses bounded history and hides zero badges", () => {
    expect(workspace).toContain("const HISTORY_PAGE_SIZE = 20");
    expect(workspace).toContain("allHistory.slice(0, historyCount)");
    expect(workspace).toContain("Load More");
    expect(workspace).toContain("accepted.length > 0 && <span");
    expect(workspace).toContain("issued.length > 0 && <span");
  });

  it("preserves tenant and role authorization", () => {
    expect(service).toContain("target_restaurant_id: restaurantId");
    expect(migration).toContain("request.restaurant_id=target_restaurant_id");
    expect(migration).toContain("role::text in ('inventory_officer','owner')");
    expect(page).toContain('canProcessRequests={staffRole === "owner" || staffRole === "inventory_officer"}');
    expect(workspace).not.toContain("Delete request");
  });

  it("keeps safe states, realtime, quantity formatting, and responsive rules", () => {
    expect(formatInventoryQuantity(0, "kg")).toBe("0 kg");
    expect(formatInventoryQuantity(3, "  ")).toBe("3");
    expect(workspace).toContain("Kitchen requests couldn&apos;t be loaded.");
    expect(workspace).not.toContain("{requestsError}");
    expect(realtime).toContain('"kitchen_inventory_requests"');
    expect(page).toContain("onKitchenRequestsChanged: loadKitchenRequests");
    expect(styles).toContain("@media (min-width: 700px)");
    expect(styles).toContain("repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("min-height: 44px");
  });
});
