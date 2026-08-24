import { supabase } from "../../../core/database";
import { loadManagerCachedData } from "./managerDataCache";

export type ManagerMenuCategory = {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  heroImageUrl: string | null;
};

export type ManagerMenuStation = { id: string; name: string; active: boolean };

export type ManagerMenuItem = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  available: boolean;
  categoryId: string;
  kitchenStationId: string | null;
  recipeId: string | null;
  recipeName: string | null;
  recipeStatus: string | null;
  directInventoryItemId: string | null;
  directInventoryItemName: string | null;
};

export type ManagerMenuSnapshot = {
  restaurantSlug: string | null;
  categories: ManagerMenuCategory[];
  stations: ManagerMenuStation[];
  items: ManagerMenuItem[];
};

function related<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function loadManagerMenuUncached(restaurantId: string): Promise<ManagerMenuSnapshot> {
  const [restaurantResult, categoryResult, stationResult, itemResult] = await Promise.all([
    supabase.from("restaurants").select("slug").eq("id", restaurantId).maybeSingle(),
    supabase.from("categories").select("id,name,description,display_order,hero_image_url").eq("restaurant_id", restaurantId).order("display_order").order("name"),
    supabase.from("kitchen_stations").select("id,name,active").eq("restaurant_id", restaurantId).is("archived_at", null).order("priority").order("name"),
    supabase.from("menu_items")
      .select("id,name,description,image_url,price,available,category_id,kitchen_station_id,recipe_id,direct_inventory_item_id,recipes!menu_items_recipe_same_restaurant(name,status),inventory_items!menu_items_direct_inventory_item_same_restaurant(name)")
      .eq("restaurant_id", restaurantId).is("archived_at", null).order("display_order").order("name"),
  ]);

  const error = restaurantResult.error ?? categoryResult.error ?? stationResult.error ?? itemResult.error;
  if (error) throw new Error(error.message);

  return {
    restaurantSlug: restaurantResult.data?.slug ? String(restaurantResult.data.slug) : null,
    categories: (categoryResult.data ?? []).map((row) => ({
      id: String(row.id), name: String(row.name), description: row.description ? String(row.description) : null,
      displayOrder: Number(row.display_order ?? 0), heroImageUrl: row.hero_image_url ? String(row.hero_image_url) : null,
    })),
    stations: (stationResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name), active: Boolean(row.active) })),
    items: (itemResult.data ?? []).map((row: Record<string, unknown>) => {
      const recipe = related(row.recipes as { name?: string; status?: string } | Array<{ name?: string; status?: string }> | null);
      const inventory = related(row.inventory_items as { name?: string } | Array<{ name?: string }> | null);
      return {
        id: String(row.id), name: String(row.name), description: row.description ? String(row.description) : null,
        imageUrl: row.image_url ? String(row.image_url) : null, price: Number(row.price ?? 0), available: Boolean(row.available),
        categoryId: String(row.category_id), kitchenStationId: row.kitchen_station_id ? String(row.kitchen_station_id) : null,
        recipeId: row.recipe_id ? String(row.recipe_id) : null, recipeName: recipe?.name ?? null, recipeStatus: recipe?.status ?? null,
        directInventoryItemId: row.direct_inventory_item_id ? String(row.direct_inventory_item_id) : null,
        directInventoryItemName: inventory?.name ?? null,
      };
    }),
  };
}

export function loadManagerMenu(restaurantId: string, force = false): Promise<ManagerMenuSnapshot> {
  return loadManagerCachedData({ restaurantId, resource: "menu", maxAgeMs: 60_000, force, loader: () => loadManagerMenuUncached(restaurantId) });
}

export async function setManagerMenuItemAvailability(restaurantId: string, itemId: string, available: boolean) {
  const { error } = await supabase.from("menu_items").update({ available }).eq("restaurant_id", restaurantId).eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function updateManagerMenuItem(
  restaurantId: string,
  itemId: string,
  changes: { name: string; description: string | null; price: number; category_id: string; kitchen_station_id: string | null },
) {
  const { error } = await supabase.from("menu_items").update(changes).eq("restaurant_id", restaurantId).eq("id", itemId);
  if (error) throw new Error(error.message);
}
