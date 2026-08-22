import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx");
const service = read("src/modules/kitchen/services/inventoryRequestService.ts");
const workflow = read("supabase/migrations/122_kitchen_inventory_request_workflow.sql");
const authority = read("supabase/migrations/240_live_operations_kitchen_request_review.sql");
const styles = read("src/modules/manager/styles/managerKitchenSupervision.css");
const drawer = page.slice(page.indexOf("{selectedRequest &&"), page.indexOf("{selectedStation &&"));

describe("Manager Kitchen material request drawer cleanup", () => {
  it("shows concise status once in the header and not again in request details", () => {
    expect(service).toContain('if(status==="pending")return "Pending Review"');
    expect(drawer.match(/inventoryRequestStatusLabel\(selectedRequest\.status\)/g)).toHaveLength(1);
    expect(drawer).not.toContain("<dt>Status</dt>");
    expect(drawer).not.toContain("Pending Manager Review");
  });

  it("keeps the manager decision fields and restaurant-local timestamp", () => {
    for (const field of ["Requested item", "Quantity", "Station", "Requested by", "Priority", "Requested", "Request reason"]) expect(drawer).toContain(field);
    expect(drawer).toContain("requestDateTime(selectedRequest.requestedAt, restaurantTimezone)");
    expect(page).toContain("loadRestaurantAnalyticsTimezone(restaurantId)");
    expect(page).toContain('return `${dateLabel} · ${timeLabel}`');
  });

  it("uses a neutral human-readable waiting duration without inventing overdue state", () => {
    expect(drawer).toContain("<dt>Waiting</dt>");
    expect(drawer).toContain("requestWaitingDuration(selectedRequest.requestedAt)");
    expect(page).toContain('return `${days} ${days === 1 ? "day" : "days"}`');
    expect(drawer).not.toContain("Request age");
    expect(drawer).not.toContain("Overdue");
  });

  it("uses a compact truthful missing-reason state", () => {
    const requestReason = drawer.slice(drawer.indexOf('className="mks-request-reason-section"'), drawer.indexOf('className="mks-request-inventory"'));
    expect(requestReason).toContain('selectedRequest.comment || "Not provided"');
    expect(requestReason).not.toContain("Reason not recorded.");
    expect(workflow).toContain("target_comment text default null");
  });

  it("shows canonical inventory quantities and distinct unavailable states", () => {
    expect(page).toContain("loadInventoryItems(restaurantId)");
    expect(page).toContain("item.id === selectedRequest.inventoryItemId");
    expect(page).not.toContain("item.name === selectedRequest.itemName");
    for (const value of ["Available", "Requested", "Reorder level", "Current inventory is unavailable.", "No inventory item is linked", "linked inventory item is unavailable"]) expect(drawer).toContain(value);
    expect(drawer).toContain("selectedInventoryItem.currentQuantity");
    expect(drawer).toContain("selectedInventoryItem.reorderLevel");
    expect(drawer).not.toContain("tenant-scoped inventory record");
    expect(drawer).not.toContain("Not set");
  });

  it("calculates after-fulfillment or shortage only for compatible canonical units", () => {
    expect(page).toContain("normalizeUnit(request.unit) === normalizeUnit(item.unit)");
    expect(page).toContain("item.currentQuantity - request.quantity");
    expect(page).toContain("afterFulfillment: difference");
    expect(page).toContain("shortBy: Math.abs(difference)");
    expect(page).toContain("if (!compatible) return { afterFulfillment: null, shortBy: null }");
    for (const value of ["After fulfillment", "Short by", "Units differ"]) expect(drawer).toContain(value);
  });

  it("uses canonical approve and reject mutations while Inventory alone fulfills stock", () => {
    expect(drawer).toContain("Approve Request");
    expect(drawer).toContain(">Reject</button>");
    expect(page).toContain('reviewRequest(request: InventoryRequest, action: "accept" | "reject")');
    expect(page).toContain("processInventoryRequest(restaurantId, request.id, action");
    expect(service).toContain('supabase.rpc("process_kitchen_inventory_request"');
    expect(authority).toContain("target_action in ('accept','reject') and role::text in ('manager','owner')");
    expect(authority).toContain("target_action='deliver' and role::text in ('inventory_officer','owner')");
    expect(authority).toContain("if next_status='rejected' and normalized_reason is null");
    expect(authority).toContain("perform public.record_inventory_movement");
    expect(drawer).not.toContain("record_inventory_movement");
  });

  it("keeps Open Inventory secondary and removes the competing footer Close action", () => {
    expect(drawer).toContain('className="secondary" onClick={() => navigateToInventory(restaurantId)}>Open Inventory');
    expect(drawer).toContain('aria-label="Close kitchen request"');
    expect(drawer).not.toContain("<footer");
    expect(drawer).not.toContain(">Close</button>");
  });

  it("preserves tenant reads, realtime refresh, and server-derived role guards", () => {
    expect(service).toContain('.eq("restaurant_id",restaurantId)');
    expect(page).toContain('"kitchen_inventory_requests", "inventory_items"');
    expect(workflow).toContain("restaurant_id=target_restaurant_id");
    expect(authority).toContain("user_id=auth.uid()");
    expect(authority).toContain("active=true");
  });

  it("keeps drawer content and actions responsive without sticky content coverage", () => {
    expect(styles).toContain(".mks-request-inspector { width: min(520px, 100%);");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain(".mks-request-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(styles).toContain(".mks-request-actions { grid-template-columns: 1fr;");
    expect(styles).toContain("min-height: 46px");
    expect(styles).not.toContain(".mks-request-inspector > footer");
  });
});
