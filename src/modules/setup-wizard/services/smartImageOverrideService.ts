import { supabase } from "../../../core/database";
import type { SmartImageSource, SmartImageStatus } from "./smartImageLibrary";

type OverrideInput = {
  restaurantId: string;
  libraryId: string;
  itemId: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  version: number;
};

type OverrideRecord = {
  restaurant_id: string;
  library_id: string;
  item_id: string;
  source: SmartImageSource;
  custom_image_url: string | null;
  custom_thumbnail_url: string | null;
  custom_version: number;
  status: SmartImageStatus;
};

async function saveOverride(record: OverrideRecord) {
  const { data, error } = await supabase.from("restaurant_smart_menu_image_overrides").upsert(record, {
    onConflict: "restaurant_id,library_id,item_id",
  }).select().single();
  if (error) throw new Error(error.message);
  return data as OverrideRecord;
}

export function setCustomSmartImageOverride(input: OverrideInput) {
  return saveOverride({
    restaurant_id: input.restaurantId,
    library_id: input.libraryId,
    item_id: input.itemId,
    source: "CUSTOM",
    custom_image_url: input.imageUrl,
    custom_thumbnail_url: input.thumbnailUrl ?? input.imageUrl,
    custom_version: input.version,
    status: "APPROVED",
  });
}

export function restoreDefaultSmartImage(restaurantId: string, libraryId: string, itemId: string) {
  return saveOverride({
    restaurant_id: restaurantId,
    library_id: libraryId,
    item_id: itemId,
    source: "MASTER",
    custom_image_url: null,
    custom_thumbnail_url: null,
    custom_version: 0,
    status: "APPROVED",
  });
}
