import { expect, test, type Page } from "@playwright/test";

const sections = ["overview", "applications", "businesses", "users", "contracts", "payments", "notifications", "system-health", "diagnostics", "integrations", "backups", "audit-logs", "administrators", "security"] as const;
const widths = [320, 375, 768, 1024, 1440] as const;
const productionGuard = process.env.SERVEFLOW_EXPECT_PREVIEW_BLOCKED === "1";

async function isolatePreview(page: Page, baseURL: string | undefined) {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Platform preview checks require localhost.");
  const external: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) return route.continue();
    external.push(url.href);
    return route.abort("blockedbyclient");
  });
  return external;
}

test("production build does not expose the synthetic preview route", async ({ page, baseURL }) => {
  test.skip(!productionGuard, "Runs against the production preview server in the build verification step.");
  await isolatePreview(page, baseURL);
  await page.goto("/platform-admin/preview");
  await expect(page.getByText("Menu link not found.")).toBeVisible();
  await expect(page.getByText("PREVIEW — SYNTHETIC DATA")).toHaveCount(0);
});

for (const width of widths) {
  test(`local synthetic preview has no page overflow at ${width}px`, async ({ page, baseURL }, testInfo) => {
    test.skip(productionGuard, "Development preview only.");
    const external = await isolatePreview(page, baseURL);
    await page.setViewportSize({ width, height: width <= 375 ? 760 : 900 });
    await page.goto("/platform-admin/preview");
    await expect(page.getByText("PREVIEW — SYNTHETIC DATA")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(await page.evaluate(() => ({ document: document.documentElement.scrollWidth <= document.documentElement.clientWidth, body: document.body.scrollWidth <= document.body.clientWidth }))).toEqual({ document: true, body: true });
    expect(external).toEqual([]);
    if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`platform-admin-preview-${width}.png`), fullPage: true });
  });
}

test("all fourteen synthetic sections render without platform requests", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  const external = await isolatePreview(page, baseURL);
  for (const section of sections) {
    await page.goto(`/platform-admin/preview/${section}`);
    await expect(page.getByText("PREVIEW — SYNTHETIC DATA")).toBeVisible();
    await expect(page.locator('nav[aria-label="Platform administration"] a[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator("#pa-content h1")).toBeVisible();
  }
  expect(external).toEqual([]);
});

test("preview states, filters and mutation dialogs remain synthetic no-ops", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  const external = await isolatePreview(page, baseURL);
  await page.goto("/platform-admin/preview/businesses");
  await page.getByRole("button", { name: "Review classification" }).click();
  await expect(page.getByRole("dialog", { name: /confirm classification/i })).toBeVisible();
  await page.getByLabel("Decision reason").fill("Synthetic visual review");
  await page.getByLabel(/I reviewed the target/).check();
  await page.getByRole("button", { name: "Preview decision — no changes" }).click();
  await expect(page.getByText(/synthetic decision was not saved/i)).toBeVisible();

  await page.getByLabel("Display state").selectOption("loading");
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Loading authorized platform information" })).toBeVisible();
  await page.getByLabel("Display state").selectOption("error");
  await expect(page.getByRole("alert")).toContainText("Synthetic preview error");
  await page.getByLabel("Display state").selectOption("empty");
  await expect(page.getByText("No records match this query.")).toBeVisible();
  expect(external).toEqual([]);
});

test("mobile drawer and keyboard focus controls remain accessible", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  await isolatePreview(page, baseURL);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/platform-admin/preview/users");
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pa-content")).toBeFocused();
  await page.getByRole("button", { name: "Open platform navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Platform navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close platform navigation" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Platform navigation" })).toHaveCount(0);
  await page.getByRole("button", { name: "Invitation intents" }).click();
  await expect(page.getByRole("region", { name: "Users & Invitations records" })).toBeVisible();
});
