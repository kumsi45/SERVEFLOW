import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  markInventoryKitchenRequestUnable,
  partitionInventoryKitchenRequests,
  type InventoryKitchenQueueRequest,
} from "../../src/modules/inventory/services/inventoryKitchenRequestService";
import { formatInventoryQuantity } from "../../src/modules/inventory/components/InventoryOperationalDashboard";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const service = read("src/modules/inventory/services/inventoryKitchenRequestService.ts");
const dashboard = read("src/modules/inventory/components/InventoryOperationalDashboard.tsx");
const page = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const realtime = read("src/modules/inventory/services/inventoryRealtimeService.ts");
const migration = read("supabase/migrations/242_kitchen_request_inventory_handoff.sql");
const styles = read("src/modules/inventory/styles/inventoryDashboard.css");

const request = (status: InventoryKitchenQueueRequest["status"], restaurantId = "restaurant-a") => ({
  id: `request-${status}`,
  restaurantId,
  status,
  itemName: "Sugar",
  quantity: 5,
  unit: "kg",
  urgency: "normal",
  currentQuantity: 20,
  reorderLevel: 5,
} as InventoryKitchenQueueRequest);

describe("Inventory Phase I1 Kitchen handoff", () => {
  it("partitions only canonical actionable and terminal lifecycle states", () => {
    const grouped = partitionInventoryKitchenRequests([
      request("pending"), request("accepted"), request("issued"), request("delivered"),
      request("rejected"), request("unable_to_fulfill"),
    ]);
    expect(grouped.awaitingInventory.map((row) => row.status)).toEqual(["accepted"]);
    expect(grouped.awaitingKitchen.map((row) => row.status)).toEqual(["issued"]);
    expect(grouped.history.map((row) => row.status)).toEqual(["delivered", "rejected", "unable_to_fulfill"]);
  });

  it("uses only the canonical queue and request transition RPCs", () => {
    expect(service).toContain('rpc("get_inventory_kitchen_request_queue"');
    expect(service).toContain('rpc("issue_kitchen_inventory_request"');
    expect(service).toContain('rpc("mark_kitchen_inventory_request_unable_to_fulfill"');
    expect(service).not.toMatch(/recordInventory|record_inventory_movement|\.update\(|\.insert\(/);
    expect(migration).toContain("movement_id:=public.record_inventory_movement(");
    expect(migration).toContain("if request.status<>'accepted'");
  });

  it("requires a Cannot Fulfill reason before calling the backend", async () => {
    await expect(markInventoryKitchenRequestUnable("restaurant-a", "request-a", "  "))
      .rejects.toThrow("Unable to fulfill reason is required.");
  });

  it("keeps reads tenant-scoped and role mutations backend-authorized", () => {
    expect(service).toContain("loadInventoryRequests(restaurantId)");
    expect(service).toContain("target_restaurant_id: restaurantId");
    expect(migration).toContain("request.restaurant_id=target_restaurant_id");
    expect(migration).toContain("role::text in ('inventory_officer','owner')");
    expect(migration).toContain("grant execute on function public.issue_kitchen_inventory_request(uuid,uuid) to authenticated,service_role");
    expect(migration).toContain("revoke all on function public.issue_kitchen_inventory_request(uuid,uuid) from public,anon,authenticated");
  });

  it("renders the requested operational order and avoids duplicate dashboard navigation", () => {
    const titles = ["Needs Attention", "Kitchen Requests", "Quick Operations", "Stock Snapshot", "Recent Activity"];
    const positions = titles.map((title) => dashboard.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(dashboard).not.toContain("Report Shortcuts");
    expect(dashboard).not.toContain("Create Ingredient");
    expect(dashboard).toContain("Everything is under control");
    expect(dashboard).toContain("No inventory actions currently require attention.");
  });

  it("shows one-time issue semantics and prevents a second action on issued requests", () => {
    expect(dashboard).toContain("You are issuing");
    expect(dashboard).toContain("Stock will decrease from");
    expect(dashboard).toContain("remainingAfterIssue");
    expect(dashboard).toContain('request.status === "accepted" && canProcessRequests');
    expect(dashboard).toContain("Waiting for Kitchen confirmation. Inventory stock was already deducted.");
    expect(page).toContain("Stock was deducted once.");
    expect(page).toContain("No stock was deducted.");
  });

  it("uses one consolidated responsive page header", () => {
    expect(dashboard).not.toContain("restaurantName");
    expect(page).toContain("{restaurantName} · Today&apos;s stock operations");
    expect(page).not.toContain("Manage today&apos;s stock operations");
  });

  it("keeps request cards compact, status-aware, and non-technical", () => {
    expect(dashboard).toContain("ia-i1-request-meta");
    expect(dashboard).toContain("showHistoryStatus");
    expect(dashboard).not.toContain('request.status === "accepted" ? "Awaiting Inventory"');
    expect(dashboard).toContain('const cardState = insufficient ? "insufficient"');
    expect(dashboard).toContain('? "priority" : "normal"');
    for (const forbidden of ["backend", "RPC", "deployed contract", "database", "migration", "PostgREST", "canonical contract"]) {
      expect(dashboard.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("formats quantity and units without malformed fallbacks", () => {
    expect(formatInventoryQuantity(0, "kg")).toBe("0 kg");
    expect(formatInventoryQuantity(3, "  ")).toBe("3");
    expect(formatInventoryQuantity(Number.NaN, "kg")).toBe("Not available");
    expect(dashboard).toContain("Available stock could not be confirmed.");
    expect(dashboard).toContain("disabled={!canIssue}");
  });

  it("supports compact four, three, two, and one-column request layouts", () => {
    expect(styles).toContain(".ia-i1-request-list { display: grid; grid-template-columns: repeat(4");
    expect(styles).toContain("@media (max-width: 1499px)");
    expect(styles).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(styles).toContain("@media (max-width: 1199px)");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toMatch(/\.ia-i1-request-list,\s*\n\s*\.ia-i1-snapshot-grid \{ grid-template-columns: 1fr; \}/);
    expect(styles).toContain("min-height: 68px");
  });

  it("reconciles Kitchen request lifecycle changes through tenant realtime", () => {
    expect(realtime).toContain('"kitchen_inventory_requests"');
    expect(page).toContain("onKitchenRequestsChanged: loadKitchenRequests");
    expect(page).toContain("await loadKitchenRequests()");
  });
});
