import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModernFoodView } from "../../src/modules/menu/theme-engine/themes/modern/ModernFoodView";
import { FoodInfoPanel } from "../../src/modules/qr-menu/components/FoodInfoPanel";
import { filterMenuItems, groupMenuItemsByCategory } from "../../src/modules/qr-menu/services/menuGrouping";
import type { MenuCategory, MenuItem, Restaurant } from "../../src/modules/qr-menu/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const modernViewSource = read("src/modules/menu/theme-engine/themes/modern/ModernFoodView.tsx");
const modernCardSource = read("src/modules/menu/theme-engine/themes/modern/ModernFoodCard.tsx");
const modernCss = read("src/modules/menu/theme-engine/themes/modern/modernFood.css");
const qrPage = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const routerSource = read("src/app/router/AppRouter.tsx");

const restaurant: Restaurant = {
  id: "restaurant-1",
  name: "Sunrise Kitchen",
  slug: "sunrise-kitchen",
  logo_url: "https://images.example/logo.png",
  cover_url: "https://images.example/cover.jpg",
  menu_theme: "modern",
};

const categories: MenuCategory[] = [
  { id: "meals", restaurant_id: restaurant.id, name: "Meals", hero_image_url: "https://images.example/meals.jpg" },
  { id: "drinks", restaurant_id: restaurant.id, name: "Drinks" },
];

const items: MenuItem[] = [
  {
    id: "item-1",
    restaurant_id: restaurant.id,
    category_id: "meals",
    name: "Prawn Ceviche",
    description: "Prawns, citrus and herbs",
    ingredients: ["prawns", "lime"],
    allergens: ["shellfish"],
    preparation_time_minutes: 12,
    price: 15.5,
    image_url: "https://images.example/ceviche.jpg",
    available: true,
  },
  {
    id: "item-2",
    restaurant_id: restaurant.id,
    category_id: "drinks",
    name: "Fresh Lime",
    price: 4,
    available: true,
  },
];

function renderModern(searchTerm = "", activeCategoryId = "all") {
  const filtered = filterMenuItems(items, searchTerm, activeCategoryId);
  return renderToStaticMarkup(createElement(ModernFoodView, {
    restaurant,
    tableNumber: "4",
    categories,
    groups: groupMenuItemsByCategory(categories, filtered),
    activeCategoryId,
    searchTerm,
    cartItemCount: 2,
    cartSubtotal: 31,
    hasActiveOrder: true,
    onSearchChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onAddToCart: vi.fn(),
    onOpenInfo: vi.fn(),
    onOpenCart: vi.fn(),
    onOpenOrders: vi.fn(),
  }));
}

describe("Phase 9.2 Modern Food rendering", () => {
  it("renders live restaurant branding and menu data without demo content", () => {
    const html = renderModern();
    expect(html).toContain("Sunrise Kitchen");
    expect(html).toContain("Table 4");
    expect(html).toContain("Prawn Ceviche");
    expect(html).toContain("Fresh Lime");
    expect(html).toContain("https://images.example/logo.png");
    expect(html).toContain("https://images.example/cover.jpg");
    expect(html).not.toMatch(/demo food|lorem ipsum/i);
  });

  it("keeps search and category filtering in the existing menu service", () => {
    expect(filterMenuItems(items, "prawn", "all").map((item) => item.id)).toEqual(["item-1"]);
    expect(filterMenuItems(items, "", "drinks").map((item) => item.id)).toEqual(["item-2"]);
    expect(renderModern("prawn")).toContain('value="prawn"');
    expect(renderModern("", "drinks")).not.toContain("Prawn Ceviche");
  });

  it("renders retina-friendly lazy images, accessible actions, and the two-tab navigation", () => {
    const html = renderModern();
    expect(html).toContain('decoding="async"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("Add Prawn Ceviche to cart");
    expect(html).toContain("Open food information for Prawn Ceviche");
    expect(html).toContain(">Home<");
    expect(html).toContain(">Orders<");
    expect(modernCardSource).toContain("memo(function ModernFoodCard");
  });

  it("shows clean information placeholders without inventing missing values", () => {
    const html = renderToStaticMarkup(createElement(FoodInfoPanel, {
      item: items[1],
      onClose: vi.fn(),
      onAddToCart: vi.fn(),
    }));
    expect(html).toContain("Description not provided.");
    expect(html).toContain("Ingredients not provided.");
    expect(html).toContain("Nutrition information not provided.");
    expect(html).toContain("Allergen information not provided.");
    expect(html).toContain("Preparation time not provided.");
  });
});

describe("Phase 9.2 integration and responsive boundaries", () => {
  it("wires presentation events to the existing QR state and cart callbacks", () => {
    expect(qrPage).toContain("onSearchChange={setSearchTerm}");
    expect(qrPage).toContain("onCategoryChange={setActiveCategoryId}");
    expect(qrPage).toContain("onAddToCart={addItemToCart}");
    expect(qrPage).toContain("onOpenInfo={setFoodInfoItem}");
    expect(qrPage).toContain("<PublicQrCheckoutPanel");
    expect(qrPage).toContain("<PublicQrCartPanel");
  });

  it("renders through the theme engine and preserves QR route compatibility", () => {
    expect(qrPage).toContain("<ThemeRenderer");
    expect(qrPage).toContain("<ModernFoodView");
    expect(routerSource).toContain('const menuPath = `/r/${encodeURIComponent(route.restaurantSlug)}${window.location.search}`');
    expect(routerSource).toContain("return <QRMenuPage restaurantSlug={route.restaurantSlug} />");
  });

  it("supports target mobile sizes, tablet, desktop, touch targets, and reduced motion", () => {
    expect(modernCss).toContain("grid-template-columns: repeat(2");
    expect(modernCss).toContain("min-height: 44px");
    expect(modernCss).toContain("@media (max-width: 375px)");
    expect(modernCss).toContain("@media (max-width: 359px)");
    expect(modernCss).toContain("@media (min-width: 600px)");
    expect(modernCss).toContain("@media (min-width: 960px)");
    expect(modernCss).toContain("prefers-reduced-motion: reduce");
    expect(modernViewSource).not.toContain("submitPublicQrOrder");
    expect(modernCss).toContain("scroll-snap-type: x mandatory");
  });

  it("contains no duplicated ordering, payment, realtime, or persistence engine", () => {
    const presentation = `${modernViewSource}\n${modernCardSource}`;
    expect(presentation).not.toMatch(/supabase|submitPublicQrOrder|subscribe|paymentMethod|localStorage|fetch\(/);
  });
});
