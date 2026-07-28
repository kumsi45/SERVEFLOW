export type RecipeStatus = "draft" | "active" | "archived";
export type RecipeCategory = { id: string; name: string; description: string | null };
export type Recipe = {
  id: string; restaurant_id: string; recipe_code: string; name: string;
  description: string | null; category_id: string | null; category_name: string | null;
  preparation_time_minutes: number; yield_quantity: number; yield_unit: string;
  status: RecipeStatus; created_by: string | null; created_at: string; updated_at: string;
};
export type RecipeDraft = {
  name: string; description: string; categoryId: string; preparationTimeMinutes: string;
  yieldQuantity: string; yieldUnit: string; status: RecipeStatus;
};
export type RecipeFilters = {
  search: string; categoryId: string; status: string; preparation: string;
  sort: "newest" | "oldest"; page: number; pageSize: number;
};
export type RecipePage = { items: Recipe[]; total: number; page: number; page_size: number };
export type RecipeIngredient = {
  id: string; restaurant_id: string; recipe_id: string; inventory_item_id: string;
  inventory_item_name: string; quantity_required: number; unit_id: string; unit_name: string;
  optional_notes: string | null; sort_order: number; created_at: string; updated_at: string;
};
export type IngredientInventoryItem = {
  id: string; name: string; unit_id: string; current_quantity: number;
  minimum_stock: number; stock_status: "in_stock" | "low_stock" | "out_of_stock" | "over_stock";
};
export type IngredientUnit = { id: string; name: string; description: string | null };
export type RecipeIngredientDraft = {
  id?: string; inventoryItemId: string; quantityRequired: string; unitId: string;
  optionalNotes: string; sortOrder: number;
};
export type RecipeIngredientCost = {
  id: string; inventory_item_id: string; inventory_item_name: string;
  quantity_required: number; unit_id: string; unit_name: string;
  purchase_price: number; purchase_unit_name: string;
  unit_cost: number | null; ingredient_cost: number | null;
};
export type RecipeCost = {
  recipe_id: string; currency: string; total_cost: number; complete: boolean;
  ingredients: RecipeIngredientCost[];
};
