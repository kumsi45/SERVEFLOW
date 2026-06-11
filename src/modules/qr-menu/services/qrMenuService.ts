import { supabase } from "../../../core/database";
import type { MenuCategory, MenuItem, Restaurant } from "../types";

type QRMenuData = {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
};

function isQRMenuData(value: unknown): value is QRMenuData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<QRMenuData>;

  return Boolean(
    payload.restaurant &&
      typeof payload.restaurant.id === "string" &&
      typeof payload.restaurant.name === "string" &&
      typeof payload.restaurant.slug === "string" &&
      Array.isArray(payload.categories) &&
      Array.isArray(payload.items)
  );
}

export async function fetchQRMenuData(restaurantSlug: string): Promise<QRMenuData> {
  const { data, error } = await supabase.rpc("get_public_qr_menu", {
    target_restaurant_slug: restaurantSlug,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!isQRMenuData(data)) {
    throw new Error("Restaurant menu not found.");
  }

  return data;
}
