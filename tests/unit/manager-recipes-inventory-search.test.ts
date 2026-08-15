import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => ({
  select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), ilike: vi.fn(), then: vi.fn(),
}));
const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));
const stockMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/core/database", () => ({ supabase: supabaseMock }));
vi.mock("../../src/modules/inventory/services/inventoryStockRepository", () => ({ loadInventoryCurrentStock: stockMock }));

import { searchActiveInventoryItems } from "../../src/modules/recipes/services/recipeService";

describe("Manager recipe tenant Inventory search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of ["select", "eq", "order", "limit", "ilike"] as const) queryMock[method].mockReturnValue(queryMock);
    queryMock.then.mockImplementation((resolve) => Promise.resolve(resolve({
      data: [{ id: "item-oil", name: "Cooking Oil", unit_id: "unit-ml" }], error: null,
    })));
    supabaseMock.from.mockReturnValue(queryMock);
    stockMock.mockResolvedValue([]);
  });

  it("trims a partial name query while retaining tenant and active predicates", async () => {
    const results = await searchActiveInventoryItems("tenant-a", "  OIL  ");

    expect(supabaseMock.from).toHaveBeenCalledWith("inventory_items");
    expect(queryMock.eq).toHaveBeenCalledWith("restaurant_id", "tenant-a");
    expect(queryMock.eq).toHaveBeenCalledWith("status", "active");
    expect(queryMock.ilike).toHaveBeenCalledWith("name", "%OIL%");
    expect(stockMock).toHaveBeenCalledWith("tenant-a");
    expect(results).toEqual([expect.objectContaining({ id: "item-oil", name: "Cooking Oil", unit_id: "unit-ml" })]);
  });
});
