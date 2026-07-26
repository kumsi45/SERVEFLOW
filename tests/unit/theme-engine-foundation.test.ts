import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ThemeProvider } from "../../src/modules/menu/theme-engine/ThemeProvider";
import { ThemeRenderer } from "../../src/modules/menu/theme-engine/ThemeRenderer";
import { themeRegistry } from "../../src/modules/menu/theme-engine/ThemeRegistry";
import { publishMenuThemeSelection } from "../../src/modules/menu/theme-engine/themeEvents";
import { ModernFoodView } from "../../src/modules/menu/theme-engine/themes/modern/ModernFoodView";
import {
  MENU_THEMES,
  isMenuTheme,
  resolveMenuTheme,
  type MenuTheme,
  type ThemeRendererProps,
} from "../../src/modules/menu/theme-engine/ThemeTypes";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/185_phase9_1_menu_theme_engine_foundation.sql");
const providerSource = read("src/modules/menu/theme-engine/ThemeProvider.tsx");
const rendererSource = read("src/modules/menu/theme-engine/ThemeRenderer.tsx");
const qrPage = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const ownerPage = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const premiumGridView = read("src/modules/menu/theme-engine/themes/premium-grid/PremiumGridView.tsx");
const premiumGridCard = read("src/modules/menu/theme-engine/themes/premium-grid/PremiumGridCard.tsx");
const premiumGridCss = read("src/modules/menu/theme-engine/themes/premium-grid/premiumGrid.css");

const restaurant = {
  id: "restaurant-1",
  name: "ServeFlow Test",
  slug: "serveflow-test",
  menu_theme: "modern" as MenuTheme,
};

const rendererProps: Omit<ThemeRendererProps, "theme" | "children"> = {
  restaurant,
  categories: [],
  menu: [],
  cart: { items: [], itemCount: 0, subtotal: 0, visible: false },
  order: { activeSession: null, submittedOrder: null },
};

function renderTheme(theme: unknown, child = createElement("div", { id: "existing-menu" }, "Existing QR Menu")) {
  const selected = theme as MenuTheme;
  return renderToStaticMarkup(createElement(
    ThemeProvider,
    { restaurant: { ...restaurant, menu_theme: selected } },
    createElement(ThemeRenderer, { ...rendererProps, theme: resolveMenuTheme(theme) }, child),
  ));
}

afterEach(() => vi.unstubAllGlobals());

describe("Phase 9.1 theme registry", () => {
  it("registers exactly the four foundation themes", () => {
    expect(MENU_THEMES).toEqual(["modern", "luxury", "premium_grid", "coffee"]);
    expect(Object.keys(themeRegistry)).toEqual(MENU_THEMES);
    expect(Object.isFrozen(themeRegistry)).toBe(true);
  });

  it("provides every required definition property", () => {
    for (const theme of MENU_THEMES) {
      const definition = themeRegistry[theme];
      expect(definition.id).toBe(theme);
      for (const field of [
        "name", "preview", "component", "primaryColor", "secondaryColor",
        "background", "cardStyle", "typography", "borderRadius", "spacing", "animationPreset",
      ]) expect(definition[field as keyof typeof definition]).toBeTruthy();
    }
  });

  it("falls back invalid, missing, and future values to modern", () => {
    expect(isMenuTheme("coffee")).toBe(true);
    expect(isMenuTheme("hotel")).toBe(false);
    expect(resolveMenuTheme(undefined)).toBe("modern");
    expect(resolveMenuTheme("invalid")).toBe("modern");
    expect(resolveMenuTheme("luxury")).toBe("luxury");
  });
});

describe("Phase 9.1 provider and renderer", () => {
  it("renders the existing modern menu content without adding DOM wrappers", () => {
    expect(renderTheme("modern")).toBe('<div id="existing-menu">Existing QR Menu</div>');
  });

  it("renders fallback modern content for an invalid restaurant theme", () => {
    expect(renderTheme("not-a-theme")).toContain("Existing QR Menu");
    expect(renderTheme("not-a-theme")).not.toContain("Coming Soon");
  });

  it("renders production luxury and premium grid themes with only coffee remaining a placeholder", () => {
    expect(renderTheme("luxury")).toContain("premium-luxury-shell");
    expect(renderTheme("luxury")).toContain("Existing QR Menu");
    expect(renderTheme("luxury")).not.toContain("Coming Soon");
    expect(renderTheme("premium_grid")).toContain("premium-grid-shell");
    expect(renderTheme("premium_grid")).toContain("Existing QR Menu");
    expect(renderTheme("premium_grid")).not.toContain("Coming Soon");
    expect(renderTheme("coffee")).toContain("Coffee Shop");
    expect(renderTheme("coffee")).toContain("Coming Soon");
  });

  it("reacts to restaurant changes and cross-tab theme events with cleanup", () => {
    expect(providerSource).toContain("resolveMenuTheme(restaurant.menu_theme)");
    expect(providerSource).toContain("setThemeState(resolveMenuTheme(restaurant.menu_theme))");
    expect(providerSource).toContain('window.addEventListener(MENU_THEME_CHANGED_EVENT');
    expect(providerSource).toContain('window.addEventListener("storage"');
    expect(providerSource).toContain('window.removeEventListener(MENU_THEME_CHANGED_EVENT');
    expect(rendererSource).toContain("definition.component");
  });

  it("publishes and persists a validated live theme selection", () => {
    const setItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem }, dispatchEvent });
    vi.stubGlobal("CustomEvent", class {
      type: string;
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) { this.type = type; this.detail = init.detail; }
    });
    publishMenuThemeSelection("restaurant-1", "coffee");
    expect(setItem).toHaveBeenCalledWith("serveflow.menu-theme:restaurant-1", "coffee");
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
});

describe("Phase 9.1 database and integration boundaries", () => {
  it("adds one constrained setting with modern as the default", () => {
    expect(migration).toContain("add column if not exists menu_theme text not null default 'modern'");
    expect(migration).toContain("menu_theme in ('modern', 'luxury', 'premium_grid', 'coffee')");
    expect(migration).toContain("'menu_theme', coalesce(restaurants.menu_theme, 'modern')");
    expect(migration).not.toMatch(/create table|create view|create trigger|create policy/i);
    const phaseMigrations = readdirSync(resolve(process.cwd(), "supabase/migrations"))
      .filter((name) => name.includes("phase9_1"));
    expect(phaseMigrations).toEqual(["185_phase9_1_menu_theme_engine_foundation.sql"]);
  });

  it("persists the owner dropdown through the existing restaurant settings save", () => {
    expect(ownerPage).toContain('<div className="od-card-title">Menu Theme</div>');
    expect(ownerPage).toContain('<option value="modern">Modern</option>');
    expect(ownerPage).toContain('<option value="luxury">Premium Luxury</option>');
    expect(ownerPage).toContain('<option value="premium_grid">Premium Grid</option>');
    expect(ownerPage).toContain('<option value="coffee">Coffee</option>');
    expect(ownerPage).toContain("menu_theme: form.menuTheme");
    expect(ownerPage).toContain("publishMenuThemeSelection(restaurantId, form.menuTheme)");
  });

  it("routes only rendering through the engine and preserves QR ordering logic", () => {
    expect(qrPage).toContain("<ThemeProvider restaurant={restaurant}>");
    expect(qrPage).toContain("<ThemeRenderer");
    for (const existingBoundary of [
      "usePublicQrCart", "usePublicQrCheckoutState", "submitPublicQrOrder",
      "PublicQrCheckoutPanel", "PublicQrCartPanel", "subscribeCustomerTrackingEvents",
      "logPublicQrScan", "ModernFoodView", "setSearchTerm", "setActiveCategoryId",
      "addItemToCart",
    ]) expect(qrPage).toContain(existingBoundary);
  });

  it("creates every requested reusable shared component", () => {
    const shared = readdirSync(resolve(process.cwd(), "src/modules/menu/theme-engine/components/shared"));
    for (const file of [
      "MenuHeader.tsx", "CategoryBar.tsx", "MenuCard.tsx", "SearchBar.tsx",
      "RestaurantHero.tsx", "CartButton.tsx", "BottomNavigation.tsx", "FoodBadge.tsx",
      "Price.tsx", "EmptyState.tsx", "LoadingState.tsx",
    ]) expect(shared).toContain(file);
  });
});

describe("Phase 9.4 Premium Grid presentation", () => {
  it("renders live menu data through the production Theme C branch", () => {
    const category = { id: "mains", restaurant_id: "restaurant-1", name: "Mains" };
    const item = {
      id: "dish-1",
      restaurant_id: "restaurant-1",
      category_id: "mains",
      name: "Grilled Prawns",
      description: "Lemon and herbs",
      price: 34,
      image_url: "https://images.example/prawns.jpg",
      available: true,
    };
    const premiumRestaurant = {
      ...restaurant,
      menu_theme: "premium_grid" as const,
      logo_url: "https://images.example/logo.png",
      cover_url: "https://images.example/cover.jpg",
    };
    const view = createElement(ModernFoodView, {
      restaurant: premiumRestaurant,
      tableNumber: "8",
      categories: [category],
      groups: [{ category, items: [item] }],
      activeCategoryId: "all",
      searchTerm: "",
      cartItemCount: 1,
      cartSubtotal: 34,
      hasActiveOrder: true,
      onSearchChange: vi.fn(),
      onCategoryChange: vi.fn(),
      onAddToCart: vi.fn(),
      onOpenInfo: vi.fn(),
      onOpenCart: vi.fn(),
      onOpenOrders: vi.fn(),
    });
    const html = renderToStaticMarkup(createElement(
      ThemeProvider,
      { restaurant: premiumRestaurant },
      createElement(ThemeRenderer, {
        restaurant: premiumRestaurant,
        categories: [category],
        menu: [item],
        cart: { items: [], itemCount: 1, subtotal: 34, visible: false },
        order: { activeSession: null, submittedOrder: null },
        theme: "premium_grid",
      }, view),
    ));

    expect(html).toContain("premium-grid-shell");
    expect(html).toContain("premium-grid-view");
    expect(html).toContain("Grilled Prawns");
    expect(html).toContain("Table 8");
    expect(html).toContain("Add Grilled Prawns to cart");
    expect(html).toContain("Open food information for Grilled Prawns");
    expect(html).toContain(">Home<");
    expect(html).toContain(">Orders<");
    expect(html).not.toContain("Coming Soon");
  });

  it("keeps Theme C responsive, accessible, memoized, and presentation-only", () => {
    expect(themeRegistry.premium_grid.name).toBe("Premium Grid");
    expect(premiumGridCard).toContain("memo(function PremiumGridCard");
    expect(premiumGridView).toContain("useMemo(");
    expect(premiumGridCss).toContain("grid-template-columns: repeat(2");
    expect(premiumGridCss).toContain("grid-template-columns: repeat(3");
    expect(premiumGridCss).toContain("grid-template-columns: repeat(4");
    expect(premiumGridCss).toContain("grid-template-columns: repeat(6");
    expect(premiumGridCss).toContain("min-height: 44px");
    expect(premiumGridCss).toContain(":focus-visible");
    expect(premiumGridCss).toContain("prefers-reduced-motion: reduce");
    expect(premiumGridCss).toContain(".food-info-panel");
    expect(premiumGridCss).toContain(".modern-orders-theme");
    expect(`${premiumGridView}\n${premiumGridCard}`).not.toMatch(
      /supabase|submitPublicQrOrder|subscribe|paymentMethod|localStorage|fetch\(/,
    );
  });
});
