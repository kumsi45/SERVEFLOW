import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryDashboard.css"), "utf8");

const navigation = (mobile: boolean) => `<nav class="${mobile ? "ia-mobile-menu-nav" : "ia-sidebar-nav"}" aria-label="${mobile ? "Inventory destinations" : "Inventory navigation"}">
  <button class="active" aria-current="page"><span>Overview</span></button>
  <button><span>Current Stock</span></button>
  <button><span>Stock Movements</span></button>
  <button class="ia-kitchen-request-link"><span>Kitchen Requests</span><strong>12</strong></button>
  <button><span>Purchase Orders</span></button>
  <button><span>Suppliers</span></button>
  <button><span>Materials</span></button>
  <button><span>Storage</span></button>
</nav>`;

const fixture = `<main class="ia-shell">
  <header class="ia-mobile-header"><div class="ia-mobile-header-actions"><button class="ia-menu-button" aria-label="Open inventory navigation" aria-expanded="false">☰</button></div></header>
  <button class="ia-mobile-menu-scrim" aria-label="Close inventory navigation" hidden></button>
  <aside class="ia-mobile-menu" aria-label="Inventory mobile navigation" hidden><div class="ia-mobile-menu-heading"><div><strong>Inventory</strong><span>Grand Royal Restaurant With A Long Name</span></div><button aria-label="Close inventory navigation">×</button></div>${navigation(true)}<div class="ia-mobile-menu-user"><strong>Inventory Officer With A Long Name</strong><span>Inventory Officer</span><button>Logout</button></div></aside>
  <aside class="ia-sidebar" aria-label="Inventory navigation"><div class="ia-brand"><strong>ServeFlow</strong></div>${navigation(false)}<div class="ia-user"><strong>Inventory Officer</strong><span>Inventory Officer</span><button>Logout</button></div></aside>
  <section class="ia-workspace"><div class="ia-cs-tools"><label class="ia-cs-search"><span>Search stock</span><input placeholder="Material, storage, or category"></label><button>Filters</button><button>Stock Action</button></div></section>
</main>`;

async function loadFixture(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:hidden}[hidden]{display:none!important}${styles}</style>${fixture}<script>
    const menu = document.querySelector('.ia-mobile-menu');
    const scrim = document.querySelector('.ia-mobile-menu-scrim');
    const trigger = document.querySelector('.ia-menu-button');
    const setOpen = (open) => { menu.hidden = !open; scrim.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); };
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
    for (const destination of ["Overview", "Current Stock", "Stock Movements", "Kitchen Requests", "Purchase Orders", "Suppliers", "Materials", "Storage"]) {
      await expect(drawer.getByRole("button", { name: new RegExp(`^${destination}`) })).toBeVisible();
    }
    await expect(drawer.getByRole("button", { name: "Stock", exact: true })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Purchasing", exact: true })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Setup", exact: true })).toHaveCount(0);
    await expect(drawer.getByText("Kitchen Requests")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Reports" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Settings" })).toHaveCount(0);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    const box = await drawer.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    await drawer.getByRole("button", { name: "Current Stock" }).click();
    await expect(drawer).toBeHidden();
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
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    if (usesDrawer) {
      await page.getByRole("button", { name: "Open inventory navigation" }).click();
      await expect(page.locator(".ia-mobile-menu").getByRole("button", { name: "Purchase Orders" })).toBeVisible();
    }
  });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`Inventory I3 desktop sidebar fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await loadFixture(page, viewport.width, viewport.height);
    await expect(page.locator(".ia-sidebar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open inventory navigation" })).toBeHidden();
    const sidebar = await page.locator(".ia-sidebar").boundingBox();
    expect(sidebar?.width).toBeLessThanOrEqual(232);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
  });
}
