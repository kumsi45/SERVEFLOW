import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const hook = read("src/core/presentation/useOperationalNotice.ts");
const kitchen = read("src/modules/kitchen/pages/KitchenDashboardPage.tsx");
const history = read("src/modules/kitchen/components/KitchenStockRequestsPanel.tsx");
const inventory = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const adjustments = read("src/modules/inventory/pages/InventoryAdjustmentsPage.tsx");
const lowStock = read("src/modules/inventory/pages/LowStockAssistantPage.tsx");
const purchasing = read("src/modules/purchasing/pages/PurchaseOrderDraftsPage.tsx");

describe("Kitchen and Inventory operational feedback UX", () => {
  it("identifies a delivered request by receiver and received time", () => {
    expect(history).toContain("receipt.confirmedByName");
    expect(history).toContain("formatKitchenReceiptTime(receipt.confirmedAt)");
    expect(history).toContain("receipt.stationName");
    expect(history).toContain("Received by ");
    expect(history).not.toContain("Received by Kitchen");
  });

  it("uses a four-second timer only when a routine notice exists", () => {
    expect(hook).toContain("OPERATIONAL_NOTICE_DURATION_MS = 4000");
    expect(hook).toContain("if (!message) return");
    expect(hook).toContain("window.setTimeout(() => clear(null), duration)");
    expect(hook).toContain("window.clearTimeout(timer)");
  });

  it("auto-dismisses routine Kitchen updates without coupling errors to the timer", () => {
    expect(kitchen).toContain("useOperationalNotice(requestNotice, setRequestNotice)");
    expect(kitchen).toContain("useOperationalNotice(realtimeNotice, setRealtimeNotice)");
    expect(kitchen).not.toContain("useOperationalNotice(error");
    expect(kitchen).toContain('className="kd-error-banner"');
    expect(kitchen).toContain('aria-live="polite"');
    expect(kitchen).not.toContain('className="kd-realtime-notice"');
  });

  it("normalizes Inventory successes while keeping important errors persistent", () => {
    for (const source of [inventory, adjustments, lowStock, purchasing]) {
      expect(source).toContain("useOperationalNotice(message, setMessage)");
      expect(source).not.toContain("useOperationalNotice(error");
      expect(source).toContain('role="alert"');
      expect(source).toContain('className="ia-operation-toast"');
      expect(source).toContain('aria-live="polite"');
    }
  });

  it("keeps Requests and Create Request adjacent in one material workflow group", () => {
    const groupStart = kitchen.indexOf('className="kd-material-actions"');
    const groupEnd = kitchen.indexOf("</div>", kitchen.indexOf("Create Request", groupStart));
    expect(groupStart).toBeGreaterThan(0);
    expect(kitchen.indexOf('className="kd-stock-requests-control"', groupStart)).toBeGreaterThan(groupStart);
    expect(kitchen.indexOf("Create Request", groupStart)).toBeLessThan(groupEnd);
  });

  it("does not change request services, lifecycle, or database contracts", () => {
    for (const source of [hook, history]) {
      expect(source).not.toContain("supabase.rpc");
      expect(source).not.toContain("kitchen_inventory_requests");
      expect(source).not.toContain("inventory_movements");
    }
  });
});
