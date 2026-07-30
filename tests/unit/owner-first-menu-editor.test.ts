import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const studio = read("src/modules/setup-wizard/components/AiMenuReviewStudio.tsx");
const card = read("src/modules/setup-wizard/components/OwnerMenuItemCard.tsx");
const wizard = read("src/modules/setup-wizard/pages/RestaurantSetupWizardPage.tsx");
const css = read("src/modules/setup-wizard/pages/restaurantSetupWizard.css");
const ownerBranch = studio.slice(
  studio.indexOf('if (smartLibraryOnly && mode === "review"'),
  studio.indexOf("\n  return (", studio.indexOf('if (smartLibraryOnly && mode === "review"')),
);

describe("Phase 9.12.3 owner-first menu editor", () => {
  it("uses the approved onboarding title and simple summary", () => {
    expect(wizard).toContain('title: "Edit Your Digital Menu"');
    expect(wizard).toContain("Review your menu before publishing. Change prices, photos, descriptions and categories anytime.");
    for (const label of ["Menu Items", "Categories", "Need Prices", "Ready"]) {
      expect(ownerBranch).toContain(label);
    }
  });

  it("shows only owner-facing search and filters", () => {
    expect(ownerBranch).toContain('placeholder="Search menu..."');
    expect(ownerBranch).toContain('{ id: "all", label: "All" }');
    expect(ownerBranch).toContain('{ id: "missing-price", label: "Missing Price" }');
    expect(ownerBranch).toContain('{ id: "hidden", label: "Hidden" }');
    expect(ownerBranch).not.toMatch(/Needs Review|Low Confidence|Unrecognized|Detected|Source preserved/i);
  });

  it("limits item editing to name, description, category, ETB price and photo", () => {
    for (const label of ["Food Name", "Category", "Description", "Price", "Change Photo", "Remove Photo"]) {
      expect(card).toContain(label);
    }
    expect(card).toContain('maxLength={160}');
    expect(card).toContain("This appears under the menu item.");
    expect(card).toContain("Needs Price");
    expect(card).not.toMatch(/confidence|language|translation|inventory|nutrition|notes|source|approve/i);
  });

  it("relies on autosave and provides only Remove on each card", () => {
    expect(card).toContain(">Remove</button>");
    expect(card).not.toMatch(/>Save<|>Delete<|>Duplicate<|Hide from|Generate|Restore|Approve/);
    expect(ownerBranch).toContain('"✓ Saved"');
    expect(ownerBranch).toContain('"Saving..."');
  });

  it("keeps only update price, move category and remove bulk actions", () => {
    expect(ownerBranch).toContain("Update Prices");
    expect(ownerBranch).toContain("Move Category");
    expect(ownerBranch).toContain("Remove Selected");
    expect(ownerBranch).toContain("+ Add Menu Item");
    expect(ownerBranch).not.toMatch(/Bulk Restore|Bulk Move|Bulk Approve|Generate Missing/);
  });

  it("uses a collapsed one-category accordion and quick price editor", () => {
    expect(studio).toContain("expandedOwnerCategoryId");
    expect(ownerBranch).toContain('aria-expanded={expanded}');
    expect(ownerBranch).toContain("setExpandedOwnerCategoryId(expanded ? null : category.id)");
    expect(ownerBranch).toContain("Quick Price Mode");
    expect(ownerBranch).toContain('role="grid"');
    expect(ownerBranch).toContain('inputMode="decimal"');
  });

  it("confirms removal and keeps the Smart Menu Library unchanged", () => {
    expect(ownerBranch).toContain("Remove Menu Item?");
    expect(ownerBranch).toContain("This removes");
    expect(ownerBranch).toContain("The Smart Menu Library remains unchanged.");
    expect(ownerBranch).toContain(">Cancel</button>");
  });

  it("keeps the action bar sticky and gates Continue only on active prices", () => {
    expect(ownerBranch).toContain("Preview Menu");
    expect(ownerBranch).toContain("disabled={!allActiveHavePrices}");
    expect(css).toContain(".owner-menu-topbar { position: sticky");
  });

  it("is touch-friendly and responsive", () => {
    expect(css).toContain(".owner-menu-photo > :is(img, span)");
    expect(css).toContain("width: 160px; height: 160px");
    expect(css).toContain("width: 180px; height: 180px");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain(".owner-menu-editor :is(input, select, textarea, button):focus-visible");
  });
});

describe("Phase 9.12.3.2 owner editing workflow", () => {
  it("provides a complete add item dialog with inline category creation", () => {
    for (const label of ["Add New Menu Item", "Category *", "+ Create New Category", "Category Name *", "Display Order", "Food Name *", "Price", "Description", "Image", "Create Item"]) {
      expect(ownerBranch).toContain(label);
    }
    expect(studio).toContain("createOwnerCategory");
    expect(studio).toContain("setAddItemCategoryId(id)");
  });

  it("creates a complete draft item with placeholder image and autosave state", () => {
    expect(studio).toContain("createSafeMenuDescription(name)");
    expect(studio).toContain("SERVEFLOW_MENU_PLACEHOLDER_IMAGE");
    expect(studio).toContain("changeActive((current)");
    expect(studio).toContain("scrollIntoView");
    expect(studio).toContain("setHighlightedItemId(id)");
    expect(card).toContain("newly-created");
  });

  it("uses a responsive floating selection toolbar and completed bulk dialogs", () => {
    expect(ownerBranch).toContain('className="owner-selection-toolbar"');
    expect(ownerBranch).toContain("Move Selected Items");
    expect(ownerBranch).toContain("Choose destination category");
    expect(ownerBranch).toContain("Remove selected menu items?");
    expect(ownerBranch).toContain("Items are removed only from this restaurant draft.");
    expect(css).toContain(".owner-selection-toolbar { position: fixed");
    expect(css).toContain("border-radius: 18px 18px 0 0");
  });

  it("traps dialog focus and supports Escape", () => {
    expect(studio).toContain("trapDialogFocus");
    expect(studio).toContain('event.key === "Escape"');
    expect(studio).toContain('event.key !== "Tab"');
    expect(ownerBranch).toContain('aria-modal="true"');
  });
});
