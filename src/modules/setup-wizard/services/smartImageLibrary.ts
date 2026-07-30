export const SMART_MENU_IMAGE_BUCKET = "smart-menu-images";
export const SMART_MENU_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const SMART_MENU_RESPONSIVE_WIDTHS = [320, 512, 768, 1024, 1280] as const;
export const SMART_MENU_PLACEHOLDER_PATH = "_placeholders/default/v1/menu-item-640w.webp";

export type {
  MenuImageAudience as SmartImageAudience,
  MenuImageCandidate as SmartImageCandidate,
  MenuImageLifecycle as SmartImageStatus,
  MenuImageSource as SmartImageSource,
} from "../../../core/presentation/menuItemImage";
export type SmartRestaurantTypeSlug = "restaurant" | "hotel" | "cafe" | "fast-food" | "bar-lounge" | "bakery";

export function toSmartImageSlug(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildSmartImageBasePath(restaurantType: SmartRestaurantTypeSlug, category: string, item: string) {
  return `${restaurantType}/${toSmartImageSlug(category)}/${toSmartImageSlug(item)}`;
}

export function buildSmartImageVersionPath(basePath: string, item: string, version: number, width: number, format: "avif" | "webp" | "jpg" | "png" = "webp") {
  const versionLabel = `v${String(version).padStart(3, "0")}`;
  return `${basePath}/${versionLabel}/${toSmartImageSlug(item)}-${versionLabel}-${width}w.${format}`;
}

export function buildResponsiveImageSet(baseUrl: string, basePath: string, item: string, version: number, format: "avif" | "webp" = "webp") {
  return SMART_MENU_RESPONSIVE_WIDTHS.map((width) => `${baseUrl}/${buildSmartImageVersionPath(basePath, item, version, width, format)} ${width}w`).join(", ");
}
