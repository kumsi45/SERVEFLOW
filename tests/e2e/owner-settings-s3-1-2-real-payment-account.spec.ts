import { expect, test, type Page } from "@playwright/test";

const restaurantId = "11111111-1111-4111-8111-111111111111";
const methods = [
  { id: "cash", restaurant_id: restaurantId, method_code: "cash", display_name: "Cash", enabled: true, is_default: true, display_order: 10, cash_change_limit: null },
  { id: "telebirr", restaurant_id: restaurantId, method_code: "telebirr", display_name: "Telebirr", enabled: true, is_default: false, display_order: 20, cash_change_limit: null },
  { id: "cbe", restaurant_id: restaurantId, method_code: "cbe_birr", display_name: "CBE Birr", enabled: false, is_default: false, display_order: 30, cash_change_limit: null },
  { id: "card", restaurant_id: restaurantId, method_code: "credit_card", display_name: "Credit Card", enabled: false, is_default: false, display_order: 40, cash_change_limit: null },
  { id: "qr", restaurant_id: restaurantId, method_code: "qr", display_name: "QR", enabled: false, is_default: false, display_order: 50, cash_change_limit: null },
];

async function mockPaymentReads(page: Page, saved?: { account?: Record<string, unknown> }) {
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop();
    if (table === "restaurants") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ payment_policy: "pay_before_kitchen", vat_enabled: false, vat_percentage: 0, service_charge_enabled: false, service_charge_percentage: 0 }) });
    if (table === "business_payment_methods") return route.fulfill({ contentType: "application/json", body: JSON.stringify(methods) });
    if (table === "business_payment_accounts") {
      if (route.request().method() !== "GET") saved && (saved.account = JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({}) });
  });
}

test("real Owner Settings saves a Telebirr account through the tenant-scoped account service", async ({ page }) => {
  const saved: { account?: Record<string, unknown> } = {};
  await page.addInitScript(() => Object.defineProperty(window.crypto, "randomUUID", { value: undefined, configurable: true }));
  await mockPaymentReads(page, saved);
  await page.goto("/tests/e2e/fixtures/owner-settings-payment-account.html");
  await page.getByRole("button", { name: "Payments" }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  const dialog = page.getByRole("dialog", { name: "Add payment account" });
  await dialog.getByLabel("Payment Method").selectOption("telebirr");
  await dialog.getByLabel("Telebirr phone number").fill("0912345678");
  await dialog.getByRole("button", { name: "Save account" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("0912345678")).toBeVisible();
  expect(saved.account).toMatchObject({ restaurant_id: restaurantId, payment_method_id: "telebirr", phone_number: "0912345678", account_number: null });
});

for (const width of [1440, 430, 390, 360]) {
  test(`real Owner Settings Add account opens on ${width}px without crypto.randomUUID`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => Object.defineProperty(window.crypto, "randomUUID", { value: undefined, configurable: true }));
    await mockPaymentReads(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/tests/e2e/fixtures/owner-settings-payment-account.html");
    await page.getByRole("button", { name: "Payments" }).click();
    const add = page.getByRole("button", { name: "Add account" });
    await expect(add).toBeVisible();
    const box = await add.boundingBox();
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent?.includes("Add account"), { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 })).toBe(true);
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add payment account" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option", { name: "Cash" })).toHaveCount(0);
    await expect(dialog.getByRole("option", { name: "Credit Card" })).toHaveCount(0);
    await expect(dialog.getByRole("option", { name: "QR" })).toHaveCount(0);
    await dialog.getByLabel("Payment Method").selectOption("telebirr");
    await expect(dialog.getByText("Telebirr phone number")).toBeVisible();
    await expect(dialog.getByText("Account number", { exact: true })).toHaveCount(0);
    await dialog.getByLabel("Payment Method").selectOption("cbe");
    await expect(dialog.getByText("CBE Birr account number")).toBeVisible();
    await expect(dialog.getByText("Telebirr phone number", { exact: true })).toHaveCount(0);
    await dialog.getByLabel("Payment Method").selectOption("telebirr");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
