import { beforeEach, describe, expect, it, vi } from "vitest";

const recipeServiceMock = vi.hoisted(() => ({
  fetchActiveIngredientUnits: vi.fn(),
  fetchRecipeIngredients: vi.fn(),
  fetchRecipes: vi.fn(),
  searchActiveInventoryItems: vi.fn(),
}));

const menuRecipeServiceMock = vi.hoisted(() => ({
  fetchMenuRecipeLinks: vi.fn(),
}));

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("../../src/modules/recipes/services/recipeService", () => recipeServiceMock);
vi.mock("../../src/modules/menu-recipes/services/menuRecipeService", () => menuRecipeServiceMock);
vi.mock("../../src/core/database", () => ({ supabase: supabaseMock }));

import { loadManagerRecipeWorkspace } from "../../src/modules/manager/services/managerRecipeWorkspaceService";
import type { Recipe } from "../../src/modules/recipes/types";

function recipe(id: string): Recipe {
  return {
    id,
    restaurant_id: "restaurant-a",
    recipe_code: `R-${id}`,
    name: `Recipe ${id}`,
    description: null,
    category_id: null,
    category_name: null,
    preparation_time_minutes: 10,
    yield_quantity: 1,
    yield_unit: "serving",
    status: "active",
    created_by: null,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
  };
}

function mockKitchenStations() {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  supabaseMock.from.mockReturnValue(query);
}

describe("Manager Recipes pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKitchenStations();
    menuRecipeServiceMock.fetchMenuRecipeLinks.mockResolvedValue([]);
    recipeServiceMock.searchActiveInventoryItems.mockResolvedValue([]);
    recipeServiceMock.fetchActiveIngredientUnits.mockResolvedValue([]);
    recipeServiceMock.fetchRecipeIngredients.mockResolvedValue([]);
  });

  it("starts recipe loading with a backend-valid first page and follows subsequent pages", async () => {
    const firstPageRecipes = Array.from({ length: 100 }, (_, index) => recipe(String(index + 1)));
    const secondPageRecipe = recipe("101");
    recipeServiceMock.fetchRecipes
      .mockResolvedValueOnce({ items: firstPageRecipes, total: 101, page: 1, page_size: 100 })
      .mockResolvedValueOnce({ items: [secondPageRecipe], total: 101, page: 2, page_size: 100 });

    const snapshot = await loadManagerRecipeWorkspace("restaurant-a");

    expect(recipeServiceMock.fetchRecipes).toHaveBeenNthCalledWith(1, "restaurant-a", expect.objectContaining({
      page: 1,
      pageSize: 100,
    }));
    expect(recipeServiceMock.fetchRecipes).toHaveBeenNthCalledWith(2, "restaurant-a", expect.objectContaining({
      page: 2,
      pageSize: 100,
    }));
    expect(recipeServiceMock.fetchRecipes).not.toHaveBeenCalledWith("restaurant-a", expect.objectContaining({ pageSize: 500 }));
    expect(snapshot.recipes).toHaveLength(101);
  });
});
