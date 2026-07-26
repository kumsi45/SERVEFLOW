import {
  resolveLocalizedMenuText,
  type MenuLanguage,
} from "../../../core/menu/menuLanguage";
import type { MenuCategory, MenuItem } from "../types";

export function localizeMenuCategory(
  category: MenuCategory,
  language: MenuLanguage,
): MenuCategory {
  return {
    ...category,
    name: resolveLocalizedMenuText(
      category.localizations,
      language,
      "name",
      category.name,
    ),
    description: resolveLocalizedMenuText(
      category.localizations,
      language,
      "description",
      category.description,
    ) || null,
  };
}

export function localizeMenuItem(
  item: MenuItem,
  language: MenuLanguage,
): MenuItem {
  return {
    ...item,
    name: resolveLocalizedMenuText(
      item.localizations,
      language,
      "name",
      item.name,
    ),
    description: resolveLocalizedMenuText(
      item.localizations,
      language,
      "description",
      item.description,
    ) || null,
  };
}

export function localizeMenuPresentation(
  categories: readonly MenuCategory[],
  items: readonly MenuItem[],
  language: MenuLanguage,
) {
  return {
    categories: categories.map((category) =>
      localizeMenuCategory(category, language)
    ),
    items: items.map((item) => localizeMenuItem(item, language)),
  };
}

