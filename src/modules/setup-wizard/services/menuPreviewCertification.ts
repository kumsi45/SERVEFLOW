import { MENU_LANGUAGE_OPTIONS } from "../../../core/menu/menuLanguage";
import type { MenuReviewState } from "./menuReviewTypes";
import type { MenuPreviewRestaurant } from "./menuPublishService";

export type PreviewCheck = {
  id: string;
  label: string;
  detail: string;
  ready: boolean;
  blocking: boolean;
};

export function certifyMenuPreview(restaurant: MenuPreviewRestaurant, state: MenuReviewState) {
  const items = state.items.filter((item) => item.approved && !item.deleted && !item.hidden && !item.rejected);
  const normalizedNames = items.map((item) => item.name.value?.trim().toLocaleLowerCase() ?? "").filter(Boolean);
  const duplicateCount = normalizedNames.length - new Set(normalizedNames).size;
  const missingImages = items.filter((item) => !item.imageDraft.versions.some((version) => version.id === item.imageDraft.selectedVersionId && (version.status === "Approved" || version.status === "Owner Upload") && Boolean(version.imageUrl))).length;
  const missingPrices = items.filter((item) => item.price.value === null || !Number.isFinite(item.price.value) || item.price.value < 0).length;
  const missingDescriptions = items.filter((item) => !item.description.value?.trim()).length;
  const uncategorized = items.filter((item) => !item.categoryId || !state.categories.some((category) => category.id === item.categoryId)).length;
  const emptyCategories = state.categories.filter((category) => !items.some((item) => item.categoryId === category.id)).length;
  const hiddenItems = state.items.filter((item) => !item.deleted && (item.hidden || item.rejected)).length;
  const invalidTrackingTypes = items.filter((item) => !["recipe", "ready_to_sell", "no_tracking"].includes(item.trackingType ?? "no_tracking")).length;
  const languageCount = MENU_LANGUAGE_OPTIONS.filter(({ code }) => items.some((item) => Boolean(item.nameLocalization.values[code].value?.trim()))).length;
  const checks: PreviewCheck[] = [
    { id: "business", label: "Business Name", detail: restaurant.name.trim() ? restaurant.name : "Business name is missing", ready: Boolean(restaurant.name.trim()), blocking: true },
    { id: "logo", label: "Logo (optional)", detail: restaurant.logo_url ? "Logo ready" : "ServeFlow default will be used", ready: Boolean(restaurant.logo_url), blocking: false },
    { id: "cover", label: "Cover (optional)", detail: restaurant.cover_url ? "Cover ready" : "ServeFlow default will be used", ready: Boolean(restaurant.cover_url), blocking: false },
    { id: "categories", label: "Categories", detail: state.categories.length ? `${state.categories.length} categories` : "No categories", ready: state.categories.length > 0, blocking: true },
    { id: "items", label: "Menu Items", detail: items.length ? `${items.length} approved items` : "No approved menu items", ready: items.length > 0, blocking: true },
    { id: "prices", label: "Prices", detail: missingPrices ? `${missingPrices} missing or invalid` : "All prices ready", ready: missingPrices === 0, blocking: true },
    { id: "images", label: "Images", detail: missingImages ? `${missingImages} menu items missing images` : "All images ready", ready: missingImages === 0, blocking: false },
    { id: "descriptions", label: "Descriptions", detail: missingDescriptions ? `${missingDescriptions} menu items missing descriptions` : "All descriptions ready", ready: missingDescriptions === 0, blocking: false },
    { id: "theme", label: "Theme", detail: (restaurant.menu_theme ?? "modern").replace("_", " "), ready: true, blocking: false },
    { id: "languages", label: "Languages", detail: `${languageCount || 1} available`, ready: languageCount > 0, blocking: false },
    { id: "duplicates", label: "Unique Names", detail: duplicateCount ? `${duplicateCount} duplicate names` : "No duplicate names", ready: duplicateCount === 0, blocking: false },
    { id: "visibility", label: "Hidden Items", detail: hiddenItems ? `${hiddenItems} items excluded from customers` : "No hidden items", ready: hiddenItems === 0, blocking: false },
    { id: "tracking", label: "Tracking Type", detail: invalidTrackingTypes ? `${invalidTrackingTypes} items can be configured later` : "All items configured", ready: invalidTrackingTypes === 0, blocking: false },
    { id: "category-items", label: "Category Assignment", detail: uncategorized ? `${uncategorized} items need a category` : emptyCategories ? `${emptyCategories} empty categories` : "All categories populated", ready: uncategorized === 0 && emptyCategories === 0, blocking: uncategorized > 0 },
    { id: "qr", label: "QR Menu Ready", detail: "Customer rendering available", ready: Boolean(restaurant.slug && items.length && state.categories.length && missingPrices === 0 && uncategorized === 0), blocking: true },
  ];
  return {
    items,
    checks,
    canPublish: checks.every((check) => !check.blocking || check.ready),
    readiness: Math.round((checks.filter((check) => check.ready).length / checks.length) * 100),
    summary: { itemCount: items.length, categoryCount: state.categories.length, languageCount: languageCount || 1, missingImages, missingPrices, missingDescriptions, hiddenItems },
  };
}
