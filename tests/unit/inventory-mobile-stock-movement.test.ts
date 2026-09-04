import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserUuid } from "../../src/core/browser/createBrowserUuid";
import { recordInventoryMovement } from "../../src/modules/inventory/services/inventoryStockRepository";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../../src/core/database", () => ({
  supabase: { rpc },
}));

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Inventory mobile stock movement idempotency", () => {
  it("creates an RFC 4122 v4 key when a mobile browser has no crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(0x2a);
        return bytes;
      },
    });

    const key = createBrowserUuid();

    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it.each(["stock_in", "stock_out"] as const)("sends canonical %s payloads to the idempotent RPC", async (movementType) => {
    let seed = 0;
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = (seed + index) % 256;
        seed += 16;
        return bytes;
      },
    });

    await recordInventoryMovement({
      restaurantId: "restaurant-a",
      inventoryItemId: "material-a",
      storageLocationId: "main-store",
      movementType,
      quantity: movementType === "stock_in" ? 10 : 100,
      supplierId: null,
      reason: null,
      notes: null,
      movementDate: "2026-09-01T10:30",
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("record_inventory_movement_v2", expect.objectContaining({
      target_restaurant_id: "restaurant-a",
      target_inventory_item_id: "material-a",
      target_storage_location_id: "main-store",
      target_movement_type: movementType,
      target_quantity: movementType === "stock_in" ? 10 : 100,
      target_quantity_effect: null,
      target_supplier_id: null,
      target_reason: null,
      target_notes: null,
      target_movement_date: "2026-09-01T10:30",
      target_idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
  });

  it("reuses a failed request key but separates Stock In from Stock Out", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    let seed = 64;
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = seed++ % 256;
        return bytes;
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Temporary network failure" } });
    rpc.mockResolvedValue({ data: null, error: null });
    const common = {
      restaurantId: "restaurant-a",
      inventoryItemId: "material-a",
      storageLocationId: "main-store",
      quantity: 10,
    };

    await expect(recordInventoryMovement({ ...common, movementType: "stock_in" })).rejects.toThrow();
    await recordInventoryMovement({ ...common, movementType: "stock_in" });
    await recordInventoryMovement({ ...common, movementType: "stock_out" });

    const calls = rpc.mock.calls.map((call) => call[1] as { target_idempotency_key: string });
    expect(calls[0].target_idempotency_key).toBe(calls[1].target_idempotency_key);
    expect(calls[2].target_idempotency_key).not.toBe(calls[1].target_idempotency_key);
    expect(stored.size).toBe(0);
  });
});
