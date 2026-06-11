import type { MenuCategory, MenuGroup, MenuItem } from "../types";

export function groupMenuItemsByCategory(
  categories: MenuCategory[],
  items: MenuItem[]
): MenuGroup[] {
  return categories
    .map((category) => ({
      category,
      items: items.filter((item) => item.category_id === category.id),
    }))
    .filter((group) => group.items.length > 0);
}

export function filterMenuItems(items: MenuItem[], searchTerm: string, categoryId: string) {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  return items.filter((item) => {
    const matchesCategory = categoryId === "all" || item.category_id === categoryId;
    const matchesSearch =
      normalizedSearch.length === 0 || item.name.toLowerCase().includes(normalizedSearch);

    return matchesCategory && matchesSearch;
  });
}
