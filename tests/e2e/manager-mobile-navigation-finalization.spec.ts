import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/manager/styles/managerLayout.css"),
  "utf8",
);

const primary = [
  ["dashboard", "Dashboard", "/manager/dashboard"],
  ["tables", "Operations", "/manager/tables"],
  ["kitchen", "Kitchen", "/manager/kitchen"],
  ["staff", "Staff", "/manager/staff"],
] as const;
const secondary = [
  ["customers", "Guests", "/manager/customers"],
  ["reports", "Reports", "/manager/reports"],
  ["intelligence", "Business Intelligence", "/manager/intelligence"],
  ["recipes", "Recipes", "/manager/recipes"],
  ["menu", "Menu", "/manager/menu"],
  ["inventory", "Inventory", "/manager/inventory"],
] as const;
const desktop = [
  ["dashboard", "Dashboard", "/manager/dashboard"],
  ["tables", "Live Operations", "/manager/tables"],
  ["kitchen", "Kitchen", "/manager/kitchen"],
  ["staff", "Staff", "/manager/staff"],
  ...secondary,
] as const;

function links(
  items: ReadonlyArray<readonly [string, string, string]>,
  active: string,
) {
  return items
    .map(
      ([key, label, href]) =>
        `<a data-key="${key}" class="${key === active ? "is-active" : ""}" href="${href}"><span class="ml-nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg></span>${label}</a>`,
    )
    .join("");
}

function fixture(active = "inventory") {
  return `<main class="ml-shell">
    <aside class="ml-sidebar ml-desktop-sidebar" aria-label="Manager navigation"><div class="ml-sidebar-brand">ServeFlow</div><nav class="ml-sidebar-nav">${links(desktop, active)}</nav></aside>
    <aside id="manager-mobile-navigation" class="ml-mobile-drawer" role="dialog" aria-modal="true" aria-label="Secondary Manager navigation" hidden tabindex="-1">
      <div class="ml-mobile-drawer-heading"><strong>ServeFlow</strong><button aria-label="Close navigation">×</button></div>
      <nav class="ml-mobile-drawer-nav">${links(secondary, active)}</nav>
      <div class="ml-mobile-account"><div class="ml-sidebar-profile"><span>TM</span><div><strong>Test Manager</strong><small>General Manager</small></div></div><button>Logout</button></div>
    </aside>
    <button class="ml-sidebar-scrim" aria-label="Close navigation" hidden></button>
    <section class="ml-workspace"><header class="ml-header"><div class="ml-mobile-brand"><strong>ServeFlow</strong></div><div class="ml-header-left">Tenant</div><div class="ml-header-meta"><div class="ml-clock">Clock</div><button class="ml-menu-button" aria-label="Open navigation">Menu</button><div class="ml-profile">Manager</div></div></header>
      <div class="ml-content"><div style="min-height:1100px">Manager content</div></div>
      <nav class="ml-bottom-nav" aria-label="Primary mobile navigation">${links(primary, active)}</nav>
    </section>
  </main>
  <script>
    const trigger = document.querySelector('.ml-menu-button');
    const drawer = document.querySelector('.ml-mobile-drawer');
    const scrim = document.querySelector('.ml-sidebar-scrim');
    const close = drawer.querySelector('[aria-label="Close navigation"]');
    const hide = () => { drawer.hidden = true; drawer.classList.remove('is-open'); scrim.hidden = true; trigger.focus(); };
    trigger.addEventListener('click', () => { drawer.hidden = false; drawer.classList.add('is-open'); scrim.hidden = false; close.focus(); });
    close.addEventListener('click', hide);
    scrim.addEventListener('click', hide);
    drawer.querySelectorAll('a').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); hide(); }));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !drawer.hidden) hide(); });
  </script>`;
}

test("phone and portrait-tablet Manager navigation uses a disjoint bottom bar and drawer", async ({
  page,
}) => {
  for (const width of [360, 375, 390, 412, 430, 768, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(
      `<style>[hidden]{display:none!important}html,body{margin:0}${styles}</style>${fixture()}`,
    );

    const bottom = page.getByRole("navigation", {
      name: "Primary mobile navigation",
    });
    await expect(bottom).toBeVisible();
    await expect(bottom.getByRole("link")).toHaveCount(4);
    await expect(bottom.locator(".is-active")).toHaveCount(0);
    await expect(page.locator(".ml-desktop-sidebar")).toBeHidden();

    const trigger = page.getByRole("button", { name: "Open navigation" });
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox!.x + triggerBox!.width).toBeGreaterThan(width - 64);
    expect(Math.min(triggerBox!.width, triggerBox!.height)).toBeGreaterThanOrEqual(40);
    await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>(".ml-mobile-drawer")!;
      drawer.hidden = false;
      drawer.classList.add("is-open");
      drawer.querySelector<HTMLElement>('[aria-label="Close navigation"]')!.focus();
    });

    const drawer = page.getByRole("dialog", {
      name: "Secondary Manager navigation",
    });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link")).toHaveCount(6);
    await expect(drawer.locator(".is-active")).toHaveText("Inventory");
    await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeFocused();
    for (const label of [
      "Guests",
      "Reports",
      "Business Intelligence",
      "Recipes",
      "Menu",
      "Inventory",
    ]) {
      await expect(drawer.getByRole("link", { name: label })).toBeVisible();
    }
    for (const duplicate of ["Dashboard", "Live Operations", "Kitchen", "Staff"]) {
      await expect(drawer.getByRole("link", { name: duplicate, exact: true })).toHaveCount(0);
    }

    await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>(".ml-mobile-drawer")!;
      drawer.hidden = true;
      drawer.classList.remove("is-open");
      document.querySelector<HTMLElement>(".ml-menu-button")!.focus();
    });
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const contentPadding = await page
      .locator(".ml-content")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
    expect(contentPadding).toBeGreaterThanOrEqual(92);
  }
});

test("desktop keeps the complete sidebar without mobile navigation conflicts", async ({
  page,
}) => {
  for (const width of [1024, 1280, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(
      `<style>[hidden]{display:none!important}html,body{margin:0}${styles}</style>${fixture("dashboard")}`,
    );
    const sidebar = page.getByRole("complementary", { name: "Manager navigation" });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link")).toHaveCount(10);
    await expect(sidebar.locator(".is-active")).toHaveText("Dashboard");
    await expect(page.getByRole("navigation", { name: "Primary mobile navigation" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("primary routes activate only their matching bottom destination", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    `<style>[hidden]{display:none!important}html,body{margin:0}${styles}</style>${fixture("dashboard")}`,
  );
  const bottom = page.getByRole("navigation", {
    name: "Primary mobile navigation",
  });
  await expect(bottom.locator(".is-active")).toHaveText("Dashboard");
  await page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>(".ml-mobile-drawer")!;
    drawer.hidden = false;
    drawer.classList.add("is-open");
  });
  await expect(
    page
      .getByRole("dialog", { name: "Secondary Manager navigation" })
      .locator(".is-active"),
  ).toHaveCount(0);
});
