import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModernOrdersView } from "../../src/modules/menu/theme-engine/themes/modern/ModernOrdersView";
import type { Restaurant } from "../../src/modules/qr-menu/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const qrPage = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const homeView = read("src/modules/menu/theme-engine/themes/modern/ModernFoodView.tsx");
const ordersView = read("src/modules/menu/theme-engine/themes/modern/ModernOrdersView.tsx");
const bottomNavigation = read("src/modules/menu/theme-engine/themes/modern/ModernBottomNavigation.tsx");
const navigationHook = read("src/modules/menu/theme-engine/themes/modern/useModernMenuNavigation.ts");
const appRouter = read("src/app/router/AppRouter.tsx");

const restaurant: Restaurant = {
  id: "restaurant-1",
  name: "Sunrise Kitchen",
  slug: "sunrise-kitchen",
  menu_theme: "modern",
};

describe("Phase 9.2.1 independent Modern pages", () => {
  it("renders the dedicated no-orders page without menu or cart presentation", () => {
    const html = renderToStaticMarkup(createElement(ModernOrdersView, {
      restaurant,
      onNavigateHome: vi.fn(),
    }));

    expect(html).toContain("My Orders");
    expect(html).toContain("No Active Orders");
    expect(html).toContain("Browse the menu to place your first order.");
    expect(html).toContain("Browse Menu");
    expect(html).not.toContain("Search food or drinks");
    expect(html).not.toContain("View Cart");
  });

  it("renders active and previous order slots on Orders only", () => {
    const html = renderToStaticMarkup(createElement(ModernOrdersView, {
      restaurant,
      activeOrder: createElement("div", { id: "active-order" }, "Kitchen Progress and ETA"),
      previousOrder: createElement("div", { id: "previous-order" }, "Receipt 12"),
      onNavigateHome: vi.fn(),
    }));

    expect(html).toContain("Active Orders");
    expect(html).toContain("Previous Orders");
    expect(html).toContain("Kitchen Progress and ETA");
    expect(html).toContain("Receipt 12");
    expect(html).not.toContain("Coming Soon");
  });

  it("keeps the Home component free of tracker, payment, and kitchen UI", () => {
    expect(homeView).not.toMatch(/public-order-tracker|payment status|kitchen progress|tracker-timeline/i);
    expect(homeView).toContain("ModernFoodCard");
    expect(homeView).toContain("modern-food-search");
    expect(homeView).toContain("modern-cart-dock");
  });

  it("renders exactly Home and Orders in shared bottom navigation", () => {
    expect(bottomNavigation).toContain("<span>Home</span>");
    expect(bottomNavigation).toContain("<span>Orders</span>");
    expect(bottomNavigation).not.toMatch(/Profile|Favorites|Settings/);
    expect(homeView).toContain('<ModernBottomNavigation activePage="home"');
    expect(ordersView).toContain('<ModernBottomNavigation activePage="orders"');
  });
});

describe("Phase 9.2.1 navigation and business boundaries", () => {
  it("switches views without refresh and supports browser back with cleanup", () => {
    expect(navigationHook).toContain("window.history.pushState");
    expect(navigationHook).toContain('window.addEventListener("popstate"');
    expect(navigationHook).toContain('window.removeEventListener("popstate"');
    expect(navigationHook).toContain('window.location.hash === "#orders"');
    expect(navigationHook).not.toMatch(/location\.reload|window\.open|fetch\(/);
  });

  it("keeps order presentation off Home and cart presentation off Orders", () => {
    expect(qrPage).toContain('modernNavigation.page === "home" ? (');
    expect(qrPage).toContain("<ModernOrdersView");
    expect(qrPage).toContain("activeOrder={trackingOrderId ? (");
    expect(qrPage).toContain("previousOrder={servedFeedbackOrder ? (");
    expect(qrPage).toContain('modernNavigation.navigate("orders")');
    expect(qrPage).toContain('modernNavigation.navigate("home")');
  });

  it("reuses existing cart, checkout, order tracking, payment, and realtime code", () => {
    for (const boundary of [
      "usePublicQrCart",
      "usePublicQrCheckoutState",
      "PublicQrCartPanel",
      "PublicQrCheckoutPanel",
      "CanonicalLifecycleStatus",
      "tracker-timeline",
      "subscribeCustomerTrackingEvents",
      "submitPublicQrOrder",
    ]) expect(qrPage).toContain(boundary);

    const newPresentation = `${ordersView}\n${bottomNavigation}\n${navigationHook}`;
    expect(newPresentation).not.toMatch(/supabase|submitPublicQrOrder|paymentMethod|inventory|fetch\(/i);
  });

  it("does not alter the QR route parser", () => {
    expect(appRouter).toContain('const match = pathname.match(/^\\/r\\/([^/]+)\\/?$/)');
    expect(appRouter).toContain("return <QRMenuPage restaurantSlug={route.restaurantSlug} />");
  });
});
