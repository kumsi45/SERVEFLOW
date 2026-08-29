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
  await expect(page.locator(".mcp-header")).not.toContainText("Debug");
  await expect(page.getByRole("region", { name: "Copilot mobile diagnostic" })).toHaveCount(0);
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
    const header = page.locator(".mcp-header");
    const close = page.getByRole("button", { name: "Close Copilot" });
    await expect(header).not.toContainText("Debug");
    await expect(header).not.toContainText("Copilot diagnostic");
    const closeBox = await close.boundingBox();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);
    expect(await header.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const input = page.getByRole("textbox", { name: "Ask ServeFlow Copilot" });
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

test("normal Manager header has no diagnostic access at mobile widths", async ({ page }) => {
  for (const width of [360, 375, 390, 412, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${harness}?delay=80`);
    await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
    await page.getByRole("textbox", { name: "Ask ServeFlow Copilot" }).fill("What needs attention?");
    await page.getByRole("button", { name: "Send question" }).click();
    await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toBeVisible();
    await expect(page.locator(".mcp-header")).not.toContainText("Debug");
    await expect(page.locator(".mcp-panel")).not.toContainText("Copilot diagnostic");
    await expect(page.getByRole("button", { name: "Debug" })).toHaveCount(0);
  }
});

test("suggestion and Enter submissions use the shared question pipeline", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?delay=80`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();

  await page.getByRole("button", { name: "Who is available?" }).click();
  await expect(page.locator(".mcp-message.manager").last()).toContainText("Who is available?");
  await expect(page.locator(".mcp-message.copilot").last()).toContainText(
    "Authorized answer for: Who is available?",
  );

  const input = page.getByRole("textbox", { name: "Ask ServeFlow Copilot" });
  await input.fill("Any complaints?");
  await input.press("Enter");
  await expect(page.locator(".mcp-message.manager").last()).toContainText("Any complaints?");
  await expect(page.locator(".mcp-message.copilot").last()).toContainText(
    "Authorized answer for: Any complaints?",
  );
});

test("post-Send rerender survives Android browsers without crypto.randomUUID", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", {
      configurable: true,
      value: undefined,
    });
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?delay=60`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
  const input = page.getByRole("textbox", { name: "Ask ServeFlow Copilot" });
  await input.fill("What needs attention?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(input).toHaveValue("");
  await expect(page.locator(".mcp-message.manager")).toContainText("What needs attention?");
  await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toBeVisible();
  await expect(page.locator("#root")).toBeVisible();
  await expect(page.getByTestId("manager-shell")).toBeVisible();
  await expect(page.locator(".mcp-layer")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await expect(page.getByRole("button", { name: "Debug" })).toHaveCount(0);
});

test("malformed stored and investigator messages normalize without blanking the app", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?delay=40&malformedStoredMessage=1&malformedAnswer=1`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
  await expect(page.locator(".mcp-message.manager")).toHaveCount(1);
  await expect(page.locator(".mcp-message.manager")).toContainText("Recovered question");
  await expect(page.locator(".mcp-message.copilot").first()).toContainText(
    "Copilot could not format this answer",
  );

  await page.getByRole("textbox", { name: "Ask ServeFlow Copilot" }).fill("Malformed answer probe");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.locator(".mcp-message.manager").last()).toContainText("Malformed answer probe");
  await expect(page.locator(".mcp-message.copilot").last()).toContainText(
    "Copilot could not format this answer",
  );
  await expect(page.locator("#root")).toBeVisible();
  await expect(page.getByTestId("manager-shell")).toBeVisible();
  await expect(page.locator(".mcp-layer")).toBeVisible();
});

test("Copilot render boundary preserves the Manager shell and provides a safe recovery", async ({ page }) => {
  await page.goto(`${harness}?boundaryCrash=1`);
  await page.getByRole("button", { name: "Trigger Copilot render crash" }).click();
  const fallback = page.getByRole("alertdialog", { name: "Copilot display error" });
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("Copilot encountered a display error.");
  await expect(fallback).not.toContainText("Crash stage");
  await expect(fallback).not.toContainText("Error type");
  await expect(fallback).not.toContainText("Safe error message");
  await expect(fallback).not.toContainText("render probe detail");
  await expect(page.locator("#root")).toBeVisible();
  await expect(page.getByTestId("manager-shell")).toContainText("Manager shell remains mounted");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(fallback).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Trigger Copilot render crash" })).toBeVisible();
});

test("an unhandled rejection cannot expose diagnostics or unmount Copilot", async ({ page }) => {
  await page.goto(`${harness}?delay=40`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
  await page.getByTestId("unhandled-rejection").evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole("button", { name: "Debug" })).toHaveCount(0);
  await expect(page.locator(".mcp-panel")).not.toContainText("Copilot diagnostic");
  await expect(page.locator(".mcp-panel")).not.toContainText("rejection probe detail");
  await expect(page.locator("#root")).toBeVisible();
  await expect(page.locator(".mcp-layer")).toBeVisible();
});

test("physical-style touch hit testing reaches the one real mobile composer", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Requires a touch-enabled browser context.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://**", (route) => route.abort());
  await page.goto(`${harness}?shell=1&fixedOverlay=1`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).evaluate(
    (button: HTMLButtonElement) => button.click(),
  );
  const textarea = page.getByRole("textbox", { name: "Ask ServeFlow Copilot" });
  const send = page.getByRole("button", { name: "Send question" });
  await expect(textarea).toHaveCount(1);
  await expect(textarea).toBeEditable();

  async function hitStack(
    locator: typeof textarea,
    verticalPosition: "center" | "lower-edge" = "center",
  ) {
    return locator.evaluate((element, position) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = position === "lower-edge" ? rect.bottom - 6 : rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return {
        ownsTarget: top === element,
        top: top ? `${top.tagName}.${Array.from(top.classList).join(".")}` : "NONE",
        stack: document.elementsFromPoint(x, y).map(
          (stackElement) => `${stackElement.tagName}.${Array.from(stackElement.classList).join(".")}`,
        ),
      };
    }, verticalPosition);
  }

  async function expectComposerOwnsHitTargets() {
    const textareaCenter = await hitStack(textarea);
    const textareaLower = await hitStack(textarea, "lower-edge");
    const sendCenter = await hitStack(send);
    expect(textareaCenter.ownsTarget, textareaCenter.top).toBe(true);
    expect(textareaLower.ownsTarget, textareaLower.top).toBe(true);
    expect(sendCenter.ownsTarget, sendCenter.top).toBe(true);
    expect(textareaCenter.stack.some((element) => element.includes("manager-fixed-overlay-probe"))).toBe(true);
  }

  for (const height of [844, 700, 600, 520]) {
    await page.setViewportSize({ width: 390, height });
    await expectComposerOwnsHitTargets();
  }
  await expect(page.getByRole("button", { name: "Debug" })).toHaveCount(0);
  await expectComposerOwnsHitTargets();
  await expect(page.locator(".ml-bottom-nav")).toHaveCSS("display", "none");
  await expect(page.locator("[inert]")).toHaveCount(0);

  await textarea.tap();
  await expect(textarea).toBeFocused();
  await page.keyboard.insertText("What needs attention?");
  await expect(textarea).toHaveValue("What needs attention?");
  await expect(send).toBeEnabled();
  await send.tap();
  await expect(page.locator(".mcp-message.manager")).toContainText("What needs attention?");
  await page.getByRole("button", { name: "Close Copilot" }).tap();
  await expect(page.getByRole("dialog", { name: "ServeFlow Copilot" })).toHaveCount(0);
  await expect(page.locator(".ml-bottom-nav")).not.toHaveCSS("display", "none");
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).evaluate(
    (button: HTMLButtonElement) => button.click(),
  );
  await expect(page.getByRole("dialog", { name: "ServeFlow Copilot" })).toBeVisible();
});

test("visual viewport resize keeps Send tappable and close-reopen remains functional", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${harness}?delay=350`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
  const input = page.getByRole("textbox", { name: "Ask ServeFlow Copilot" });
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
  await page.goto(`${harness}?delay=100&failInvestigatorFirst=1`);
  await page.getByRole("button", { name: "Open ServeFlow Copilot" }).click();
  await page.getByRole("textbox", { name: "Ask ServeFlow Copilot" }).fill("Who is overloaded?");
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
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${harness}?delay=100`);
    await page.getByTestId("live-update").click();
    await expect(page.locator(".mcp-header")).not.toContainText("Debug");
    await expect(page.locator(".mcp-header")).not.toContainText("Copilot diagnostic");
    await expect(page.locator(".mcp-update-context")).toBeVisible();
    await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer" })).toBeVisible();
    await page.getByRole("textbox", { name: "Ask ServeFlow Copilot" }).fill("Who is available?");
    await page.getByRole("button", { name: "Send question" }).click();
    await expect(page.locator(".mcp-message.copilot").filter({ hasText: "Authorized answer for: Who is available?" })).toBeVisible();
  }
});
