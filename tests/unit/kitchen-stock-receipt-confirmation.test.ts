import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatKitchenReceiptQuantity,
} from "../../src/modules/kitchen/components/KitchenStockRequestsPanel";
import {
  kitchenReceiptErrorMessage,
  partitionKitchenStockReceipts,
  type KitchenStockReceipt,
} from "../../src/modules/kitchen/services/inventoryRequestService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/247_kitchen_stock_receipt_confirmation.sql");
const historyQuantityMigration = read("supabase/migrations/248_kitchen_stock_receipt_history_quantity.sql");
const page = read("src/modules/kitchen/pages/KitchenDashboardPage.tsx");
const panel = read("src/modules/kitchen/components/KitchenStockRequestsPanel.tsx");
const service = read("src/modules/kitchen/services/inventoryRequestService.ts");
const styles = read("src/modules/kitchen/styles/kitchenDashboard.css");
const confirmation = migration.slice(migration.indexOf("create or replace function public.confirm_kitchen_inventory_request_receipt"));

const receipt = (status: KitchenStockReceipt["status"], id = status): KitchenStockReceipt => ({
  id,
  itemName: "Sugar",
  issuedQuantity: 2,
  unit: "kg",
  stationId: "station-a",
  stationName: "Beverages",
  storageLocationName: "Main Store",
  requestedAt: "2026-08-23T08:00:00Z",
  issuedAt: status === "rejected" ? null : "2026-08-23T09:05:00Z",
  issuedByName: "Inventory Officer",
  confirmedAt: status === "delivered" ? "2026-08-23T09:10:00Z" : null,
  confirmedByName: status === "delivered" ? "Chef" : null,
  status,
});

describe("Kitchen stock receipt confirmation", () => {
  it("counts only issued receipts and keeps completed outcomes in history", () => {
    const result = partitionKitchenStockReceipts([
      receipt("issued", "one"), receipt("issued", "two"), receipt("delivered"), receipt("rejected"), receipt("unable_to_fulfill"),
    ]);
    expect(result.pending.map((row) => row.id)).toEqual(["one", "two"]);
    expect(result.history.map((row) => row.status)).toEqual(["delivered", "rejected", "unable_to_fulfill"]);
  });

  it("renders authoritative quantities without inventing units", () => {
    expect(formatKitchenReceiptQuantity(2, "kg")).toBe("2 kg");
    expect(formatKitchenReceiptQuantity(2.125, "")).toBe("2.125");
    expect(formatKitchenReceiptQuantity(Number.NaN, "kg")).toBe("Not available");
    expect(historyQuantityMigration).toContain("coalesce(request.issued_quantity,request.quantity)");
  });

  it("uses the canonical server-filtered receipt read model", () => {
    expect(service).toContain('rpc("get_kitchen_stock_receipts"');
    expect(migration).toContain("actor.assigned_kitchen_station_id is not null");
    expect(migration).toContain("request.station_id=actor.assigned_kitchen_station_id");
    expect(migration).toContain("request.restaurant_id=target_restaurant_id");
    expect(migration).toContain("actor.role::text='owner'");
    expect(migration).not.toContain("using (true)");
  });

  it("confirms only an issued same-station request and never deducts stock again", () => {
    expect(confirmation).toContain("restaurant_id=target_restaurant_id");
    expect(confirmation).toContain("user_id=auth.uid()");
    expect(confirmation).toContain("request.station_id is distinct from actor.assigned_kitchen_station_id");
    expect(confirmation).toContain("request.status<>'issued'");
    expect(confirmation).toContain("status='delivered'");
    expect(confirmation).toContain("confirmed_by_staff_id=actor.id");
    expect(confirmation).toContain("confirmed_at=now_at");
    expect(confirmation).toContain("for update");
    expect(confirmation).not.toContain("record_inventory_movement(");
    expect(confirmation).not.toContain("insert into public.inventory_movements");
  });

  it("locks down both RPCs and derives identity from the authenticated user", () => {
    expect(migration).toContain("role::text in ('kitchen','owner')");
    expect(migration).toContain("revoke all on function public.get_kitchen_stock_receipts(uuid,integer) from public,anon,authenticated");
    expect(migration).toContain("revoke all on function public.confirm_kitchen_inventory_request_receipt(uuid,uuid) from public,anon,authenticated");
    expect(migration).not.toMatch(/target_(actor|staff|chef|confirmed_by)_id/);
  });

  it("places Requests beside Create Request and preserves the order board", () => {
    const requestsIndex = page.indexOf('className="kd-stock-requests-control"');
    const createIndex = page.indexOf("Create Request", requestsIndex);
    expect(requestsIndex).toBeGreaterThan(0);
    expect(createIndex).toBeGreaterThan(requestsIndex);
    expect(page).toContain("kd-order-workspace");
    expect(page).toContain("kd-order-grid");
    expect(page).toContain('aria-expanded={stockRequestsOpen}');
  });

  it("prevents rapid duplicate confirmation and reconciles realtime updates", () => {
    expect(page).toContain("receiptActionLocksRef.current.has(receipt.id)");
    expect(page).toContain("receiptActionLocksRef.current.add(receipt.id)");
    expect(page).toContain("receiptActionLocksRef.current.delete(receipt.id)");
    expect(page).toContain('event.table === "kitchen_inventory_requests"');
    expect(page).toContain("refreshStockReceipts(false)");
    expect(panel).toContain("disabled={confirmingId !== null}");
  });

  it("presents concise business language, empty state, history, and friendly errors", () => {
    for (const text of ["Stock Requests", "Confirm Received", "No stock is waiting for confirmation.", "View request history", "From ", "Issued "]) {
      expect(panel).toContain(text);
    }
    expect(kitchenReceiptErrorMessage(new Error("already confirmed"))).toBe("This request was already confirmed.");
    expect(kitchenReceiptErrorMessage(new Error("access denied"))).toBe("You do not have access to this request.");
    expect(kitchenReceiptErrorMessage(new Error("some postgres detail"))).toBe("Unable to confirm receipt. Try again.");
    for (const forbidden of ["RPC", "backend", "canonical", "database", "deployment", "state machine", "RLS", "Edge Function"]) {
      expect(panel).not.toContain(forbidden);
    }
  });

  it("provides tablet and mobile panel patterns with practical touch targets", () => {
    expect(styles).toContain("@media (min-width: 700px) and (max-width: 1280px)");
    expect(styles).toContain("width: min(440px, calc(100vw - 28px))");
    expect(styles).toContain("@media (max-width: 620px)");
    expect(styles).toContain("inset: auto 0 0");
    expect(styles).toContain("min-height: 48px");
  });
});
