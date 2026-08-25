import { expect, test, type Page } from "@playwright/test";

const restaurant = {
  restaurant_id: "11111111-1111-4111-8111-111111111111",
  restaurant_slug: "grand-royal",
  restaurant_name: "Grand Royal",
  logo_url: null,
  currency_code: "ETB",
  currency_symbol: "Br",
  locale: "en-ET",
  total_tables: 12,
  available_tables: 5,
  occupied_tables: 7,
  other_tables: 0,
};
const waiter = {
  staffId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  displayName: "Test Waiter",
  employeeId: "W0001",
};

function fakeJwt(userId = waiter.userId) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: userId,
    role: "authenticated",
  })}.test-signature`;
}

async function mockTerminal(page: Page, terminal = restaurant) {
  let directoryRequests = 0;
  await page.route("**/rest/v1/rpc/get_waiter_terminal_context", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([terminal]) }));
  await page.route("**/rest/v1/rpc/get_restaurant_terminal_staff", (route) => {
    directoryRequests += 1;
    return route.fulfill({ status: 500, body: "directory must not be requested" });
  });
  return () => directoryRequests;
}

test("waiter entry directly uses masked touch and keyboard PIN input without a directory", async ({ page }) => {
  const directoryRequests = await mockTerminal(page);
  let loginRequests = 0;
  await page.route("**/functions/v1/waiter-pin-login", async (route) => {
    loginRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "PIN not recognized. Try again.", code: "invalid_pin" }),
    });
  });

  await page.goto("/waiter/grand-royal");
  await expect(page.getByText("Waiter terminal")).toBeVisible();
  expect(await page.locator(".wlt-table-status").evaluateAll((nodes) =>
    nodes.filter((node) => {
      const style = window.getComputedStyle(node);
      return node.textContent?.includes("12") && style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().height > 0;
    }).length,
  )).toBe(1);
  await expect(page.getByRole("heading", { name: "Enter PIN" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Waiter Login" })).toHaveCount(0);
  await expect(page.locator(".wlt-waiter-card, .wlt-grid, .wlt-search")).toHaveCount(0);
  expect(directoryRequests()).toBe(0);

  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.locator(".wlt-pin-indicator .is-filled")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete last digit" }).click();
  await expect(page.locator(".wlt-pin-indicator .is-filled")).toHaveCount(1);
  await page.keyboard.type("234");
  await expect(page.locator(".wlt-pin-indicator .is-filled")).toHaveCount(4);
  await expect(page.locator(".wlt-verifying")).toHaveText("Verifying…");

  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("PIN not recognized. Try again.");
  await expect(page.getByRole("heading", { name: "Enter PIN" })).toBeVisible();
  expect(loginRequests).toBe(1);
  expect(directoryRequests()).toBe(0);
});

test("rate limiting stays concise, clears the PIN, and leaves the terminal ready", async ({ page }) => {
  await mockTerminal(page);
  await page.route("**/functions/v1/waiter-pin-login", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: "Too many attempts. Try again shortly.", code: "throttled" }),
    });
  });

  await page.goto("/waiter/grand-royal");
  await page.keyboard.type("1234");
  await expect(page.getByText("Verifying…")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Too many attempts. Try again shortly or contact a manager.");
  await expect(page.locator(".wlt-pin-indicator .is-filled")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeEnabled();
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
  await page.keyboard.type("1234");
  await expect(page.getByText("My Tables")).toBeVisible();
  expect(page.url()).toContain("/waiter/dashboard");
  expect(documentRequests).toBe(initialDocumentRequests);
  expect(await page.evaluate(() => (window as Window & { __phaseA1Document?: string }).__phaseA1Document)).toBe("warm-shell");
  expect(directoryRequests()).toBe(0);

  const logoutStartedAt = Date.now();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("heading", { name: "Enter PIN" })).toBeVisible();
  expect(Date.now() - logoutStartedAt).toBeLessThan(800);
  expect(page.url()).toContain("/waiter/grand-royal");
});

test("shared tablet clears waiter A before waiter B can establish a session", async ({ page }) => {
  await mockTerminal(page);
  const waiterA = { ...waiter, displayName: "Waiter Alpha" };
  const waiterB = {
    staffId: "44444444-4444-4444-8444-444444444444",
    userId: "55555555-5555-4555-8555-555555555555",
    displayName: "Waiter Beta",
    employeeId: "W0002",
  };
  const accessTokens = [fakeJwt(waiter.userId), fakeJwt(waiterB.userId)];
  let loginIndex = 0;
  await page.route("**/functions/v1/waiter-pin-login", async (route) => {
    const requestBody = route.request().postData() ?? "";
    const expectedPin = loginIndex === 0 ? "1111" : "2222";
    expect(requestBody).toContain(`\"pin\":\"${expectedPin}\"`);
    const activeWaiter = loginIndex === 0 ? waiterA : waiterB;
    const accessToken = accessTokens[loginIndex++];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { accessToken, refreshToken: `refresh-${activeWaiter.userId}`, expiresAt: Math.floor(Date.now() / 1000) + 3600 },
        waiter: activeWaiter,
        restaurant: {
          id: restaurant.restaurant_id,
          slug: restaurant.restaurant_slug,
          name: restaurant.restaurant_name,
          logoUrl: null,
        },
      }),
    });
  });
  await page.route("**/auth/v1/user", (route) => {
    const authorization = route.request().headers().authorization ?? "";
    const activeWaiter = authorization.includes(accessTokens[1]) ? waiterB : waiterA;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: activeWaiter.userId, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }),
    });
  });
  await page.route("**/rest/v1/rpc/get_waiter_dashboard_tables", (route) => {
    const authorization = route.request().headers().authorization ?? "";
    const activeWaiter = authorization.includes(accessTokens[1]) ? waiterB : waiterA;
    const tableNumber = activeWaiter === waiterB ? 22 : 21;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        restaurant_id: restaurant.restaurant_id,
        restaurant_slug: restaurant.restaurant_slug,
        restaurant_name: restaurant.restaurant_name,
        restaurant_logo_url: null,
        waiter_staff_id: activeWaiter.staffId,
        waiter_display_name: activeWaiter.displayName,
        current_shift: "Current Shift",
        assignment_mode: "assigned_tables",
        table_id: `table-${tableNumber}`,
        table_number: tableNumber,
        table_label: null,
        seats: 4,
        table_active: true,
        assigned_waiter_staff_id: activeWaiter.staffId,
        assigned_waiter_name: activeWaiter.displayName,
        table_status: "available",
        active_order_id: null,
        active_order_status: null,
        active_order_source: null,
        qr_customer_name: null,
        active_order_created_at: null,
      }]),
    });
  });
  await page.route("**/rest/v1/rpc/record_waiter_logout", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/auth/v1/logout*", (route) => route.fulfill({ status: 204, body: "" }));

  await page.goto("/waiter/grand-royal");
  await page.keyboard.type("1111");
  await expect(page.locator(".a2-brand strong")).toHaveText("Alpha");
  await expect(page.getByRole("button", { name: "Table 21, Free" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Table 22, Free" })).toHaveCount(0);
  const firstStorage = await page.evaluate(() =>
    [...Object.values(sessionStorage), ...Object.values(localStorage)].join("\n"));
  expect(firstStorage).not.toContain('"pin":"1111"');

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("heading", { name: "Enter PIN" })).toBeVisible();
  await page.keyboard.type("2222");
  await expect(page.locator(".a2-brand strong")).toHaveText("Beta");
  await expect(page.getByRole("button", { name: "Table 22, Free" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Table 21, Free" })).toHaveCount(0);
  const secondStorage = await page.evaluate(() =>
    [...Object.values(sessionStorage), ...Object.values(localStorage)].join("\n"));
  expect(secondStorage).not.toContain('"pin":"1111"');
  expect(secondStorage).not.toContain('"pin":"2222"');
  expect(secondStorage).not.toContain(waiterA.displayName);
  expect(secondStorage).toContain(waiterB.displayName);
});

test("an in-flight PIN response cannot establish identity after leaving the terminal", async ({ page }) => {
  await mockTerminal(page);
  await page.route("**/functions/v1/waiter-pin-login", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "invalid_pin" }) }).catch(() => undefined);
  });

  await page.goto("/waiter/grand-royal");
  await page.keyboard.type("9999");
  await page.evaluate(() => {
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(500);
  const waiterState = await page.evaluate(() => ({
    session: sessionStorage.getItem("serveflow.waiter.session.v1"),
    auth: Object.keys(sessionStorage).filter((key) => key.startsWith("serveflow-waiter-auth:")),
  }));
  expect(waiterState.session).toBeNull();
  expect(waiterState.auth).toEqual([]);
});

test("entry and keypad remain fully visible at every required terminal size", async ({ page }) => {
  test.setTimeout(90_000);
  await mockTerminal(page);
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/waiter/grand-royal");
    await expect(page.getByText("Waiter terminal")).toBeVisible();
    await expect(page.getByText("ServeFlow")).toBeVisible();
    const geometry = await page.locator(".wlt-pin-panel").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        viewportHeight: window.innerHeight,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        verticalOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
      };
    });
    const smallestKey = await page.locator(".wlt-pin-pad button").evaluateAll((buttons) =>
      Math.min(...buttons.map((button) => Math.min(button.getBoundingClientRect().width, button.getBoundingClientRect().height))));
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    expect(geometry.width).toBeLessThanOrEqual(440);
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.verticalOverflow).toBe(false);
    expect(smallestKey).toBeGreaterThanOrEqual(44);
    expect(await page.locator(".wlt-table-status").evaluateAll((nodes) =>
      nodes.filter((node) => {
        const style = window.getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().height > 0;
      }).length,
    )).toBe(1);
    if (viewport.width > 620) await expect(page.locator(".wlt-terminal-context")).toBeVisible();
    else await expect(page.locator(".wlt-terminal-context")).toBeHidden();
  }
});

test("pre-auth terminal supports long tenant identity without private operational data", async ({ page }) => {
  const longName = "The International Riverside Hotel Restaurant and Terrace";
  await mockTerminal(page, {
    ...restaurant,
    restaurant_name: longName,
    logo_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48' fill='%23176b47'/%3E%3C/svg%3E",
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/waiter/grand-royal");

  await expect(page.locator(".wlt-tenant-identity img")).toBeVisible();
  await expect(page.locator(".wlt-tenant-name")).toHaveAttribute("title", longName);
  await expect(page.getByText("Test Waiter")).toHaveCount(0);
  await expect(page.getByText(/Table 21|customer|payment|order total/i)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
