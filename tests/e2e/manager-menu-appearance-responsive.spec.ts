import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const studioCss = readFileSync(
  resolve(
    process.cwd(),
    "src/modules/menu/theme-engine/customization/themeCustomizationStudio.css",
  ),
  "utf8",
);
const managerCss = readFileSync(
  resolve(process.cwd(), "src/modules/manager/styles/managerMenuWorkspace.css"),
  "utf8",
);

const widths = [360, 375, 390, 412, 430, 768, 820, 1024, 1366, 1440, 1920];

function fixture() {
  const themes = ["Modern", "Premium Luxury", "Premium Grid", "Brew & Bite"]
    .map(
      (
        name,
        index,
      ) => `<article class="tcs-theme-choice${index === 0 ? " selected" : ""}">
        <div class="tcs-theme-thumbnail modern"><span class="tcs-thumb-hero"></span><span class="tcs-thumb-pill"></span><span class="tcs-thumb-card first"></span><span class="tcs-thumb-card second"></span></div>
        <div class="tcs-theme-choice-copy"><div><h4>${name}</h4></div><button>${index === 0 ? "Selected" : "Select Theme"}</button></div>
      </article>`,
    )
    .join("");
  return `<div class="mmw-appearance-layer"><div class="mmw-appearance">
    <header><h2>Appearance</h2><button aria-label="Close appearance">×</button></header>
    <section class="theme-customization-studio">
      <header class="tcs-studio-header"><div class="tcs-studio-status"><span class="draft">Unpublished changes</span><strong>Modern</strong></div><button class="tcs-preview-action" onclick="document.querySelector('.tcs-preview-column').classList.add('mobile-open')">Preview</button></header>
      <section class="tcs-theme-selection"><div class="tcs-section-heading"><h3>Theme</h3></div><div class="tcs-theme-grid">${themes}</div></section>
      <div class="tcs-editor-layout">
        <aside class="tcs-customization-panel">${["Brand", "Text & Layout", "Menu Cards", "Effects"].map((name, index) => `<section class="tcs-control-section${index === 0 ? " open" : ""}"><button class="tcs-control-toggle"><span><strong>${name}</strong></span><span>⌄</span></button>${index === 0 ? '<div class="tcs-control-body"><div class="tcs-field-grid tcs-color-grid"><label>Accent Color<input type="color" value="#5b4cf0"></label><label>Secondary Color<input type="color" value="#2437d9"></label></div><label class="tcs-range-control"><span><strong>Spacing</strong></span><input type="range" value="20"></label></div>' : ""}</section>`).join("")}</aside>
        <div class="tcs-preview-column"><div class="tcs-preview-heading"><h3>Preview</h3><button class="tcs-preview-close" aria-label="Close preview" onclick="document.querySelector('.tcs-preview-column').classList.remove('mobile-open')">Close</button></div><div class="theme-live-preview-viewport"><div class="theme-live-preview-canvas"></div></div></div>
      </div>
      <footer class="tcs-studio-actions"><details class="tcs-more-actions"><summary>•••</summary></details><div class="tcs-publish-actions"><button class="tcs-discard-action">Discard</button><button>Save Draft</button></div></footer>
    </section>
  </div></div>`;
}

test("Manager Appearance stays compact and overflow-free at required widths", async ({
  page,
}) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(
      `<style>html,body{margin:0;min-height:100%;font-family:Arial,sans-serif}${managerCss}\n${studioCss}</style>${fixture()}`,
    );

    await expect(
      page.getByRole("heading", { name: "Appearance" }),
    ).toBeVisible();
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();
    await expect(page.getByText("Brand", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    const preview = page.locator(".tcs-preview-column");
    if (width <= 767) {
      await expect(preview).toBeHidden();
      await expect(page.locator(".tcs-studio-actions")).toHaveCSS(
        "position",
        "fixed",
      );
      for (const locator of [
        page.locator(".tcs-control-toggle").first(),
        page.locator('.tcs-range-control input[type="range"]'),
        page.locator('.tcs-field-grid input[type="color"]').first(),
      ]) {
        expect((await locator.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(page.locator(".mmw-appearance-layer")).toHaveCSS(
        "bottom",
        "72px",
      );
      expect(
        await page
          .locator(".tcs-theme-grid")
          .evaluate((element) => element.scrollWidth > element.clientWidth),
      ).toBe(true);
      await page.locator(".tcs-preview-action").click();
      await expect(preview).toBeVisible();
      await expect(preview).toHaveCSS("position", "fixed");
      await expect(
        page.locator('.tcs-control-body input[type="color"]').first(),
      ).toHaveValue("#5b4cf0");
      await page.getByRole("button", { name: "Close preview" }).click();
      await expect(preview).toBeHidden();
    } else {
      await expect(preview).toBeVisible();
      await expect(preview).toHaveCSS("position", "sticky");
      const columns = await page
        .locator(".tcs-editor-layout")
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        );
      expect(columns).toBe(2);
    }
  }
});
