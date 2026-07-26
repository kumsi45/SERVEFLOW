import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/modules/menu/theme-engine/ThemeProvider";
import { ThemeRenderer } from "../../src/modules/menu/theme-engine/ThemeRenderer";
import {
  buildThemeCustomizationSurface,
  resolveThemeCustomization,
  type ThemeCustomization,
} from "../../src/modules/menu/theme-engine/customization/themeCustomization";
import { ModernFoodView } from "../../src/modules/menu/theme-engine/themes/modern/ModernFoodView";
import {
  MENU_THEMES,
  type MenuTheme,
} from "../../src/modules/menu/theme-engine/ThemeTypes";
import type {
  MenuCategory,
  MenuItem,
  Restaurant,
} from "../../src/modules/qr-menu/types";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return (
      0.2126 * channels[0] +
      0.7152 * channels[1] +
      0.0722 * channels[2]
    );
  };
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

const themeFiles = {
  modern: {
    view: read("src/modules/menu/theme-engine/themes/modern/ModernFoodView.tsx"),
    card: read("src/modules/menu/theme-engine/themes/modern/ModernFoodCard.tsx"),
    css: read("src/modules/menu/theme-engine/themes/modern/modernFood.css"),
  },
  luxury: {
    view: read("src/modules/menu/theme-engine/themes/luxury/PremiumLuxuryView.tsx"),
    card: read("src/modules/menu/theme-engine/themes/luxury/PremiumLuxuryCard.tsx"),
    css: read("src/modules/menu/theme-engine/themes/luxury/premiumLuxury.css"),
  },
  premium_grid: {
    view: read("src/modules/menu/theme-engine/themes/premium-grid/PremiumGridView.tsx"),
    card: read("src/modules/menu/theme-engine/themes/premium-grid/PremiumGridCard.tsx"),
    css: read("src/modules/menu/theme-engine/themes/premium-grid/premiumGrid.css"),
  },
  coffee: {
    view: read("src/modules/menu/theme-engine/themes/coffee/CoffeeThemeView.tsx"),
    card: read("src/modules/menu/theme-engine/themes/coffee/CoffeeThemeCard.tsx"),
    css: read("src/modules/menu/theme-engine/themes/coffee/coffeeTheme.css"),
  },
} as const;

const customizationCss = read(
  "src/modules/menu/theme-engine/customization/themeCustomization.css",
);
const studio = read(
  "src/modules/menu/theme-engine/customization/ThemeCustomizationStudio.tsx",
);
const studioPanel = read(
  "src/modules/menu/theme-engine/customization/ThemeCustomizationPanel.tsx",
);
const livePreview = read(
  "src/modules/menu/theme-engine/customization/ThemeLivePreview.tsx",
);
const resilientImage = read("src/core/presentation/ResilientImage.tsx");
const modalFocus = read("src/core/accessibility/useModalFocus.ts");
const managerRoute = read(
  "src/modules/staff-auth/pages/ProtectedManagerRoute.tsx",
);
const qrPage = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const ordersView = read(
  "src/modules/menu/theme-engine/themes/modern/ModernOrdersView.tsx",
);

const longRestaurantName =
  "The Grand International Family Restaurant and Artisan Dining Room";
const longCategoryName =
  "Seasonal Chef Specialities and House Favourites for the Whole Family";
const longItemName =
  "Slow Roasted Garden Vegetable and Herb Celebration Platter";

const category: MenuCategory = {
  id: "category-1",
  restaurant_id: "restaurant-1",
  name: longCategoryName,
};

const item: MenuItem = {
  id: "item-1",
  restaurant_id: "restaurant-1",
  category_id: category.id,
  name: longItemName,
  description: null,
  ingredients: null,
  allergens: null,
  calories: null,
  protein_g: null,
  preparation_time_minutes: null,
  price: 24.5,
  image_url: null,
  available: true,
};

function renderEdgeTheme(theme: MenuTheme) {
  const restaurant: Restaurant = {
    id: "restaurant-1",
    name: longRestaurantName,
    slug: "edge-restaurant",
    menu_theme: theme,
    logo_url: null,
    cover_url: null,
  };
  const view = createElement(ModernFoodView, {
    restaurant,
    tableNumber: "120",
    categories: [category],
    groups: [{ category, items: [item] }],
    activeCategoryId: "all",
    searchTerm: "",
    cartItemCount: 2,
    cartSubtotal: 49,
    hasActiveOrder: true,
    onSearchChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onAddToCart: vi.fn(),
    onOpenInfo: vi.fn(),
    onOpenCart: vi.fn(),
    onOpenOrders: vi.fn(),
  });

  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { restaurant },
      createElement(
        ThemeRenderer,
        {
          restaurant,
          categories: [category],
          menu: [item],
          cart: { items: [], itemCount: 2, subtotal: 49, visible: false },
          order: { activeSession: null, submittedOrder: null },
          theme,
        },
        view,
      ),
    ),
  );
}

describe("Phase 9.7 production theme parity", () => {
  it.each(MENU_THEMES)(
    "%s retains the same searchable, orderable, accessible customer surface",
    (theme) => {
      const html = renderEdgeTheme(theme);
      expect(html).toContain(longRestaurantName);
      expect(html).toContain(longItemName);
      expect(html).toContain("Table 120");
      expect(html).toContain(`Add ${longItemName} to cart`);
      expect(html).toContain(`Open food information for ${longItemName}`);
      expect(html).toContain("Search menu");
      expect(html).toContain(">Home<");
      expect(html).toContain(">Orders<");
      expect(html).toContain("image unavailable");
      expect(html).not.toContain("Coming Soon");
    },
  );

  it.each(MENU_THEMES)(
    "%s handles no menu items and no categories without demo content",
    (theme) => {
      const restaurant: Restaurant = {
        id: "restaurant-empty",
        name: "Empty Menu",
        slug: "empty-menu",
        menu_theme: theme,
      };
      const view = createElement(ModernFoodView, {
        restaurant,
        categories: [],
        groups: [],
        activeCategoryId: "all",
        searchTerm: "",
        cartItemCount: 0,
        cartSubtotal: 0,
        hasActiveOrder: false,
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onAddToCart: vi.fn(),
        onOpenInfo: vi.fn(),
        onOpenCart: vi.fn(),
        onOpenOrders: vi.fn(),
      });
      const html = renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { restaurant },
          createElement(
            ThemeRenderer,
            {
              restaurant,
              categories: [],
              menu: [],
              cart: { items: [], itemCount: 0, subtotal: 0, visible: false },
              order: { activeSession: null, submittedOrder: null },
              theme,
            },
            view,
          ),
        ),
      );
      expect(html).toMatch(/no available|menu coming soon|menu unavailable/i);
      expect(html).not.toMatch(/lorem ipsum|demo dish|sample item/i);
    },
  );

  it("keeps cart, checkout, order placement, tracking, offline, and reconnect in one shared path", () => {
    for (const sharedBoundary of [
      "PublicQrCartPanel",
      "PublicQrCheckoutPanel",
      "submitPublicQrOrder",
      "CanonicalLifecycleStatus",
      "ModernOrdersView",
      "subscribeCustomerTrackingEvents",
      "ThemeRenderer",
    ]) {
      expect(qrPage).toContain(sharedBoundary);
    }
    expect(qrPage.match(/<ThemeRenderer/g)).toHaveLength(1);
  });
});

describe("Phase 9.7 customization parity", () => {
  const completeCustomization: ThemeCustomization = {
    branding: {
      logoUrl: "https://images.example/logo.png",
      coverUrl: "https://images.example/cover.jpg",
      backgroundImageUrl: "https://images.example/background.jpg",
      accentColor: "#335577",
      secondaryColor: "#ccaa66",
    },
    typography: {
      headingFont: "elegant_serif",
      bodyFont: "rounded_sans",
      fontSize: 18,
      letterSpacing: 1.2,
      headingWeight: 700,
      bodyWeight: 500,
    },
    heroLayout: "compact",
    card: {
      radius: "square",
      shadow: "shadowless",
      imageSize: "small",
      border: "outline",
    },
    buttons: {
      style: "outline",
      shape: "pill",
      accentColor: "#224466",
    },
    spacing: { card: 20, section: 40, header: 24, image: 12 },
    animation: "premium",
    colorMode: "dark",
  };

  it.each(MENU_THEMES)(
    "%s resolves every centralized option without losing defaults",
    (theme) => {
      const effective = resolveThemeCustomization(
        theme,
        completeCustomization,
      );
      const surface = buildThemeCustomizationSurface(
        theme,
        completeCustomization,
      );
      expect(effective.branding).toMatchObject(
        completeCustomization.branding!,
      );
      expect(effective.typography).toMatchObject(
        completeCustomization.typography!,
      );
      expect(surface.attributes).toMatchObject({
        "data-theme-customized": "true",
        "data-hero-layout": "compact",
        "data-card-radius": "square",
        "data-card-shadow": "shadowless",
        "data-card-image": "small",
        "data-card-border": "outline",
        "data-button-style": "outline",
        "data-button-shape": "pill",
        "data-animation": "premium",
        "data-color-mode": "dark",
      });
    },
  );

  it("keeps preview, draft, discard, publish, and restore actions wired once", () => {
    for (const action of [
      "Preview",
      "Save Draft",
      "Discard",
      "Publish",
      "Restore Defaults",
    ]) {
      expect(studio).toContain(action);
    }
    expect(livePreview).toContain("createStoredThemeCustomization");
    expect(livePreview).toContain("<ThemeRenderer");
    expect(studio).toContain("themeCustomizationDraftKey");
    expect(studio).toContain("publishThemeCustomizationSelection");
    expect(studioPanel).toContain("resolveThemeCustomization");
  });
});

describe("Phase 9.7 responsive and accessibility certification", () => {
  it.each(MENU_THEMES)(
    "%s has mobile, tablet, desktop, touch, focus, and reduced-motion contracts",
    (theme) => {
      const css = themeFiles[theme].css;
      expect(css).toContain("repeat(2, minmax(0, 1fr))");
      expect(css).toMatch(/@media \(min-width: (600|768)px\)/);
      expect(css).toMatch(/@media \(min-width: (960|1024)px\)/);
      expect(css).toContain("min-height: 44px");
      expect(css).toContain(":focus-visible");
      expect(css).toContain("prefers-reduced-motion: reduce");
      expect(css).toContain("object-fit: cover");
    },
  );

  it("contains the page at every target width while preserving intentional category scrolling", () => {
    expect(customizationCss).toContain("overflow-x: clip");
    expect(customizationCss).toContain("width: 100%");
    expect(customizationCss).toContain("min-width: 0");
    expect(themeFiles.modern.css).toContain("@media (max-width: 359px)");
    expect(themeFiles.premium_grid.css).toContain("@media (min-width: 1536px)");
    expect(themeFiles.coffee.css).toContain("@media (min-width: 1360px)");
    expect(themeFiles.luxury.css).toContain("max-width: 1440px");
  });

  it("traps modal focus, restores the trigger, handles Escape, and provides resilient images", () => {
    expect(modalFocus).toContain('event.key === "Escape"');
    expect(modalFocus).toContain('event.key !== "Tab"');
    expect(modalFocus).toContain("previousFocus?.focus()");
    expect(studio).toContain("aria-describedby");
    expect(resilientImage).toContain("onError={() => setFailed(true)}");
    expect(resilientImage).toContain("setFailed(false)");
    for (const theme of MENU_THEMES) {
      expect(themeFiles[theme].card).toContain("ResilientImage");
      expect(themeFiles[theme].card).toContain('decoding="async"');
    }
  });

  it.each(["#777777", "#f5e9d4", "#221811"])(
    "selects an accessible foreground for the %s accent",
    (accentColor) => {
      const surface = buildThemeCustomizationSurface("modern", {
        branding: { accentColor },
      });
      const foreground = String(
        surface.style["--theme-accent-contrast" as keyof typeof surface.style],
      );
      expect(contrastRatio(accentColor, foreground)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});

describe("Phase 9.7 performance and cleanup boundaries", () => {
  it.each(MENU_THEMES)(
    "%s keeps memoized views/cards and efficient image rendering",
    (theme) => {
      expect(themeFiles[theme].view).toContain("memo(function");
      expect(themeFiles[theme].card).toContain("memo(function");
      expect(themeFiles[theme].card).toContain('"lazy"');
      expect(themeFiles[theme].card).toContain("fetchPriority");
    },
  );

  it("keeps the Studio route split and preview memoized", () => {
    expect(managerRoute).toContain("const ThemeCustomizationStudio = lazy(");
    expect(managerRoute).toContain("<Suspense");
    expect(livePreview).toContain("memo(function ThemeLivePreview");
    expect(livePreview).toContain("useMemo(");
  });

  it("removes obsolete placeholders and adds no Phase 9.7 database work", () => {
    expect(
      existsSync(
        resolve(
          process.cwd(),
          "src/modules/menu/theme-engine/themes/ThemePlaceholder.tsx",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        resolve(process.cwd(), "src/modules/menu/theme-engine/themeEngine.css"),
      ),
    ).toBe(false);
    expect(ordersView).not.toContain("Reorder - Coming Soon");
    const migrations = readdirSync(resolve(process.cwd(), "supabase/migrations"));
    expect(migrations.some((name) => /phase9_7|theme.*harden/i.test(name))).toBe(
      false,
    );
  });

  it("contains no debug statements or temporary work markers in production theme files", () => {
    const productionThemeSource = Object.values(themeFiles)
      .flatMap(({ view, card, css }) => [view, card, css])
      .join("\n");
    expect(productionThemeSource).not.toMatch(
      /console\.(log|debug)|debugger;|TODO|FIXME|@ts-ignore/,
    );
  });
});
