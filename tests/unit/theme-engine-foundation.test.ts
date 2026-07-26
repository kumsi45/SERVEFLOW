import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ThemeProvider } from "../../src/modules/menu/theme-engine/ThemeProvider";
import { ThemeRenderer } from "../../src/modules/menu/theme-engine/ThemeRenderer";
import { themeRegistry } from "../../src/modules/menu/theme-engine/ThemeRegistry";
import { publishMenuThemeSelection } from "../../src/modules/menu/theme-engine/themeEvents";
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

  it("renders production luxury and placeholder-only premium grid and coffee themes", () => {
    expect(renderTheme("luxury")).toContain("premium-luxury-shell");
    expect(renderTheme("luxury")).toContain("Existing QR Menu");
    expect(renderTheme("luxury")).not.toContain("Coming Soon");
    expect(renderTheme("premium_grid")).toContain("Premium Card Grid");
    expect(renderTheme("coffee")).toContain("Coffee Shop");
    for (const theme of ["premium_grid", "coffee"]) expect(renderTheme(theme)).toContain("Coming Soon");
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
