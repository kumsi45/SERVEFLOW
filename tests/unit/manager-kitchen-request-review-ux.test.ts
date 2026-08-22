import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx");
const service = read("src/modules/kitchen/services/inventoryRequestService.ts");
const authority = read("supabase/migrations/240_live_operations_kitchen_request_review.sql");
const styles = read("src/modules/manager/styles/managerKitchenSupervision.css");

describe("Manager Kitchen operational request review", () => {
  it("shows a single factual station workload and keeps assigned Chef count separate", () => {
    expect(page).toContain('if (station.queueLength === 0) return "No active orders"');
    for (const count of ["waiting", "preparing", "ready", "delayed"]) {
      expect(page).toContain(`station.${count} > 0 ? \`\${station.${count}} ${count}\``);
    }
    expect(page).toContain("const assigned = station.assignedStaffNames.length");
    expect(page).toContain('return "No Chefs assigned"');
    expect(page).toContain('assigned === 1 ? "Chef" : "Chefs"');
    expect(page).toContain('stationTone(station) !== "idle"');
    expect(page).not.toContain("No active workload");
  });

  it("opens an in-context canonical request inspector instead of making Review navigate", () => {
    expect(page.match(/onClick=\{\(\) => openRequest\(request\.id\)\}/g)).toHaveLength(2);
    expect(page).toContain('className="mks-inspector mks-request-inspector"');
    for (const field of ["Requested item", "Quantity", "Station", "Requested by", "Priority", "Requested", "Request age", "Request reason"]) {
      expect(page).toContain(field);
    }
    expect(page).toContain("Open Inventory");
    expect(page).toContain("navigateToInventory(restaurantId)");
  });

  it("uses the existing authorized review lifecycle and leaves fulfillment with Inventory", () => {
    expect(page).toContain('reviewRequest(request: InventoryRequest, action: "accept" | "reject")');
    expect(page).toContain("processInventoryRequest(restaurantId, request.id, action");
    expect(service).toContain('action:"accept"|"reject"|"deliver"');
    expect(service).toContain('supabase.rpc("process_kitchen_inventory_request"');
    expect(authority).toContain("target_action in ('accept','reject') and role::text in ('manager','owner')");
    expect(authority).toContain("target_action='deliver' and role::text in ('inventory_officer','owner')");
    expect(authority).toContain("if next_status='rejected' and normalized_reason is null");
    expect(authority).toContain("perform public.record_inventory_movement");
  });

  it("shows stock only for an exact linked canonical item and refreshes request and stock data", () => {
    expect(page).toContain("loadInventoryItems(restaurantId)");
    expect(page).toContain("item.id === selectedRequest.inventoryItemId");
    expect(page).not.toContain("item.name === selectedRequest.itemName");
    expect(page).toContain('"kitchen_inventory_requests", "inventory_items"');
    expect(page).toContain("Current inventory");
    expect(page).toContain("Reorder level");
  });

  it("keeps pending lifecycle filtering explicit and does not conceal request age", () => {
    expect(page).toContain('requests.filter((request) => request.status === "pending")');
    expect(page).toContain("minutesSince(request.requestedAt)");
    expect(page).toContain("minutesSince(selectedRequest.requestedAt)");
    expect(page).toContain("requestStatusLabel(selectedRequest.status)");
  });

  it("provides responsive drawer actions and overflow-safe long content", () => {
    expect(styles).toContain(".mks-request-inspector { width: min(520px, 100%);");
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toContain(".mks-request-inspector > footer { grid-template-columns: 1fr;");
    expect(styles).toContain("min-height: 46px");
  });
});
