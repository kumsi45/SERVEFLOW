import { expect, test } from "@playwright/test";

const paths = ["/", "/about", "/pricing", "/contact", "/privacy", "/terms", "/cookies", "/acceptable-use"];
const key = "serveflow.public-theme";
const themeButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^Switch to (light|dark) mode$/ });

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL || !["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname)) throw new Error("Local public theme checks only.");
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
});

test("keyboard switching persists an explicit choice across all public routes and reloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await themeButton(page).focus();
  await expect(themeButton(page)).toHaveCSS("outline-width", "3px");
  await page.keyboard.press("Enter");
  await expect(themeButton(page)).toHaveAccessibleName("Switch to light mode");
  await expect(themeButton(page)).toHaveCSS("outline-width", "3px");
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe("dark");
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-public-theme", "dark");
    await expect(themeButton(page)).toHaveAccessibleName("Switch to light mode");
  }
  await page.reload();
  await themeButton(page).focus();
  await page.keyboard.press("Space");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-public-theme", "light");
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe("light");
});

test("system preference follows live changes until an explicit theme is chosen", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/privacy");
  await expect(themeButton(page)).toHaveAccessibleName("Switch to light mode");
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBeNull();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(themeButton(page)).toHaveAccessibleName("Switch to dark mode");
  await themeButton(page).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-public-theme", "dark");
});

test("theme initializes before the application loads and does not theme sign-in", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(storageKey => localStorage.setItem(storageKey, "dark"), key);
  await page.route("**/src/**", route => route.abort());
  await page.goto("/cookies");
  await expect(page.locator("html")).toHaveAttribute("data-public-theme", "dark");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(16, 31, 27)");
  await page.goto("/staff-login");
  await expect(page.locator("html")).not.toHaveAttribute("data-public-theme");
  await expect(page.locator("html")).not.toHaveCSS("color-scheme", "dark");
});

test("denied theme preference storage does not prevent theme switching", async ({ page }) => {
  await page.addInitScript(storageKey => {
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function (itemKey) {
      if (itemKey === storageKey) throw new DOMException("Preference unavailable", "SecurityError");
      return originalGet.call(this, itemKey);
    };
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === storageKey) throw new DOMException("Preference unavailable", "SecurityError");
      return originalSet.call(this, itemKey, value);
    };
  }, key);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/about");
  await expect(themeButton(page)).toHaveAccessibleName("Switch to light mode");
  await themeButton(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-public-theme", "light");
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 375, 390, 430, 561, 768, 1024, 1440]) {
    test(`${theme} public pages, header controls and color contrast at ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      for (const path of paths) {
        await page.goto(path);
        await expect(themeButton(page)).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-public-theme", theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
        const button = await themeButton(page).boundingBox();
        expect(button!.width).toBeGreaterThanOrEqual(44);
        expect(button!.height).toBeGreaterThanOrEqual(44);
        if (width <= 900) {
          const signIn = await page.locator(".lp-mobile-signin").boundingBox();
          const menu = await page.getByRole("button", { name: "Open navigation menu" }).boundingBox();
          expect(signIn!.x + signIn!.width).toBeLessThanOrEqual(button!.x);
          expect(button!.x + button!.width).toBeLessThanOrEqual(menu!.x);
          expect(Math.abs(button!.y - menu!.y)).toBeLessThanOrEqual(4);
          expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
          await page.getByRole("button", { name: "Open navigation menu" }).click();
          await expect(page.locator("#public-mobile-navigation")).toBeVisible();
        }
        // Measure actual computed foreground/background pairs on solid surfaces.
        // Gradients, images, antialiasing and all possible interaction states need visual review too.
        const ratios = await page.locator(".lp-theme-toggle, .lp-footer-group a, .lp-footer-tagline, .lp-legal-notice p, .lp-legal-notice strong, .lp-legal-sections p, .lp-capability-card p, .lp-contact-primary p, .lp-contact-secondary p, #public-mobile-navigation a").evaluateAll(nodes => {
          const luminance = (color: string) => {
            const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
            return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
          };
          return nodes.filter(node => (node as HTMLElement).offsetHeight > 0).map(node => {
            let surface: Element | null = node;
            while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
            const foreground = luminance(getComputedStyle(node).color);
            const background = luminance(getComputedStyle(surface!).backgroundColor);
            return { label: node.textContent?.slice(0, 35) || "theme icon", ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
          });
        });
        for (const { label, ratio } of ratios) expect(ratio, `${path}: ${label}`).toBeGreaterThanOrEqual(4.5);
      }
      if (theme === "dark" && [320, 1440].includes(width)) {
        await page.screenshot({ path: testInfo.outputPath(`dark-public-${width}.png`), fullPage: true });
      }
    });
  }
}
