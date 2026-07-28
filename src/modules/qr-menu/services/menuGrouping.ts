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
  const normalizedSearch = normalizeSearchText(searchTerm);

  return items.filter((item) => {
    const matchesCategory = categoryId === "all" || item.category_id === categoryId;
    const searchableText = normalizeSearchText([
      item.name,
      item.description,
      ...(item.ingredients ?? []),
      ...(item.dietary_tags ?? []),
    ].filter(Boolean).join(" "));
    const matchesSearch =
      normalizedSearch.length === 0 ||
      searchableText.includes(normalizedSearch) ||
      normalizedSearch.split(" ").every((queryWord) =>
        searchableText.split(" ").some((candidate) =>
          candidate.includes(queryWord) || isSingleEditAway(candidate, queryWord)
        )
      );

    return matchesCategory && matchesSearch;
  });
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isSingleEditAway(candidate: string, query: string) {
  if (query.length < 4 || Math.abs(candidate.length - query.length) > 1) return false;
  if (candidate === query) return true;
  if (candidate.length === query.length) {
    for (let index = 0; index < candidate.length - 1; index += 1) {
      if (
        candidate[index] === query[index + 1] &&
        candidate[index + 1] === query[index] &&
        candidate.slice(0, index) === query.slice(0, index) &&
        candidate.slice(index + 2) === query.slice(index + 2)
      ) return true;
    }
  }

  let candidateIndex = 0;
  let queryIndex = 0;
  let edits = 0;
  while (candidateIndex < candidate.length && queryIndex < query.length) {
    if (candidate[candidateIndex] === query[queryIndex]) {
      candidateIndex += 1;
      queryIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (candidate.length > query.length) candidateIndex += 1;
    else if (query.length > candidate.length) queryIndex += 1;
    else {
      candidateIndex += 1;
      queryIndex += 1;
    }
  }

  return edits + Number(candidateIndex < candidate.length || queryIndex < query.length) <= 1;
}
