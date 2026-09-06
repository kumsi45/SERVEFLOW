import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ownerStyles = readFileSync(
  resolve(process.cwd(), "src/modules/owner/styles/ownerDashboard.css"),
  "utf8",
);
const aiStyles = readFileSync(
  resolve(
    process.cwd(),
    "src/modules/owner/components/ai/ownerAiAdvisor.css",
  ),
  "utf8",
);

function state(kind: string, label: string) {
  return `<span class="od-order-state ${kind}">${label}</span>`;
}

function desktopRow(index: number) {
  return `<tr tabindex="0"><td><strong>#GRSF-00${index}</strong><small>${index} items</small></td><td>T${index}</td><td>Waiter · A deliberately long creator name</td><td>${state("operational-preparing", "Preparing")}</td><td>${state(index === 3 ? "financial-payment_due" : "financial-paid", index === 3 ? "Payment Due" : "Paid")}</td><td><strong>ETB 747.50</strong></td><td>${index * 8}m</td></tr>`;
}

function mobileRow(index: number) {
  return `<button type="button" class="od-orders-mobile-row${index === 3 ? " served-payment-due" : ""}"><span class="od-orders-mobile-top"><strong>#GRSF-00${index}</strong><b>ETB 747.50</b></span><span class="od-orders-mobile-table">Table ${index}</span><span class="od-orders-mobile-source">Waiter · A deliberately long creator name</span><span class="od-orders-mobile-meta">${index} items · ${index * 8}m</span><span class="od-orders-mobile-states">${state(index === 3 ? "operational-served" : "operational-preparing", index === 3 ? "Served" : "Preparing")}${state(index === 3 ? "financial-payment_due" : "financial-paid", index === 3 ? "Payment Due" : "Paid")}<svg viewBox="0 0 24 24"></svg></span></button>`;
}

function markup() {
  return `<div class="od-root"><main class="od-orders-experience">
    <header class="od-orders-heading"><h1>Orders</h1></header>
    <section class="od-orders-summary"><div><span>Active</span><strong>3</strong></div><div class="attention"><span>Payment Due</span><strong>2<small> · ETB 1,275</small></strong></div><div><span>Ready</span><strong>1</strong></div><div><span>Served</span><strong>4</strong></div></section>
    <div class="od-orders-toolbar"><label class="od-orders-search"><svg></svg><input placeholder="Search orders..."></label><button class="od-orders-filter-trigger"><svg></svg><span>Filters</span></button></div>
    <nav class="od-orders-primary-filters">${["All", "Active", "Due", "Served", "Closed"].map((label, index) => `<button class="${index === 0 ? "active" : ""}"><span class="mobile-label">${label}</span><span class="desktop-label">${label === "Due" ? "Payment Due" : label}</span></button>`).join("")}</nav>
    <section class="od-orders-list"><div class="od-orders-desktop-table"><table><thead><tr>${["Order", "Table", "Source", "Status", "Payment", "Total", "Time"].map((heading) => `<th>${heading}</th>`).join("")}</tr></thead><tbody>${[1, 2, 3, 4, 5, 6].map(desktopRow).join("")}</tbody></table></div><div class="od-orders-mobile-list">${[1, 2, 3, 4, 5, 6].map(mobileRow).join("")}</div></section>
  </main><button class="sf-ai-launcher"><span class="sf-ai-launcher-mark">AI</span><span>Business Advisor</span></button><nav class="od-mobile-bottom-nav">${["Home", "Orders", "Tables", "Finance", "Menu"].map((label) => `<button>${label}</button>`).join("")}</nav></div>`;
}

async function load(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%}${ownerStyles}${aiStyles}</style>${markup()}`,
  );
}

for (const width of [1440, 1280, 1024, 768]) {
  test(`Owner Orders desktop list fits ${width}px`, async ({ page }) => {
    await load(page, width, 900);
    await expect(page.locator(".od-orders-desktop-table")).toBeVisible();
    await expect(page.locator(".od-orders-mobile-list")).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    const table = await page.locator(".od-orders-desktop-table").evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth);
  });
}

for (const width of [430, 390, 360]) {
  test(`Owner Orders uses native mobile rows at ${width}px`, async ({ page }) => {
    await load(page, width, 800);
    await expect(page.locator(".od-orders-desktop-table")).toBeHidden();
    await expect(page.locator(".od-orders-mobile-list")).toBeVisible();
    await expect(page.locator(".od-orders-mobile-row")).toHaveCount(6);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    const geometry = await page.evaluate(() => {
      const toolbar = document.querySelector<HTMLElement>(".od-orders-toolbar")!;
      const filters = document.querySelector<HTMLElement>(".od-orders-primary-filters")!;
      const row = document.querySelector<HTMLElement>(".od-orders-mobile-row")!;
      const nav = document.querySelector<HTMLElement>(".od-mobile-bottom-nav")!;
      const ai = document.querySelector<HTMLElement>(".sf-ai-launcher")!;
      return {
        toolbarOverflow: toolbar.scrollWidth > toolbar.clientWidth,
        filterOverflow: filters.scrollWidth > filters.clientWidth,
        rowOverflow: row.scrollWidth > row.clientWidth,
        aiAboveNavigation: ai.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top,
      };
    });
    expect(geometry).toEqual({
      toolbarOverflow: false,
      filterOverflow: false,
      rowOverflow: false,
      aiAboveNavigation: true,
    });
    const lastRow = page.locator(".od-orders-mobile-row").last();
    await lastRow.scrollIntoViewIfNeeded();
    await expect(lastRow).toBeInViewport();
  });
}

test("Owner Order details sheet fits a 360px phone", async ({ page }) => {
  await load(page, 360, 800);
  await page.locator("body").evaluate((body) => {
    body.insertAdjacentHTML(
      "beforeend",
      '<div class="od-order-detail-layer"><aside class="od-order-detail"><header><div><span>Order details</span><h2>#GRSF-003</h2></div><button>Close</button></header><div class="od-order-detail-body"><section><h3>Order</h3><dl><div><dt>Table</dt><dd>Table 3</dd></div></dl></section><section><h3>Payment</h3><p>Payment Due</p></section></div></aside></div>',
    );
  });
  const drawer = page.locator(".od-order-detail");
  await expect(drawer).toBeVisible();
  const geometry = await drawer.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    right: Math.round(node.getBoundingClientRect().right),
    overflow: node.scrollWidth > node.clientWidth,
  }));
  expect(geometry).toEqual({ width: 360, right: 360, overflow: false });
});
