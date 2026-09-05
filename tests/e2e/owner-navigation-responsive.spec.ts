import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ownerStyles = readFileSync(resolve(process.cwd(), "src/modules/owner/styles/ownerDashboard.css"), "utf8");
const aiStyles = readFileSync(resolve(process.cwd(), "src/modules/owner/components/ai/ownerAiAdvisor.css"), "utf8");

const primary = ["Home", "Orders", "Tables", "Finance", "Menu"];
const secondary = ["Kitchen", "Inventory", "Staff", "Customers", "Reports", "Settings"];

function icon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 4v16" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
}

function navButton(label: string, active = false) {
  return `<button type="button"${active ? ' class="active" aria-current="page"' : ""}><span>${icon()}</span>${label}</button>`;
}

function markup() {
  return `<div class="od-root">
    <header class="od-mobile-appbar"><div class="od-mobile-page-context"><span>A Very Long Current Business Name</span><h1>Dashboard</h1></div><div class="od-mobile-appbar-actions"><button class="od-mobile-notification" aria-label="Notifications">${icon()}<span class="od-notif-dot"></span></button><button aria-label="Open owner navigation">${icon()}</button></div></header>
    <aside class="od-sidebar"><div class="od-sidebar-brand">ServeFlow</div><nav class="od-nav">${["Overview", "Operations", "People", "Money", "Business"].map((group) => `<section class="od-nav-section"><div class="od-nav-section-label">${group}</div>${navButton(group === "Overview" ? "Dashboard" : group)}</section>`).join("")}</nav><div class="od-sidebar-footer">Grand Royal<br>Business owner</div></aside>
    <div class="od-main"><header class="od-topbar">Owner / Dashboard</header><main class="od-page"><h1>Owner content</h1><div style="height:1100px"></div><div id="content-end">Content end</div></main></div>
    <button class="sf-ai-launcher"><span class="sf-ai-launcher-mark">AI</span><span>Business Advisor</span></button>
    <nav class="od-mobile-bottom-nav" aria-label="Owner mobile navigation">${primary.map((label, index) => navButton(label, index === 0)).join("")}</nav>
    <div class="od-mobile-menu-layer" hidden><button class="od-mobile-menu-backdrop" aria-label="Close owner navigation"></button><aside class="od-mobile-menu" role="dialog" aria-modal="true"><div class="od-mobile-menu-head"><div class="od-restaurant-badge"><div class="od-restaurant-avatar">G</div><div><div class="od-restaurant-name">Grand Royal</div><div class="od-restaurant-role">Business owner</div></div></div><button aria-label="Close owner navigation">×</button></div><nav class="od-mobile-menu-nav">${secondary.map((label) => navButton(label)).join("")}<div class="od-mobile-menu-separator"></div>${["Subscription", "Help & Support", "About ServeFlow"].map((label) => navButton(label)).join("")}</nav><button class="od-mobile-menu-signout">${icon()} Sign out</button></aside></div>
  </div>`;
}

async function load(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${ownerStyles}${aiStyles}</style>${markup()}`);
}

test("desktop Owner sidebar uses the new hierarchy without mobile navigation overlap", async ({ page }) => {
  await load(page, 1440, 900);
  await expect(page.locator(".od-sidebar")).toBeVisible();
  await expect(page.locator(".od-mobile-appbar")).toBeHidden();
  await expect(page.locator(".od-mobile-bottom-nav")).toBeHidden();
  await expect(page.locator(".od-nav-section-label")).toHaveText(["Overview", "Operations", "People", "Money", "Business"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 390, height: 700 },
  { width: 412, height: 732 },
  { width: 430, height: 800 },
]) {
  test(`mobile Owner navigation is usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await load(page, viewport.width, viewport.height);
    const bottom = page.locator('.od-mobile-bottom-nav');
    await expect(page.locator('.od-sidebar')).toBeHidden();
    await expect(page.locator('.od-mobile-appbar')).toBeVisible();
    expect(await page.locator('.od-mobile-appbar-actions > button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual(['Notifications', 'Open owner navigation']);
    await expect(bottom.locator(':scope > button')).toHaveCount(5);
    await expect(bottom.locator(':scope > button')).toHaveText(primary);

    const geometry = await page.evaluate(() => {
      const bottom = document.querySelector<HTMLElement>('.od-mobile-bottom-nav')!.getBoundingClientRect();
      const ai = document.querySelector<HTMLElement>('.sf-ai-launcher')!.getBoundingClientRect();
      const controls = [...document.querySelectorAll<HTMLElement>('.od-mobile-appbar button,.od-mobile-bottom-nav button')].map((node) => node.getBoundingClientRect().height);
      return { pageOverflow: document.documentElement.scrollWidth > innerWidth, navBottom: Math.round(bottom.bottom), aiBottom: Math.round(ai.bottom), navTop: Math.round(bottom.top), minimumControl: Math.min(...controls) };
    });
    expect(geometry).toMatchObject({ pageOverflow: false, navBottom: viewport.height });
    expect(geometry.minimumControl).toBeGreaterThanOrEqual(44);
    expect(geometry.aiBottom).toBeLessThan(geometry.navTop);

    await page.locator('.od-mobile-menu-layer').evaluate((node) => { node.hidden = false; });
    const drawer = page.locator('.od-mobile-menu');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.od-mobile-menu-nav > button')).toHaveText([...secondary, "Subscription", "Help & Support", "About ServeFlow"]);
    for (const label of primary) await expect(drawer.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    const drawerGeometry = await drawer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { overflow: node.scrollWidth > node.clientWidth, left: rect.left, width: rect.width, right: Math.round(rect.right), scrollable: node.scrollHeight >= node.clientHeight };
    });
    expect(drawerGeometry.overflow).toBe(false);
    expect(drawerGeometry.right).toBe(viewport.width);
    expect(drawerGeometry.width / viewport.width).toBeGreaterThanOrEqual(.82);
    expect(drawerGeometry.width / viewport.width).toBeLessThanOrEqual(.86);
    expect(drawerGeometry.left).toBeGreaterThan(0);
    expect(drawerGeometry.scrollable).toBe(true);
    await drawer.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect(page.locator('.od-mobile-menu-signout')).toBeInViewport();
    const stacking = await page.evaluate(() => ({ drawer: Number(getComputedStyle(document.querySelector<HTMLElement>('.od-mobile-menu-layer')!).zIndex), ai: Number(getComputedStyle(document.querySelector<HTMLElement>('.sf-ai-launcher')!).zIndex) }));
    expect(stacking.drawer).toBeGreaterThan(stacking.ai);
  });
}
