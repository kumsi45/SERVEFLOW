import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/modules/menu/theme-engine/ThemeProvider";
import { ThemeRenderer } from "../../src/modules/menu/theme-engine/ThemeRenderer";
import { themeRegistry } from "../../src/modules/menu/theme-engine/ThemeRegistry";
import { ModernFoodView } from "../../src/modules/menu/theme-engine/themes/modern/ModernFoodView";
import type { MenuCategory, MenuItem, Restaurant } from "../../src/modules/qr-menu/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const luxuryView = read("src/modules/menu/theme-engine/themes/luxury/PremiumLuxuryView.tsx");
const luxuryCard = read("src/modules/menu/theme-engine/themes/luxury/PremiumLuxuryCard.tsx");
const luxuryCss = read("src/modules/menu/theme-engine/themes/luxury/premiumLuxury.css");
const modernView = read("src/modules/menu/theme-engine/themes/modern/ModernFoodView.tsx");
const qrPage = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const ownerPage = read("src/modules/owner/pages/OwnerDashboardPage.tsx");

const restaurant: Restaurant = {
  id: "restaurant-1",
  name: "Grand Royal",
  slug: "grand-royal",
  menu_theme: "luxury",
  logo_url: "https://images.example/grand-royal-logo.png",
  cover_url: "https://images.example/grand-royal-cover.jpg",
};

const category: MenuCategory = { id: "mains", restaurant_id: restaurant.id, name: "Main Course" };
const item: MenuItem = {
  id: "dish-1",
  restaurant_id: restaurant.id,
  category_id: category.id,
  name: "Grilled Sea Bass",
  description: "Seasonal vegetables and herb butter",
  ingredients: ["sea bass", "herbs"],
  allergens: ["fish"],
  calories: 420,
  protein_g: 38,
  preparation_time_minutes: 20,
  price: 790,
  image_url: "https://images.example/sea-bass.jpg",
  available: true,
};

function renderLuxury() {
  const view = createElement(ModernFoodView, {
    restaurant,
    tableNumber: "3",
    categories: [category],
    groups: [{ category, items: [item] }],
    activeCategoryId: "all",
    searchTerm: "",
    cartItemCount: 1,
    cartSubtotal: 790,
    hasActiveOrder: true,
    onSearchChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onAddToCart: vi.fn(),
    onOpenInfo: vi.fn(),
    onOpenCart: vi.fn(),
    onOpenOrders: vi.fn(),
  });

  return renderToStaticMarkup(createElement(
    ThemeProvider,
    { restaurant },
    createElement(ThemeRenderer, {
      restaurant,
      categories: [category],
      menu: [item],
      cart: { items: [], itemCount: 1, subtotal: 790, visible: false },
      order: { activeSession: null, submittedOrder: null },
      theme: "luxury",
    }, view),
  ));
}

describe("Phase 9.3 Premium Luxury rendering", () => {
  it("renders live restaurant and menu data through the Theme Engine", () => {
    const html = renderLuxury();
    expect(html).toContain("premium-luxury-shell");
    expect(html).toContain("premium-luxury-view");
    expect(html).toContain("Grand Royal");
    expect(html).toContain("Grilled Sea Bass");
    expect(html).toContain("Main Course");
    expect(html).toContain("Table 3");
    expect(html).not.toMatch(/lorem ipsum|demo dish/i);
  });

  it("renders luxury cards with accessible existing cart and info callbacks", () => {
    const html = renderLuxury();
    expect(html).toContain("Add Grilled Sea Bass to cart");
    expect(html).toContain("Open food information for Grilled Sea Bass");
    expect(html).toContain('loading="eager"');
    expect(luxuryCard).toContain("memo(function PremiumLuxuryCard");
    expect(luxuryView).toContain("onAddToCart={onAddToCart}");
    expect(luxuryView).toContain("onOpenInfo={onOpenInfo}");
    expect(luxuryView).toContain("onOpenCart");
  });

  it("registers Premium Luxury with black, gold, serif identity", () => {
    const definition = themeRegistry.luxury;
    expect(definition.name).toBe("Premium Luxury");
    expect(definition.primaryColor).toBe("#0b0b0a");
    expect(definition.secondaryColor).toBe("#d7b56d");
    expect(definition.typography).toMatch(/Georgia|serif/);
    expect(ownerPage).not.toContain("<ThemeCustomizationStudio");
  });

  it("leaves Modern output on its original presentation branch", () => {
    expect(modernView).toContain('if (theme === "luxury") return <PremiumLuxuryView {...themedProps} />');
    const directModern = renderToStaticMarkup(createElement(ModernFoodView, {
      restaurant: { ...restaurant, menu_theme: "modern" },
      categories: [category],
      groups: [{ category, items: [item] }],
      activeCategoryId: "all",
      searchTerm: "",
      cartItemCount: 0,
      cartSubtotal: 0,
      hasActiveOrder: false,
      onSearchChange: vi.fn(), onCategoryChange: vi.fn(), onAddToCart: vi.fn(), onOpenInfo: vi.fn(), onOpenCart: vi.fn(), onOpenOrders: vi.fn(),
    }));
    expect(directModern).toContain("modern-food-theme");
    expect(directModern).not.toContain("premium-luxury-view");
  });
});

describe("Phase 9.3 presentation and architecture boundaries", () => {
  it("restyles the professional Orders page without replacing its workflow", () => {
    expect(luxuryCss).toContain("Phase 9.2.2 Orders workflow retained");
    expect(luxuryCss).toContain(".premium-luxury-shell .modern-active-order-card .public-order-tracker");
    expect(luxuryCss).toContain(".premium-luxury-shell .modern-previous-orders");
    expect(qrPage).toContain("<ModernOrdersView");
    expect(qrPage).toContain("CanonicalLifecycleStatus");
  });

  it("supports responsive, accessible, reduced-motion presentation", () => {
    expect(luxuryCss).toContain("min-height: 44px");
    expect(luxuryCss).toContain(":focus-visible");
    expect(luxuryCss).toContain("@media (min-width: 600px)");
    expect(luxuryCss).toContain("@media (min-width: 1024px)");
    expect(luxuryCss).toContain("@media (max-width: 374px)");
    expect(luxuryCss).toContain("prefers-reduced-motion: reduce");
  });

  it("reuses food detail, checkout, navigation, and QR engines", () => {
    expect(luxuryCss).toContain(".food-info-panel");
    expect(luxuryCss).toContain(".public-checkout-panel");
    expect(luxuryView).toContain("ModernBottomNavigation");
    for (const boundary of ["usePublicQrCart", "submitPublicQrOrder", "subscribeCustomerTrackingEvents", "FoodInfoPanel"])
      expect(qrPage).toContain(boundary);
    expect(`${luxuryView}\n${luxuryCard}`).not.toMatch(/supabase|fetch\(|submitPublicQrOrder|subscribe|paymentMethod|inventory/i);
  });

  it("creates no Phase 9.3 migration", () => {
    const migrations = readdirSync(resolve(process.cwd(), "supabase/migrations"));
    expect(migrations.some((name) => /phase9_3|premium_luxury/i.test(name))).toBe(false);
  });
});
