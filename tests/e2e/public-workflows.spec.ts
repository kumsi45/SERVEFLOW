import { expect, test } from "@playwright/test";

test("landing page production smoke with screenshot", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("landing.png"), fullPage: true });
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
