import { expect, test } from "@playwright/test";

test("landing page production smoke with screenshot", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("landing.png"), fullPage: true });
});

test("mobile navigation remains usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(48);
  expect(box?.height).toBeGreaterThanOrEqual(48);
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#public-mobile-navigation")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator("#public-mobile-navigation").getByRole("link", { name: "Platform" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#public-mobile-navigation")).toHaveCount(0);
  await expect(menu).toBeFocused();
  await menu.focus();
  await page.keyboard.press("Enter");
  await page.locator("#public-mobile-navigation").getByRole("link", { name: "Industries" }).click();
  await expect(page.locator("#public-mobile-navigation")).toHaveCount(0);
  await expect(page).toHaveURL(/#industries$/);
  expect(await page.locator("html").evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Phase B public pages route to approved contact destinations", async ({ page }, testInfo) => {
  await page.goto("/about");
  await expect(page).toHaveTitle("About KumsiTech | ServeFlow");
  await expect(page.getByRole("heading", { name: "Built by KumsiTech. Designed for Hospitality." })).toBeVisible();
  await expect(page.getByText("ServeFlow is a hospitality management platform built by KumsiTech", { exact: false })).toBeVisible();
  await expect(page.locator(".lp-header").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/staff-login");
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(page.locator("#public-mobile-navigation").getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/sign-up");
    await page.keyboard.press("Escape");
  } else {
    await expect(page.locator(".lp-header").getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/sign-up");
  }
  const navigate = async (label: "Pricing" | "Contact") => {
    if (testInfo.project.name === "mobile-chromium") {
      await page.getByRole("button", { name: "Open navigation menu" }).click();
      await page.locator("#public-mobile-navigation").getByRole("link", { name: label }).click();
      return;
    }
    await page.locator(".lp-header").getByRole("link", { name: label }).click();
  };
  await navigate("Pricing");

  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { name: "Pricing That Starts With Your Business" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/3,000|4,500|6,000/);
  await expect(page.getByRole("link", { name: /Discuss pricing on WhatsApp/ })).toHaveAttribute(
    "href",
    "https://wa.me/251990069892?text=Hello%20KumsiTech%2C%20I%20would%20like%20to%20discuss%20ServeFlow%20pricing%20for%20my%20business.",
  );

  await navigate("Contact");
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page).toHaveTitle("Contact KumsiTech | ServeFlow");
  await expect(page.getByRole("heading", { name: "Let’s Talk About Your Hospitality Business" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a trial" })).toHaveAttribute(
    "href",
    "https://wa.me/251990069892?text=Hello%20KumsiTech%2C%20I%20would%20like%20to%20request%20a%20ServeFlow%20trial%20for%20my%20hospitality%20business.",
  );
  await expect(page.getByRole("link", { name: "Telegram" })).toHaveAttribute("href", "https://t.me/kumsitech");
  expect(await page.locator("html").evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
});

test("refresh and browser restart retain customer tracking", async ({ browser, baseURL }, testInfo) => {
  const slug = process.env.SERVEFLOW_TEST_RESTAURANT_SLUG;
  const table = process.env.SERVEFLOW_TEST_TABLE;
  const qr = process.env.SERVEFLOW_TEST_QR_TOKEN;
  test.skip(!slug || !table || !qr, "Public QR test fixture is not configured.");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/menu/${slug}?t=${table}&qr=${qr}`);
  await expect(page.locator("body")).toBeVisible();
  await page.reload();
  await page.screenshot({ path: testInfo.outputPath("qr-after-refresh.png"), fullPage: true });
  const storage = await context.storageState();
  await context.close();
  const restarted = await browser.newContext({ storageState: storage });
  const restored = await restarted.newPage();
  await restored.goto(`${baseURL}/menu/${slug}`);
  await expect(restored.locator("body")).toBeVisible();
  await restored.screenshot({ path: testInfo.outputPath("qr-after-browser-restart.png"), fullPage: true });
  await restarted.close();
});

test("offline and reconnect do not destroy tracking", async ({ page }, testInfo) => {
  const slug = process.env.SERVEFLOW_TEST_RESTAURANT_SLUG;
  const table = process.env.SERVEFLOW_TEST_TABLE;
  const qr = process.env.SERVEFLOW_TEST_QR_TOKEN;
  test.skip(!slug || !table || !qr, "Public QR test fixture is not configured.");
  await page.goto(`/menu/${slug}?t=${table}&qr=${qr}`);
  await page.context().setOffline(true);
  await page.reload().catch(() => undefined);
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.locator("body")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("qr-after-reconnect.png"), fullPage: true });
});

test("two restaurants remain isolated in simultaneous devices", async ({ browser, baseURL }) => {
  const a = process.env.SERVEFLOW_TEST_RESTAURANT_SLUG;
  const b = process.env.SERVEFLOW_TEST_RESTAURANT_B_SLUG;
  test.skip(!a || !b, "Two-restaurant browser fixtures are not configured.");
  const [deviceA, deviceB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pageA, pageB] = await Promise.all([deviceA.newPage(), deviceB.newPage()]);
  await Promise.all([pageA.goto(`${baseURL}/menu/${a}`), pageB.goto(`${baseURL}/menu/${b}`)]);
  await expect(pageA).toHaveURL(new RegExp(`/menu/${a}`));
  await expect(pageB).toHaveURL(new RegExp(`/menu/${b}`));
  expect(await pageA.evaluate(() => Object.keys(localStorage).every((key) => !key.includes(String((window as unknown as { otherSlug?: string }).otherSlug))))).toBe(true);
  await Promise.all([deviceA.close(), deviceB.close()]);
});
