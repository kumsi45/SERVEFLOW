import { supabase } from "../../../core/database";
import { logPublicQrContext } from "../../public-qr-ordering/services/publicQrContext";
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
  logPublicQrContext("qrMenuService:menuLookup", { restaurantSlug });

  const { data, error } = await supabase.rpc("get_public_qr_menu", {
    target_restaurant_slug: restaurantSlug,
  });

  if (error) {
    logPublicQrContext("qrMenuService:menuLookup:error", {
      restaurantSlug,
      message: error.message,
    });
    throw new Error(error.message);
  }

  if (!isQRMenuData(data)) {
    throw new Error("Restaurant menu not found.");
  }

  logPublicQrContext("qrMenuService:menuLookup:result", {
    restaurantSlug,
    restaurantId: data.restaurant.id,
    categoryCount: data.categories.length,
    itemCount: data.items.length,
  });
  return {
    ...data,
    // The published item image is authoritative. Category hero imagery must
    // never impersonate a menu-item image when a snapshot intentionally has no image.
    items: data.items.map((item) => ({
      ...item,
      effective_image_url: item.image_url ?? null,
    })),
  };
}

export async function logPublicQrScan({
  restaurantSlug,
  tableNumber,
  qrToken,
}: {
  restaurantSlug: string;
  tableNumber: string;
  qrToken: string;
}) {
  if (!tableNumber.trim() || !qrToken.trim()) return;

  logPublicQrContext("qrMenuService:scanLog", {
    restaurantSlug,
    tableNumber,
    qrToken,
  });

  const { error } = await supabase.rpc("log_public_qr_scan", {
    target_restaurant_slug: restaurantSlug,
    table_number: tableNumber,
    qr_token: qrToken,
  });

  if (error) {
    logPublicQrContext("qrMenuService:scanLog:error", {
      restaurantSlug,
      tableNumber,
      qrToken,
      message: error.message,
    });
    throw new Error(error.message);
  }

  logPublicQrContext("qrMenuService:scanLog:result", {
    restaurantSlug,
    tableNumber,
    qrToken,
    validated: true,
  });
}
