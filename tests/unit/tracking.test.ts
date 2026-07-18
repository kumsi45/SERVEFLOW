import { beforeEach, describe, expect, it } from "vitest";
import { persistCustomerTracking, readCustomerTracking } from "../../src/modules/public-qr-ordering/services/customerTrackingService";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

describe("customer tracking persistence", () => {
  beforeEach(() => { Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: new MemoryStorage() } }); });
  it("restores restaurant, session, order and invoice after browser restart", () => {
    const record = { restaurant_slug: "tenant-a", session_id: "session-1", order_id: "order-1", invoice_id: "invoice-1", table_number: "7", qr_token: "qr", browser_session_token: "browser", operational_status: "preparing", payment_status: "paid", updated_at: new Date().toISOString() };
    persistCustomerTracking(record);
    expect(readCustomerTracking("tenant-a")).toEqual(record);
  });
  it("never restores another restaurant's tracking record", () => {
    persistCustomerTracking({ restaurant_slug: "tenant-a", session_id: "s", order_id: "o", invoice_id: "i", table_number: "1", qr_token: "q", browser_session_token: "b", updated_at: new Date().toISOString() });
    expect(readCustomerTracking("tenant-b")).toBeNull();
  });
});
