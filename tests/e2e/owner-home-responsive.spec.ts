import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ownerStyles = readFileSync(
  resolve(process.cwd(), "src/modules/owner/styles/ownerDashboard.css"),
  "utf8",
);
const brandStyles = readFileSync(
  resolve(process.cwd(), "src/core/presentation/serveFlowBrand.css"),
  "utf8",
);
const advisorStyles = readFileSync(
  resolve(process.cwd(), "src/modules/owner/components/ai/ownerAiAdvisor.css"),
  "utf8",
);

function metric(label: string, value: string) {
  return `<div><span>${label}</span><strong>${value}</strong></div>`;
}

function markup() {
  return `<div class="od-root">
    <header class="od-mobile-appbar"><div class="od-mobile-owner-brand"><div class="sf-brand" data-variant="compact"><span class="sf-brand-mark"><img src="/serveflowlogo.png" alt=""></span><span class="sf-brand-copy"><span class="sf-brand-name">ServeFlow</span></span></div></div><div class="od-mobile-appbar-actions"><button aria-label="Notifications">!</button><button aria-label="Open owner navigation">☰</button></div></header>
    <aside class="od-sidebar"></aside>
    <div class="od-main"><header class="od-topbar">Owner / Dashboard</header>
      <main class="od-page od-owner-home od-owner-home-refined">
        <header class="od-home-header"><h1>Good evening, A Very Long Owner Name</h1><p class="od-home-business-name">Grand Royal Hospitality</p></header>
        <div class="od-home-layout">
          <section class="od-home-section od-home-money"><div class="od-home-section-heading"><h2>Today's Revenue</h2></div><div class="od-home-money-total"><strong>Br 24,850</strong></div><div class="od-home-money-grid">${metric("Cash", "Br 11,200")}${metric("Digital", "Br 13,650")}${metric("Orders", "64")}${metric("Avg. order", "Br 388")}</div></section>
          <section class="od-home-section od-home-attention"><div class="od-home-section-heading"><h2>Money to Watch</h2></div><button class="od-home-attention-action"><svg></svg><span><strong>Payment due</strong><small>1 bill · Br 632</small></span><svg></svg></button></section>
          <section class="od-home-section od-home-live"><div class="od-home-section-heading"><h2>Business Health</h2></div><div class="od-home-health-grid"><article><span>Tables</span><strong>6 / 15 occupied</strong></article><article><span>Kitchen</span><strong>3 active orders</strong></article><article><span>Staff</span><strong>8 working</strong></article></div></section>
          <section class="od-home-section od-home-comparison"><div class="od-home-section-heading"><h2>Today vs Yesterday</h2></div><div class="od-home-comparison-list">${["Revenue", "Orders", "Avg. order"].map((label) => `<div><span>${label}<small>Yesterday by now</small></span><strong>Br 1,200</strong><b class="up">↑ 12%</b></div>`).join("")}</div></section>
          <section class="od-home-section od-home-activity"><div class="od-home-section-heading inline"><h2>Recent Activity</h2><button>View all</button></div><div class="od-home-activity-list">${["Payment verified", "Order served", "Payment verified"].map((label, index) => `<button><time>10:${40 - index}</time><span>${label}</span><strong>Br 632</strong></button>`).join("")}</div></section>
        </div>
      </main>
    </div>
    <button class="sf-ai-launcher"><span class="sf-ai-launcher-mark">AI</span><span>Business Advisor</span></button>
    <nav class="od-mobile-bottom-nav">${["Home", "Orders", "Tables", "Finance", "Menu"].map((label) => `<button><span>•</span>${label}</button>`).join("")}</nav>
  </div>`;
}

async function load(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${brandStyles}${ownerStyles}${advisorStyles}</style>${markup()}`,
  );
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 430, height: 800 },
]) {
  test(`Owner Home stays compact at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await load(page, viewport.width, viewport.height);
    await expect(page.locator(".od-mobile-appbar .sf-brand-name")).toBeVisible();
    await expect(page.locator(".od-mobile-appbar .sf-brand-name")).toHaveText("ServeFlow");
    await expect(page.locator(".od-mobile-appbar")).not.toContainText("Grand Royal Hospitality");
    await expect(page.locator(".od-home-business-name")).toBeHidden();
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      const revenue = rect(".od-home-money");
      const watch = rect(".od-home-attention");
      const advisor = rect(".sf-ai-launcher");
      const action = rect(".od-home-attention-action");
      const healthValues = [...document.querySelectorAll<HTMLElement>(".od-home-health-grid strong")].map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      });
      const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        headerHeight: rect(".od-home-header").height,
        revenueTop: revenue.top,
        watchTop: watch.top,
        watchVisibleAboveNav: watch.top < innerHeight - 62,
        advisorOverAction: intersects(advisor, action),
        advisorOverHealthValue: healthValues.some((value) => intersects(advisor, value)),
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.headerHeight).toBeLessThanOrEqual(22);
    expect(geometry.revenueTop).toBeLessThan(126);
    expect(geometry.watchTop).toBeGreaterThan(geometry.revenueTop);
    expect(geometry.watchVisibleAboveNav).toBe(true);
    expect(geometry.advisorOverAction).toBe(false);
    expect(geometry.advisorOverHealthValue).toBe(false);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bottomOverlap = await page.evaluate(() => {
      const advisor = document.querySelector<HTMLElement>(".sf-ai-launcher")!.getBoundingClientRect();
      const lastActivity = document.querySelector<HTMLElement>(".od-home-activity-list > button:last-child")!.getBoundingClientRect();
      return advisor.left < lastActivity.right && advisor.right > lastActivity.left && advisor.top < lastActivity.bottom && advisor.bottom > lastActivity.top;
    });
    expect(bottomOverlap).toBe(false);
  });
}

test("desktop Owner Home uses the executive three-row composition", async ({ page }) => {
  await load(page, 1440, 900);
  const positions = await page.locator(".od-home-section").evaluateAll((sections) =>
    sections.map((section) => {
      const rect = section.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width) };
    }),
  );
  expect(positions[0].top).toBe(positions[1].top);
  expect(positions[0].width).toBeGreaterThan(positions[1].width);
  expect(positions[2].left).toBe(positions[0].left);
  expect(positions[2].width).toBeGreaterThan(positions[0].width);
  expect(positions[3].top).toBe(positions[4].top);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
