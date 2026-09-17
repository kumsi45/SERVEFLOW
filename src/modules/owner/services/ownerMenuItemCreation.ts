import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import { supabase } from "../../../core/database";

export type OwnerMenuCreationPayload = {
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  new_category_name: string | null;
  tracking_mode: "no_tracking" | "recipe" | "direct_inventory";
  recipe_id: string | null;
  direct_inventory_item_id: string | null;
  kitchen_station_id: string | null;
  available: boolean;
  ingredients: string[];
  preparation_time_minutes: number | null;
  calories: number | null;
  protein_g: number | null;
  carbohydrates_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  photo_content_type: string | null;
};

export type OwnerMenuCreationResult = {
  request_id: string;
  replayed: boolean;
  menu_item: { id: string; image_url: string | null } & Record<string, unknown>;
  tracking_mode: OwnerMenuCreationPayload["tracking_mode"];
  auto_created_recipe: boolean;
  recipe_id: string | null;
  photo_state: "none" | "pending" | "attached";
  photo_object_path: string | null;
};

type PendingRequest = { requestId: string; payload: string };

function storageKey(restaurantId: string) {
  return `serveflow:owner-menu-create:${restaurantId}`;
}

export function ownerMenuCreationRequest(
  restaurantId: string,
  payload: OwnerMenuCreationPayload,
  activeRequestId?: string | null,
) {
  const serialized = JSON.stringify(payload);
  let pending: PendingRequest | null = null;
  if (typeof window !== "undefined") {
    try {
      pending = JSON.parse(window.sessionStorage.getItem(storageKey(restaurantId)) ?? "null") as PendingRequest | null;
    } catch {
      pending = null;
    }
  }
  const requestId = activeRequestId ?? (pending?.payload === serialized ? pending.requestId : createBrowserUuid());
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(storageKey(restaurantId), JSON.stringify({ requestId, payload: serialized }));
  }
  return {
    requestId,
    complete: () => {
      if (typeof window === "undefined") return;
      const current = window.sessionStorage.getItem(storageKey(restaurantId));
      if (!current) return;
      try {
        const parsed = JSON.parse(current) as PendingRequest;
        if (parsed.requestId === requestId) window.sessionStorage.removeItem(storageKey(restaurantId));
      } catch {
        window.sessionStorage.removeItem(storageKey(restaurantId));
      }
    },
  };
}

export async function createOwnerMenuItem(
  restaurantId: string,
  requestId: string,
  payload: OwnerMenuCreationPayload,
) {
  const { data, error } = await supabase.rpc("create_owner_menu_item_v1", {
    target_restaurant_id: restaurantId,
    target_request_id: requestId,
    payload,
  });
  if (error) throw new Error(error.message);
  return data as OwnerMenuCreationResult;
}

export async function finalizeOwnerMenuItemPhoto(
  restaurantId: string,
  requestId: string,
  menuItemId: string,
  objectPath: string,
) {
  const { data, error } = await supabase.rpc("finalize_owner_menu_item_photo_v1", {
    target_restaurant_id: restaurantId,
    target_request_id: requestId,
    target_menu_item_id: menuItemId,
    target_object_path: objectPath,
  });
  if (error) throw new Error(error.message);
  return data as { photo_state: "attached"; image_url: string; replayed: boolean };
}
