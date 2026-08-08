import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const cashierStyles = readFileSync(resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"), "utf8");
const brandStyles = readFileSync(resolve(process.cwd(), "src/core/presentation/serveFlowBrand.css"), "utf8");

test("cashier keeps one unclipped header brand and starts the sidebar with Primary Actions", async ({ page }) => {
  await page.goto("/");
  await page.setContent(`
    <style>${brandStyles}${cashierStyles}html,body{margin:0}</style>
    <main class="cd-root">
      <header class="cd-header">
        <div class="cd-header-left">
          <div class="sf-brand" data-theme="light" data-variant="full">
            <span class="sf-brand-mark" aria-hidden="true"><img src="/serveflowlogo.png" alt=""></span>
            <span class="sf-brand-copy"><span class="sf-brand-name">ServeFlow</span><span class="sf-brand-tenant">Grand Royal</span></span>
          </div>
        </div>
        <div class="cd-header-center">
          <label class="cd-header-search"><input aria-label="Search" placeholder="Search table, customer, invoice or phone..."><kbd>Ctrl K</kbd></label>
          <div class="cd-header-shift-time"><span>Shift Duration<strong>2h 14m</strong></span></div>
        </div>
        <div class="cd-header-right"><button class="cd-icon-btn">N</button><button class="cd-signout-btn">Sign Out</button></div>
      </header>
      <aside class="cd-pos-nav"><div class="cd-pos-nav-primary"><button><strong>New Order</strong></button><button><strong>Cancellation Requests</strong></button></div><section class="cd-activity"><h2>Today's Activity</h2></section></aside>
      <section class="cd-body"></section><aside class="cd-right-panel"></aside>
    </main>
  `);
  await expect(page.locator(".sf-brand-mark img")).toHaveJSProperty("complete", true);
  await expect.poll(() => page.locator(".sf-brand-mark img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate((viewportWidth) => {
      const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      const header = rect(".cd-header");
      const brand = rect(".sf-brand");
      const tenant = rect(".sf-brand-tenant");
      const search = rect(".cd-header-search");
      const duration = rect(".cd-header-shift-time");
      const sidebar = rect(".cd-pos-nav");
      const primary = rect(".cd-pos-nav-primary");
      return {
        brandCount: document.querySelectorAll(".sf-brand").length,
        brandClipped: brand.left < header.left || brand.right > header.right || brand.top < header.top || brand.bottom > header.bottom,
        tenantVisible: tenant.width > 0 && tenant.height > 0,
        searchOverlap: search.left < brand.right,
        durationVisible: duration.width > 0 && duration.height > 0,
        durationBesideSearch: duration.left >= search.right && Math.abs(duration.top - search.top) <= 4,
        sidebarTopGap: primary.top - sidebar.top,
        primaryLabel: getComputedStyle(document.querySelector(".cd-pos-nav-primary")!, "::before").content,
        horizontalOverflow: document.documentElement.scrollWidth > viewportWidth,
      };
    }, viewport.width);

    expect(geometry.brandCount).toBe(1);
    expect(geometry.brandClipped).toBe(false);
    expect(geometry.tenantVisible).toBe(true);
    expect(geometry.searchOverlap).toBe(false);
    expect(geometry.durationVisible).toBe(true);
    expect(geometry.durationBesideSearch).toBe(true);
    expect(geometry.sidebarTopGap).toBeGreaterThanOrEqual(24);
    expect(geometry.sidebarTopGap).toBeLessThanOrEqual(32);
    expect(geometry.primaryLabel).toContain("Primary Actions");
    expect(geometry.horizontalOverflow).toBe(false);
  }
});
