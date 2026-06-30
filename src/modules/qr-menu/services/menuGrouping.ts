import type { MenuCategory, MenuGroup, MenuItem } from "../types";

export function groupMenuItemsByCategory(
  categories: MenuCategory[],
  items: MenuItem[]
): MenuGroup[] {
  const groupedCategoryIds = new Set(categories.map((category) => category.id));
  const categoryGroups = categories
    .map((category) => ({
      category,
      items: items.filter((item) => item.category_id === category.id),
    }))
    .filter((group) => group.items.length > 0);

  const uncategorizedItems = items.filter((item) => !groupedCategoryIds.has(item.category_id));

  if (uncategorizedItems.length === 0) {
    return categoryGroups;
  }

  return [
    ...categoryGroups,
    {
      category: {
        id: "uncategorized",
        restaurant_id: uncategorizedItems[0]?.restaurant_id ?? "",
        name: "Other items",
      },
      items: uncategorizedItems,
    },
  ];
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
