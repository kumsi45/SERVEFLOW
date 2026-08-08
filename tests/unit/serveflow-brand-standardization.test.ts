import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SERVEFLOW_LOGO_ASSET, ServeFlowBrand, ServeFlowBrandMark } from "../../src/core/presentation/ServeFlowBrand";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const cashierUi = read("src/modules/cashier/components/CashierDashboardUi.tsx");
const cashierPage = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const cashierStyles = read("src/modules/cashier/styles/cashierDashboard.css");
const manager = read("src/modules/manager/components/ManagerLayout.tsx");
const inventory = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const brandStyles = read("src/core/presentation/serveFlowBrand.css");

describe("global ServeFlow brand component", () => {
  it("renders full and compact variants from the official asset", () => {
    const full = renderToStaticMarkup(createElement(ServeFlowBrand, { variant: "full", tenantName: "Grand Royal" }));
    const compact = renderToStaticMarkup(createElement(ServeFlowBrand, { variant: "compact" }));
    expect(full).toContain(`src="${SERVEFLOW_LOGO_ASSET}"`);
    expect(full).toContain("ServeFlow");
    expect(full).toContain("Grand Royal");
    expect(compact).toContain('data-variant="compact"');
    expect(compact).not.toContain("Grand Royal");
  });

  it("gives icon-only branding one accessible name without duplicate image text", () => {
    const markup = renderToStaticMarkup(createElement(ServeFlowBrand, { variant: "icon-only" }));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="ServeFlow"');
    expect(markup).toContain('alt=""');
    expect(markup.match(/ServeFlow/g)).toHaveLength(1);
  });

  it("renders the centralized S fallback when the official image fails", () => {
    const markup = renderToStaticMarkup(createElement(ServeFlowBrandMark, { imageFailed: true }));
    expect(markup).toContain("sf-brand-fallback");
    expect(markup).toContain(">S<");
    expect(markup).not.toContain("<img");
  });

  it("centers the symbol crop without exposing the asset wordmark", () => {
    expect(brandStyles).toContain("transform: scale(2.8)");
    expect(brandStyles).toContain("transform-origin: 50% 36%");
    expect(brandStyles).toContain("overflow: hidden");
  });
});

describe("cashier brand placement", () => {
  it("keeps one full brand with the current tenant in the global header", () => {
    expect(cashierUi).toContain('<ServeFlowBrand variant="full" tenantName={restaurantName} />');
    expect(cashierUi.match(/<ServeFlowBrand/g)).toHaveLength(1);
  });

  it("removes the sidebar logo, Cashier Terminal label, and reserved pseudo-element", () => {
    expect(cashierStyles).not.toContain(".cd-pos-nav::before");
    expect(cashierStyles).not.toContain("Cashier Terminal");
    expect(cashierStyles).not.toContain(".cd-logo");
    expect(cashierStyles).toContain('content: "Primary Actions"');
  });

  it("preserves cashier navigation and actions", () => {
    for (const label of ["New Order", "Cancellation Requests"]) expect(cashierPage).toContain(label);
    expect(cashierStyles).toContain("Today's Activity");
  });

  it("standardizes dashboard shells that require their own brand", () => {
    expect(manager).toContain('<ServeFlowBrand variant="compact" />');
    expect(inventory).toContain('<ServeFlowBrand variant="compact" />');
    expect(owner).toContain('sidebarCollapsed ? "icon-only" : "compact"');
    expect(manager).not.toContain("Manager operations");
    expect(inventory).not.toContain("Inventory Administration");
    expect(owner).not.toContain('<div className="od-brand-text">ServeFlow</div>');
  });
});
