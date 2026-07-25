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
