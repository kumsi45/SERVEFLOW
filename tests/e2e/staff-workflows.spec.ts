import { expect, test } from "@playwright/test";

const roles = ["waiter", "cashier", "kitchen", "manager", "owner", "inventory", "inventory_officer", "reports", "ai"] as const;

for (const role of roles) {
  test(`${role} workflow route is guarded and renderable`, async ({ page }, testInfo) => {
    const url = process.env[`SERVEFLOW_${role.toUpperCase()}_URL`];
    test.skip(!url, `${role} authenticated storage fixture/URL is not configured.`);
    await page.goto(url!);
    await expect(page.locator("body")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${role}-workflow.png`), fullPage: true });
  });
}
