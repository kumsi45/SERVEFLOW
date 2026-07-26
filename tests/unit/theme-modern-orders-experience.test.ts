import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ModernOrdersView } from "../../src/modules/menu/theme-engine/themes/modern/ModernOrdersView";
import type { Restaurant } from "../../src/modules/qr-menu/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ordersSource = read("src/modules/menu/theme-engine/themes/modern/ModernOrdersView.tsx");
const navigationSource = read("src/modules/menu/theme-engine/themes/modern/useModernMenuNavigation.ts");
const ordersCss = read("src/modules/menu/theme-engine/themes/modern/modernFood.css");
const qrPage = read("src/modules/qr-menu/pages/QRMenuPage.tsx");

const restaurant: Restaurant = {
  id: "restaurant-1",
  name: "Grand Royal",
  slug: "grand-royal",
  menu_theme: "modern",
};

describe("Phase 9.2.2 professional customer orders presentation", () => {
  it("uses a minimal order-focused header and dining visit summary", () => {
    const html = renderToStaticMarkup(createElement(ModernOrdersView, {
      restaurant,
      activeOrder: createElement("section", { className: "public-order-tracker" }, "Order 26"),
      onNavigateHome: vi.fn(),
    }));

    expect(html).toContain("Grand Royal");
    expect(html).toContain("My Orders");
    expect(html).toContain("Today&#x27;s Visit");
    expect(html).toContain("1 Active Order");
    expect(html).not.toMatch(/Search food|Menu categories|modern-food-header/);
  });

  it("keeps supplied kitchen orders independent in individual presentation cards", () => {
    const html = renderToStaticMarkup(createElement(ModernOrdersView, {
      restaurant,
      activeOrder: [
        createElement("section", { className: "public-order-tracker", key: "26" }, "Order 26 Preparing"),
        createElement("section", { className: "public-order-tracker", key: "27" }, "Order 27 Received"),
      ],
      onNavigateHome: vi.fn(),
    }));

    expect(html).toContain("2 Active Orders");
    expect(html.match(/modern-active-order-card/g)).toHaveLength(2);
    expect(html).toContain("Order 26 Preparing");
    expect(html).toContain("Order 27 Received");
  });

  it("keeps previous orders collapsed and provides the professional empty state", () => {
    const withPrevious = renderToStaticMarkup(createElement(ModernOrdersView, {
      restaurant,
      previousOrder: createElement("div", null, "Previous receipt"),
      onNavigateHome: vi.fn(),
    }));
    const empty = renderToStaticMarkup(createElement(ModernOrdersView, { restaurant, onNavigateHome: vi.fn() }));

    expect(withPrevious).toContain("<details class=\"modern-previous-orders\">");
    expect(withPrevious).not.toContain("<details class=\"modern-previous-orders\" open=\"\">");
    expect(empty).toContain("No Active Orders");
    expect(empty).toContain("Browse Menu");
  });

  it("styles one clean status timeline with completed, current, and future states", () => {
    expect(ordersCss).toContain(".modern-active-order-card .tracker-step.done");
    expect(ordersCss).toContain("background: #1c9b62");
    expect(ordersCss).toContain(".modern-active-order-card .tracker-step.active");
    expect(ordersCss).toContain("background: var(--modern-orange)");
    expect(ordersCss).toContain("background: #dedbd8");
    expect(ordersCss).toContain('.tracker-step:nth-child(2) > span:last-child::after { content: "Payment"');
    expect(ordersCss).toContain(".sf-canonical-lifecycle { display: none; }");
  });

  it("maintains touch, focus, reduced-motion, and query-preserving navigation", () => {
    expect(ordersCss).toContain("min-height: 44px");
    expect(ordersCss).toContain(":focus-visible");
    expect(ordersCss).toContain("prefers-reduced-motion: reduce");
    expect(navigationSource).toContain("window.location.search");
    expect(navigationSource).toContain("window.history.pushState");
    expect(navigationSource).not.toContain("location.reload");
  });
});

describe("Phase 9.2.2 protected boundaries", () => {
  it("contains presentation only and reuses the supplied tracker nodes", () => {
    expect(ordersSource).toContain("Children.toArray(activeOrder)");
    expect(ordersSource).not.toMatch(/supabase|fetch\(|paymentMethod|submit|subscribe|inventory|kitchen_status/i);
  });

  it("leaves the QR engine and routing integration untouched", () => {
    for (const boundary of [
      "usePublicQrCart",
      "usePublicQrCheckoutState",
      "subscribeCustomerTrackingEvents",
      "submitPublicQrOrder",
      "CanonicalLifecycleStatus",
      "tracker-timeline",
    ]) expect(qrPage).toContain(boundary);
  });
});
