import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ManagerRecipeIngredientSection,
  selectIngredientInventoryItem,
  type IngredientFormState,
} from "../../src/modules/manager/pages/ManagerRecipeWorkspacePage";
import type { IngredientInventoryItem, RecipeIngredientDraft } from "../../src/modules/recipes/types";

const units = [
  { id: "unit-g", name: "g", description: null },
  { id: "unit-ml", name: "ml", description: null },
  { id: "unit-pc", name: "pc", description: null },
];
const inventory: IngredientInventoryItem[] = [
  { id: "item-oil", name: "Cooking Oil", unit_id: "unit-ml", current_quantity: 12, minimum_stock: 2, stock_status: "in_stock" },
  { id: "item-mango", name: "Mango", unit_id: "unit-g", current_quantity: 8, minimum_stock: 1, stock_status: "in_stock" },
];
const names = new Map(inventory.map((item) => [item.id, item.name]));

type SectionProps = ComponentProps<typeof ManagerRecipeIngredientSection>;

function props(overrides: Partial<SectionProps> = {}): SectionProps {
  return {
    ingredients: [] as RecipeIngredientDraft[], loading: false, saving: false, form: null,
    results: [] as IngredientInventoryItem[], searching: false, searchError: null, units,
    itemName: (entry: RecipeIngredientDraft) => names.get(entry.inventoryItemId) ?? "Inventory item",
    unitName: (entry: RecipeIngredientDraft) => units.find((unit) => unit.id === entry.unitId)?.name ?? "unit",
    linkStatus: () => "Linked", onStartAdd: vi.fn(), onStartEdit: vi.fn(), onRemove: vi.fn(),
    onCloseForm: vi.fn(), onSearch: vi.fn(), onSelectItem: vi.fn(), onQuantity: vi.fn(),
    onUnit: vi.fn(), onApply: vi.fn(), onRetry: vi.fn(), ...overrides,
  };
}

function occurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}

describe("real Manager recipe ingredient component", () => {
  it("always renders the setup section with exactly one Add Ingredient action", () => {
    const html = renderToStaticMarkup(<ManagerRecipeIngredientSection {...props()} />);
    expect(html).toContain("Expected consumption per serving");
    expect(html).toContain("No ingredients added yet.");
    expect(html).toContain("Add ingredients to define expected inventory consumption for one serving.");
    expect(occurrences(html, "+ Add Ingredient")).toBe(1);
  });

  it("renders all canonical edit rows with quantity, unit, status, and actions", () => {
    const ingredients: RecipeIngredientDraft[] = [
      { id: "one", inventoryItemId: "item-oil", quantityRequired: "20", unitId: "unit-ml", optionalNotes: "", sortOrder: 100 },
      { id: "two", inventoryItemId: "item-mango", quantityRequired: "150", unitId: "unit-g", optionalNotes: "", sortOrder: 200 },
      { id: "three", inventoryItemId: "item-bun", quantityRequired: "1", unitId: "unit-pc", optionalNotes: "", sortOrder: 300 },
    ];
    const html = renderToStaticMarkup(<ManagerRecipeIngredientSection {...props({ ingredients, itemName: (entry: RecipeIngredientDraft) => entry.inventoryItemId === "item-bun" ? "Burger Bun" : names.get(entry.inventoryItemId) ?? "Item" })} />);
    for (const value of ["Cooking Oil", "Mango", "Burger Bun", "20", "150", "ml", "g", "pc", "Linked", "Edit", "Remove"]) expect(html).toContain(value);
    expect(occurrences(html, "+ Add Ingredient")).toBe(1);
  });

  it("renders matching inventory results as selectable canonical ids", () => {
    const form: IngredientFormState = { index: null, search: " oil ", draft: { inventoryItemId: "", quantityRequired: "", unitId: "", optionalNotes: "", sortOrder: 100 } };
    const html = renderToStaticMarkup(<ManagerRecipeIngredientSection {...props({ form, results: [inventory[0]] })} />);
    expect(html).toContain("Cooking Oil");
    expect(html).toContain('data-inventory-item-id="item-oil"');
    expect(html).toContain("Available: 12 ml");
    expect(html).not.toContain("Select item");
    expect(occurrences(html, "Add Ingredient")).toBe(1);
  });

  it("binds selection to inventory id and preserves the selected item visibly", () => {
    const initial: IngredientFormState = { index: null, search: "oil", draft: { inventoryItemId: "", quantityRequired: "", unitId: "", optionalNotes: "", sortOrder: 100 } };
    const selected = selectIngredientInventoryItem(initial, inventory[0]);
    expect(selected.draft.inventoryItemId).toBe("item-oil");
    expect(selected.draft.unitId).toBe("unit-ml");
    expect(selected.search).toBe("");
    const html = renderToStaticMarkup(<ManagerRecipeIngredientSection {...props({ form: selected })} />);
    expect(html).toContain('data-selected-inventory-item-id="item-oil"');
    expect(html).toContain("Selected inventory item");
    expect(html).toContain("Cooking Oil");
  });

  it("renders loading, no-query, no-results, and retry states", () => {
    const emptyForm: IngredientFormState = { index: null, search: "", draft: { inventoryItemId: "", quantityRequired: "", unitId: "", optionalNotes: "", sortOrder: 100 } };
    expect(renderToStaticMarkup(<ManagerRecipeIngredientSection {...props({ loading: true })} />)).toContain("Loading ingredients...");
    expect(renderToStaticMarkup(<ManagerRecipeIngredientSection {...props({ form: emptyForm })} />)).toContain("Search this restaurant&#x27;s inventory.");
    expect(renderToStaticMarkup(<ManagerRecipeIngredientSection {...props({ form: { ...emptyForm, search: "missing" } })} />)).toContain("No matching inventory items found.");
    const errorHtml = renderToStaticMarkup(<ManagerRecipeIngredientSection {...props({ form: { ...emptyForm, search: "oil" }, searchError: "Unable to load inventory. Retry." })} />);
    expect(errorHtml).toContain("Unable to load inventory. Retry.");
    expect(errorHtml).toContain("Retry");
  });
});
