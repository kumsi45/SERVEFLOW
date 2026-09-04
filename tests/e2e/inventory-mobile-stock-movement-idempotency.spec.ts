import { expect, test } from "@playwright/test";

const viewports = [
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`Stock In and Stock Out can create idempotency keys without randomUUID at ${viewport.width}px`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "randomUUID", {
        configurable: true,
        value: undefined,
      });
    });
    await page.setViewportSize(viewport);
    await page.goto("/");

    const keys = await page.evaluate(async () => {
      const { createBrowserUuid } = await import("/src/core/browser/createBrowserUuid.ts");
      return {
        stockIn: createBrowserUuid(),
        stockOut: createBrowserUuid(),
      };
    });

    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(keys.stockIn).toMatch(uuidV4);
    expect(keys.stockOut).toMatch(uuidV4);
    expect(keys.stockIn).not.toBe(keys.stockOut);
  });
}
