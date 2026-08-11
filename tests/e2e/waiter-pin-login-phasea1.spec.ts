import { expect, test, type Page } from "@playwright/test";

const restaurant = {
  restaurant_id: "11111111-1111-4111-8111-111111111111",
  restaurant_slug: "grand-royal",
  restaurant_name: "Grand Royal",
  logo_url: null,
  currency_code: "ETB",
  currency_symbol: "Br",
  locale: "en-ET",
};
const waiter = {
  staffId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  displayName: "Test Waiter",
  employeeId: "W0001",
};

function fakeJwt() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: waiter.userId,
    role: "authenticated",
  })}.test-signature`;
}

async function mockTerminal(page: Page) {
  let directoryRequests = 0;
  await page.route("**/rest/v1/rpc/get_waiter_terminal_context", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([restaurant]) }));
  await page.route("**/rest/v1/rpc/get_restaurant_terminal_staff", (route) => {
    directoryRequests += 1;
    return route.fulfill({ status: 500, body: "directory must not be requested" });
  });
  return () => directoryRequests;
}

test("waiter entry uses masked touch and keyboard PIN input without a directory", async ({ page }) => {
  const directoryRequests = await mockTerminal(page);
  let loginRequests = 0;
  await page.route("**/functions/v1/waiter-pin-login", async (route) => {
    loginRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "PIN not recognized. Try again.", code: "invalid_pin" }),
    });
  });

  await page.goto("/waiter/grand-royal");
  await expect(page.getByRole("heading", { name: "Waiter Ordering Terminal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Waiter Login" })).toBeVisible();
  await expect(page.locator(".wlt-waiter-card, .wlt-grid, .wlt-search")).toHaveCount(0);
  expect(directoryRequests()).toBe(0);

  await page.getByRole("button", { name: "Waiter Login" }).click();
  await expect(page.getByRole("heading", { name: "Enter PIN" })).toBeVisible();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.locator(".wlt-pin-indicator .is-filled")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete last digit" }).click();
  await expect(page.locator(".wlt-pin-indicator .is-filled")).toHaveCount(1);
  await page.keyboard.type("234");
  await expect(page.locator(".wlt-pin-indicator .is-filled")).toHaveCount(4);

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("PIN not recognized. Try again.");
  await expect(page.getByRole("heading", { name: "Enter PIN" })).toBeVisible();
  expect(loginRequests).toBe(1);
  expect(directoryRequests()).toBe(0);
});

test("correct PIN opens existing Tables without reload and logout clears back immediately", async ({ page }) => {
  const directoryRequests = await mockTerminal(page);
  const accessToken = fakeJwt();
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests += 1;
  });

  await page.route("**/functions/v1/waiter-pin-login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { accessToken, refreshToken: "test-refresh-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 },
        waiter,
        restaurant: {
          id: restaurant.restaurant_id,
          slug: restaurant.restaurant_slug,
          name: restaurant.restaurant_name,
          logoUrl: null,
          currencyCode: "ETB",
          currencySymbol: "Br",
          locale: "en-ET",
        },
        elapsedMs: 80,
      }),
    }));
  await page.route("**/auth/v1/user", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: waiter.userId, aud: "authenticated", role: "authenticated", email: "hidden@internal.invalid", app_metadata: {}, user_metadata: {} }),
    }));
  await page.route("**/rest/v1/rpc/get_waiter_dashboard_tables", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/rest/v1/rpc/record_waiter_logout", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/auth/v1/logout*", (route) => route.fulfill({ status: 204, body: "" }));

  await page.goto("/waiter/grand-royal");
  const initialDocumentRequests = documentRequests;
  await page.evaluate(() => { (window as Window & { __phaseA1Document?: string }).__phaseA1Document = "warm-shell"; });
  await page.getByRole("button", { name: "Waiter Login" }).click();
  await page.keyboard.type("1234");
  await page.keyboard.press("Enter");
  await expect(page.getByText("My Tables")).toBeVisible();
  expect(page.url()).toContain("/waiter/dashboard");
  expect(documentRequests).toBe(initialDocumentRequests);
  expect(await page.evaluate(() => (window as Window & { __phaseA1Document?: string }).__phaseA1Document)).toBe("warm-shell");
  expect(directoryRequests()).toBe(0);

  const logoutStartedAt = Date.now();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("button", { name: "Waiter Login" })).toBeVisible();
  expect(Date.now() - logoutStartedAt).toBeLessThan(500);
  expect(page.url()).toContain("/waiter/grand-royal");
});

test("entry and keypad remain fully visible at required terminal sizes", async ({ page }) => {
  await mockTerminal(page);
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/waiter/grand-royal");
    await page.getByRole("button", { name: "Waiter Login" }).click();
    const geometry = await page.locator(".wlt-pin-panel").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    expect(geometry.horizontalOverflow).toBe(false);
  }
});
