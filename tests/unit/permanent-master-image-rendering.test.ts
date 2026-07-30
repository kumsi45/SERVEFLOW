import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveMenuItemImage } from "../../src/core/presentation/menuItemImage";

const renderers = [
  "src/modules/setup-wizard/components/OwnerMenuItemCard.tsx",
  "src/modules/setup-wizard/components/AiMenuReviewItemCard.tsx",
  "src/modules/qr-menu/components/MenuItemCard.tsx",
  "src/modules/qr-menu/components/FeaturedDishes.tsx",
  "src/modules/qr-menu/components/FoodInfoPanel.tsx",
  "src/modules/menu/theme-engine/themes/modern/ModernFoodCard.tsx",
  "src/modules/menu/theme-engine/themes/luxury/PremiumLuxuryCard.tsx",
  "src/modules/menu/theme-engine/themes/premium-grid/PremiumGridCard.tsx",
  "src/modules/menu/theme-engine/themes/coffee/CoffeeThemeCard.tsx",
];

describe("Phase 9.13.3.2 permanent master image rendering guarantee", () => {
  it("is metadata-driven for arbitrary current and future categories", () => {
    for (const category of ["Breakfast", "Hotel", "Future Category 2040"]) {
      const master = { source: "MASTER", status: "APPROVED", url: `https://cdn/${category}/item.webp`, version: 99 } as const;
      expect(resolveMenuItemImage({ itemId: `${category}-item`, master, placeholderUrl: "placeholder.webp" })).toMatchObject({ source: "MASTER", url: master.url });
    }
  });

  it("enforces CUSTOM then MASTER then PLACEHOLDER centrally", () => {
    const master = { source: "MASTER", status: "APPROVED", url: "master.webp", version: 2 } as const;
    const custom = { source: "CUSTOM", status: "APPROVED", url: "custom.webp", version: 1 } as const;
    expect(resolveMenuItemImage({ itemId: "1", custom, master, placeholderUrl: "placeholder.webp" }).source).toBe("CUSTOM");
    expect(resolveMenuItemImage({ itemId: "1", master, placeholderUrl: "placeholder.webp" }).source).toBe("MASTER");
    expect(resolveMenuItemImage({ itemId: "1", placeholderUrl: "placeholder.webp" }).source).toBe("PLACEHOLDER");
  });

  it("keeps pending masters owner-only and reports an unresolvable generated master", () => {
    const pending = { source: "MASTER", status: "PENDING_REVIEW", url: "pending.webp", version: 1 } as const;
    expect(resolveMenuItemImage({ itemId: "1", master: pending, placeholderUrl: "placeholder.webp" }).source).toBe("PLACEHOLDER");
    expect(resolveMenuItemImage({ itemId: "1", master: pending, placeholderUrl: "placeholder.webp" }, "owner-review").source).toBe("MASTER");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveMenuItemImage({ itemId: "broken", master: { ...pending, url: null }, placeholderUrl: "placeholder.webp" }, "owner-review");
    expect(error).toHaveBeenCalledWith("Missing image resolution", { itemId: "broken" });
    error.mockRestore();
  });

  it("requires every current menu renderer to call the canonical resolver", () => {
    for (const file of renderers) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).toContain("resolveSmartImage");
      expect(source, file).toContain("SmartImage");
      expect(source, file).not.toMatch(/effective_image_url\s*\|\|\s*item\.image_url/);
    }
  });

  it("keeps the resolver implementation unique", () => {
    const compatibility = readFileSync(resolve(process.cwd(), "src/modules/setup-wizard/services/smartImageLibrary.ts"), "utf8");
    expect(compatibility).not.toContain("function resolveSmartImage");
    expect(compatibility).not.toContain("function restoreDefaultImage");
  });
});
