import { MENU_LANGUAGE_OPTIONS } from "../../../core/menu/menuLanguage";
import type { MenuReviewState } from "./menuReviewTypes";
import type { MenuPreviewRestaurant } from "./menuPublishService";
import { resolveSmartImage } from "../../../core/presentation/smartImageDelivery";
import { menuReviewImageCandidates } from "./menuReviewImageCandidates";
import { SERVEFLOW_MENU_PLACEHOLDER_IMAGE } from "./ownerMenuItemDefaults";

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
  const normalizedCategories = state.categories.map((category) => category.name.trim().toLocaleLowerCase()).filter(Boolean);
  const duplicateCategoryCount = normalizedCategories.length - new Set(normalizedCategories).size;
  const missingImages = items.filter((item) => {
    const candidates = menuReviewImageCandidates(item.imageDraft);
    return !resolveSmartImage({ itemId: item.id, custom: candidates.custom, master: candidates.master, placeholderUrl: SERVEFLOW_MENU_PLACEHOLDER_IMAGE }, "card", "owner-review").url;
  }).length;
  const missingPrices = items.filter((item) => item.price.value === null || !Number.isFinite(item.price.value) || item.price.value < 0).length;
  const missingDescriptions = items.filter((item) => !item.description.value?.trim()).length;
  const uncategorized = items.filter((item) => !item.categoryId || !state.categories.some((category) => category.id === item.categoryId)).length;
  const emptyCategories = state.categories.filter((category) => !items.some((item) => item.categoryId === category.id)).length;
  const hiddenItems = state.items.filter((item) => !item.deleted && (item.hidden || item.rejected)).length;
  const invalidTrackingTypes = items.filter((item) => !["recipe", "ready_to_sell", "no_tracking"].includes(item.trackingType ?? "no_tracking")).length;
  const languageCount = MENU_LANGUAGE_OPTIONS.filter(({ code }) => items.some((item) => Boolean(item.nameLocalization.values[code].value?.trim()))).length;
  const businessType = typeof restaurant.profile.restaurant_type === "string" ? restaurant.profile.restaurant_type.trim() : "";
  const social = restaurant.profile.social_links && typeof restaurant.profile.social_links === "object" ? restaurant.profile.social_links as Record<string, unknown> : {};
  const checks: PreviewCheck[] = [
    { id: "business", label: "Business Name", detail: restaurant.name.trim() ? restaurant.name : "Business name is missing", ready: Boolean(restaurant.name.trim()), blocking: true },
    { id: "business-type", label: "Business Type", detail: businessType || "Business type is missing", ready: Boolean(businessType), blocking: true },
    { id: "logo", label: "Logo (optional)", detail: restaurant.logo_url ? "Logo ready" : "ServeFlow default will be used", ready: Boolean(restaurant.logo_url), blocking: false },
    { id: "cover", label: "Cover (optional)", detail: restaurant.cover_url ? "Cover ready" : "ServeFlow default will be used", ready: Boolean(restaurant.cover_url), blocking: false },
    { id: "categories", label: "Categories", detail: state.categories.length ? `${state.categories.length} categories` : "No categories", ready: state.categories.length > 0, blocking: true },
    { id: "items", label: "Menu Items", detail: items.length ? `${items.length} approved items` : "No approved menu items", ready: items.length > 0, blocking: true },
    { id: "prices", label: "Prices", detail: missingPrices ? `${missingPrices} missing or invalid` : "All prices ready", ready: missingPrices === 0, blocking: true },
    { id: "images", label: "Images", detail: missingImages ? `${missingImages} items will use the ServeFlow default` : "Every item has a resolved image", ready: missingImages === 0, blocking: false },
    { id: "descriptions", label: "Descriptions", detail: missingDescriptions ? `${missingDescriptions} menu items missing descriptions` : "All descriptions ready", ready: missingDescriptions === 0, blocking: false },
    { id: "theme", label: "Theme", detail: (restaurant.menu_theme ?? "modern").replace("_", " "), ready: true, blocking: false },
    { id: "languages", label: "Languages", detail: `${languageCount || 1} available`, ready: languageCount > 0, blocking: false },
    { id: "duplicates", label: "Unique Names", detail: duplicateCount ? `${duplicateCount} duplicate names` : "No duplicate names", ready: duplicateCount === 0, blocking: true },
    { id: "duplicate-categories", label: "Unique Categories", detail: duplicateCategoryCount ? `${duplicateCategoryCount} duplicate categories` : "No duplicate categories", ready: duplicateCategoryCount === 0, blocking: true },
    { id: "visibility", label: "Hidden Items", detail: hiddenItems ? `${hiddenItems} items excluded from customers` : "No hidden items", ready: hiddenItems === 0, blocking: false },
    { id: "tracking", label: "Tracking Type", detail: invalidTrackingTypes ? `${invalidTrackingTypes} items can be configured later` : "All items configured", ready: invalidTrackingTypes === 0, blocking: false },
    { id: "category-items", label: "Category Assignment", detail: uncategorized ? `${uncategorized} items need a category` : emptyCategories ? `${emptyCategories} empty categories` : "All categories populated", ready: uncategorized === 0, blocking: true },
    { id: "qr", label: "QR Menu Ready", detail: "Customer rendering available", ready: Boolean(restaurant.slug && items.length && state.categories.length && missingPrices === 0 && uncategorized === 0), blocking: false },
    { id: "address", label: "Address (optional)", detail: typeof restaurant.profile.address === "string" && restaurant.profile.address.trim() ? "Added" : "Can be added in Business Settings", ready: Boolean(typeof restaurant.profile.address === "string" && restaurant.profile.address.trim()), blocking: false },
    { id: "website", label: "Website (optional)", detail: typeof social.website === "string" && social.website.trim() ? "Added" : "Can be added later", ready: Boolean(typeof social.website === "string" && social.website.trim()), blocking: false },
  ];
  const readinessIds = new Set(["business", "business-type", "categories", "items", "prices"]);
  const requiredChecks = checks.filter((check) => readinessIds.has(check.id));
  return {
    items,
    checks,
    canPublish: checks.every((check) => !check.blocking || check.ready),
    readiness: requiredChecks.length ? Math.round((requiredChecks.filter((check) => check.ready).length / requiredChecks.length) * 100) : 0,
    summary: { itemCount: items.length, categoryCount: state.categories.length, languageCount: languageCount || 1, missingImages, missingPrices, missingDescriptions, hiddenItems },
  };
}
