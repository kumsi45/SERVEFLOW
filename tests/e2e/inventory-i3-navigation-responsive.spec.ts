import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryDashboard.css"), "utf8");

const desktopNavigation = `<nav class="ia-sidebar-nav">
  <button class="active" aria-current="page"><svg class="ia-nav-icon" data-icon="overview"></svg><span class="ia-nav-label">Overview</span></button><button><svg class="ia-nav-icon" data-icon="stock"></svg><span class="ia-nav-label">Current Stock</span></button><button><svg class="ia-nav-icon" data-icon="movements"></svg><span class="ia-nav-label">Stock Movements</span></button><button class="ia-kitchen-request-link"><svg class="ia-nav-icon" data-icon="requests"></svg><span class="ia-nav-label">Kitchen Requests</span><strong>12</strong></button><button><svg class="ia-nav-icon" data-icon="purchase"></svg><span class="ia-nav-label">Purchase Orders</span></button><button><svg class="ia-nav-icon" data-icon="suppliers"></svg><span class="ia-nav-label">Suppliers</span></button><button><svg class="ia-nav-icon" data-icon="materials"></svg><span class="ia-nav-label">Materials</span></button><button><svg class="ia-nav-icon" data-icon="storage"></svg><span class="ia-nav-label">Storage</span></button>
</nav>`;

const drawerNavigation = `<nav class="ia-mobile-menu-nav" aria-label="Inventory menu navigation">
  <button class="ia-mobile-primary-destination"><svg class="ia-nav-icon" data-icon="overview"></svg><span class="ia-nav-label">Overview</span></button><button class="ia-mobile-primary-destination"><svg class="ia-nav-icon" data-icon="stock"></svg><span class="ia-nav-label">Current Stock</span></button><button class="ia-mobile-secondary-destination"><svg class="ia-nav-icon" data-icon="movements"></svg><span class="ia-nav-label">Stock Movements</span></button><button class="ia-mobile-primary-destination"><svg class="ia-nav-icon" data-icon="requests"></svg><span class="ia-nav-label">Kitchen Requests</span><strong>12</strong></button><button class="ia-mobile-primary-destination"><svg class="ia-nav-icon" data-icon="purchase"></svg><span class="ia-nav-label">Purchase Orders</span></button><button class="ia-mobile-secondary-destination"><svg class="ia-nav-icon" data-icon="suppliers"></svg><span class="ia-nav-label">Suppliers</span></button><button class="ia-mobile-secondary-destination"><svg class="ia-nav-icon" data-icon="materials"></svg><span class="ia-nav-label">Materials</span></button><button class="ia-mobile-secondary-destination"><svg class="ia-nav-icon" data-icon="storage"></svg><span class="ia-nav-label">Storage</span></button>
</nav>`;

const bottomNavigation = `<nav class="ia-mobile-bottom-nav" aria-label="Inventory navigation">
  <button class="active" aria-current="page" aria-label="Overview"><svg data-icon="overview" aria-hidden="true"></svg><strong>Overview</strong></button><button aria-label="Stock"><svg data-icon="stock" aria-hidden="true"></svg><strong>Stock</strong></button><button aria-label="Requests, 12 kitchen requests awaiting inventory"><svg data-icon="requests" aria-hidden="true"></svg><strong>Requests</strong><span class="ia-mobile-nav-badge" aria-hidden="true">12</span></button><button aria-label="Purchase"><svg data-icon="purchase" aria-hidden="true"></svg><strong>Purchase</strong></button>
</nav>`;

const fixture = `<main class="ia-shell">
  <header class="ia-mobile-header"><div class="ia-mobile-brand"><strong>ServeFlow</strong></div><div class="ia-mobile-header-actions"><button class="ia-menu-button" aria-label="Open inventory navigation" aria-expanded="false">☰</button></div></header>
  <button class="ia-mobile-menu-scrim" aria-label="Close inventory navigation" hidden></button>
  <aside class="ia-mobile-menu" aria-label="Inventory mobile navigation" hidden><div class="ia-mobile-menu-heading"><strong>ServeFlow</strong><button aria-label="Close inventory navigation">×</button></div>${drawerNavigation}<div class="ia-mobile-menu-user"><strong>Inventory Officer With A Long Name</strong><span>Inventory Officer</span><button>Logout</button></div></aside>
  <aside class="ia-sidebar" aria-label="Inventory navigation"><div class="ia-brand"><strong>ServeFlow</strong></div>${desktopNavigation}<div class="ia-user"><strong>Inventory Officer</strong><span>Inventory Officer</span><button>Logout</button></div></aside>
  <section class="ia-workspace"><div class="ia-cs-tools"><label class="ia-cs-search"><span>Search stock</span><input placeholder="Material, storage, or category"></label><button>Filters</button><button>Stock Action</button></div><div style="height:900px"></div><button id="last-action" style="min-height:44px">Last content action</button></section>
  ${bottomNavigation}
</main>`;

async function loadFixture(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:hidden}[hidden]{display:none!important}${styles}</style>${fixture}<script>
    const menu = document.querySelector('.ia-mobile-menu');
    const scrim = document.querySelector('.ia-mobile-menu-scrim');
    const trigger = document.querySelector('.ia-menu-button');
    const setOpen = (open) => { menu.hidden = !open; scrim.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); if (!open) trigger.focus(); };
    trigger.addEventListener('click', () => setOpen(true));
    scrim.addEventListener('click', () => setOpen(false));
    menu.querySelector('[aria-label="Close inventory navigation"]').addEventListener('click', () => setOpen(false));
    menu.querySelectorAll('.ia-mobile-menu-nav > button').forEach((button) => button.addEventListener('click', () => setOpen(false)));
  </script>`);
}

const mobileViewports = [
  { width: 360, height: 800 }, { width: 375, height: 812 }, { width: 390, height: 844 },
  { width: 412, height: 915 }, { width: 430, height: 932 },
];

for (const viewport of mobileViewports) {
  test(`Inventory I3 mobile drawer fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await loadFixture(page, viewport.width, viewport.height);
    await page.getByRole("button", { name: "Open inventory navigation" }).click();
    const drawer = page.getByRole("complementary", { name: "Inventory mobile navigation" });
    await expect(drawer).toBeVisible();
    const bottom = page.getByRole("navigation", { name: "Inventory navigation" });
    await expect(bottom).toBeVisible();
    await expect(bottom.getByRole("button")).toHaveCount(4);
    for (const destination of ["Overview", "Stock", "Requests", "Purchase"]) {
      await expect(bottom.getByRole("button", { name: new RegExp(`^${destination}`) })).toBeVisible();
    }
    for (const destination of ["Stock Movements", "Suppliers", "Materials", "Storage"]) await expect(drawer.getByRole("button", { name: destination })).toBeVisible();
    for (const duplicate of ["Overview", "Current Stock", "Kitchen Requests", "Purchase Orders"]) await expect(drawer.getByRole("button", { name: duplicate })).toBeHidden();
    await expect(page.getByText("More", { exact: true })).toHaveCount(0);
    await expect(bottom.getByRole("button", { name: /12 kitchen requests awaiting inventory/ })).toBeVisible();
    for (const icon of ["overview", "stock", "requests", "purchase"]) {
      await expect(bottom.locator(`[data-icon="${icon}"]`)).toBeVisible();
      expect(await bottom.locator(`[data-icon="${icon}"]`).getAttribute("data-icon")).toBe(icon);
    }
    for (const icon of ["movements", "suppliers", "materials", "storage"]) await expect(drawer.locator(`[data-icon="${icon}"]`)).toBeVisible();
    for (const icon of await page.locator(".ia-mobile-menu-nav .ia-nav-icon:visible, .ia-mobile-bottom-nav svg:visible").all()) {
      const iconBox = await icon.boundingBox();
      expect(iconBox?.width).toBe(20);
      expect(iconBox?.height).toBe(20);
    }
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    const box = await drawer.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    for (const button of await bottom.getByRole("button").all()) expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Last content action" }).scrollIntoViewIfNeeded();
    const lastBox = await page.getByRole("button", { name: "Last content action" }).boundingBox();
    const bottomBox = await bottom.boundingBox();
    expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0)).toBeLessThanOrEqual(bottomBox?.y ?? viewport.height);
    await drawer.getByRole("button", { name: "Stock Movements" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("button", { name: "Open inventory navigation" })).toBeFocused();
  });
}

const tabletViewports = [
  { width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 1024, height: 768 },
  { width: 1180, height: 820 }, { width: 1280, height: 800 },
];

for (const viewport of tabletViewports) {
  test(`Inventory I3 tablet navigation fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await loadFixture(page, viewport.width, viewport.height);
    const usesDrawer = viewport.width <= 900;
    await expect(page.getByRole("button", { name: "Open inventory navigation" })).toBeVisible({ visible: usesDrawer });
    await expect(page.locator(".ia-sidebar")).toBeVisible({ visible: !usesDrawer });
    await expect(page.getByRole("navigation", { name: "Inventory navigation" })).toBeHidden();
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    if (usesDrawer) {
      await page.getByRole("button", { name: "Open inventory navigation" }).click();
      const drawer = page.locator(".ia-mobile-menu");
      for (const destination of ["Overview", "Current Stock", "Stock Movements", "Kitchen Requests", "Purchase Orders", "Suppliers", "Materials", "Storage"]) await expect(drawer.getByRole("button", { name: new RegExp(`^${destination}`) })).toBeVisible();
      await expect(drawer.locator(".ia-nav-icon")).toHaveCount(8);
      for (const icon of await drawer.locator(".ia-nav-icon").all()) expect((await icon.boundingBox())?.width).toBe(20);
    }
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`Inventory I3 desktop sidebar fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await loadFixture(page, viewport.width, viewport.height);
    await expect(page.locator(".ia-sidebar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open inventory navigation" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Inventory navigation" })).toBeHidden();
    await expect(page.locator(".ia-sidebar-nav .ia-nav-icon")).toHaveCount(8);
    for (const icon of await page.locator(".ia-sidebar-nav .ia-nav-icon").all()) expect((await icon.boundingBox())?.width).toBe(20);
    const sidebar = await page.locator(".ia-sidebar").boundingBox();
    expect(sidebar?.width).toBeLessThanOrEqual(232);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
  });
}
