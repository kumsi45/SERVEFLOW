import { expect, test } from "@playwright/test";

const harness = "/tests/e2e/fixtures/manager-copilot-harness.html";

test("notification click opens visible context and uses the shared send pipeline", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?delay=650`);
  await page.getByTestId("live-update").click();

  await expect(page.getByRole("dialog", { name: "ServeFlow Copilot" })).toBeVisible();
  await expect(page.locator(".mcp-title b")).toHaveText("Staff");
  await expect(page.locator(".mcp-update-context")).toContainText("Staff activity changed");
  await expect(page.locator(".mcp-message.manager")).toContainText("What changed?");
  await expect(page.locator(".mcp-message.loading")).toContainText("Thinking...");
  await expect(page.locator(".mcp-conversation")).not.toBeEmpty();
  await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toContainText(
    "Authorized answer for: What changed?",
  );
  await expect(page.locator(".mcp-panel")).not.toContainText("private transport detail");
});

test("mobile Send stays enabled during snapshot loading and renders an optimistic question", async ({ page }) => {
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${harness}?delay=1200`);
    await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
    const input = page.getByPlaceholder("Ask about current operations…");
    const send = page.getByRole("button", { name: "Send question" });
    await expect(page.locator(".mcp-message.loading")).toContainText("Loading current operations...");
    await input.fill("Who is available?");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator(".mcp-message.manager")).toContainText("Who is available?");
    await expect(page.locator(".mcp-message.loading")).toContainText("Thinking...");
    await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toContainText(
      "Authorized answer for: Who is available?",
    );
    await expect(page.locator(".mcp-conversation")).not.toBeEmpty();
  }
});

test("development diagnostic traces the real manual send path at mobile widths", async ({ page }) => {
  for (const width of [360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${harness}?delay=80`);
    await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
    await page.getByRole("textbox", { name: "Ask ServeFlow Copilot" }).fill("What needs attention?");
    await page.getByRole("button", { name: "Send question" }).click();
    await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toBeVisible();
    await page.getByRole("button", { name: "Debug" }).click();
    const diagnostic = page.getByRole("region", { name: "Copilot mobile diagnostic" });
    await expect(diagnostic).toBeVisible();
    await expect(diagnostic).toContainText("Build modeDevelopment");
    await expect(diagnostic).toContainText("Authenticated");
    await expect(diagnostic).toContainText("Restaurant IDPresent");
    await expect(diagnostic).toContainText("Send tapped");
    await expect(diagnostic).toContainText("Investigator completed");
    await expect(diagnostic).toContainText("Render completed");
    await expect(diagnostic).not.toContainText("tenant-a");
    await expect(diagnostic).not.toContainText("private transport detail");
    await expect(diagnostic).toHaveCSS("overflow", "hidden");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(diagnostic).toHaveCount(0);
  }
});

test("visual viewport resize keeps Send tappable and close-reopen remains functional", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?delay=350`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
  const input = page.getByPlaceholder("Ask about current operations…");
  await input.fill("What needs attention?");
  await page.setViewportSize({ width: 390, height: 520 });
  const send = page.getByRole("button", { name: "Send question" });
  await expect(send).toBeVisible();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toBeVisible();
  await page.getByRole("button", { name: "Close Copilot" }).click();
  await expect(page.getByRole("dialog", { name: "ServeFlow Copilot" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
  await input.fill("Any complaints?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer for: Any complaints?" })).toBeVisible();
});

test("failed answer shows a safe Retry and succeeds without duplicating the question", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?delay=500&failFirst=1`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
  await page.getByPlaceholder("Ask about current operations…").fill("Who is overloaded?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn't load this answer. Try again.");
  await expect(page.locator(".mcp-panel")).not.toContainText("private transport detail");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toBeVisible();
  await expect(page.locator(".mcp-message.manager")).toHaveCount(1);
});

test("tablet and desktop preserve notification and manual send behavior", async ({ page }) => {
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1366, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${harness}?delay=100`);
    await page.getByTestId("live-update").click();
    await expect(page.locator(".mcp-update-context")).toBeVisible();
    await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toBeVisible();
    await page.getByPlaceholder("Ask about current operations…").fill("Who is available?");
    await page.getByRole("button", { name: "Send question" }).click();
    await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer for: Who is available?" })).toBeVisible();
  }
});
