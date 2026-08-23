import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryStockOperations.css"), "utf8");
type Operation = "Stock In" | "Stock Out" | "Transfer";

function markup(operation: Operation) {
  const transfer = operation === "Transfer";
  const primary = transfer
    ? `<label>Material<select><option>Extra Fine Imported Brown Sugar With A Very Long Material Name</option></select></label><label>From storage<select><option>Main Beverage and Dry Goods Storage</option></select></label><label>To storage<select><option>Bar and Beverage Store</option></select></label><label>Quantity<input inputmode="decimal" value="12.375"></label>`
    : `<label>Material<select><option>Extra Fine Imported Brown Sugar With A Very Long Material Name</option></select></label><label>Storage<select><option>Main Beverage and Dry Goods Storage</option></select></label><label>Quantity<input inputmode="decimal" value="12.375"></label>`;
  const supplier = operation === "Stock In" ? `<label>Supplier<select><option>No supplier selected</option><option>General Supplier</option></select></label>` : "";
  return `<main class="ia-so-page"><header><div><span>STOCK OPERATION</span><h2>${operation}</h2><p>Focused stock operation.</p></div></header><form class="ia-so-form"><div class="ia-so-primary-fields">${primary}</div><div class="ia-so-stock-context"><span>${operation === "Stock In" ? "Current stock" : "Available"}</span><strong>26.125 kg</strong></div><details class="ia-so-details"><summary>Additional details</summary><div>${supplier}<label>Reason<textarea class="ia-so-reason" rows="2" placeholder="Why is this stock being changed? (optional)"></textarea></label><label>Movement time<input type="datetime-local" value="2026-08-23T17:41"></label></div></details><footer><button>Review ${operation}</button></footer></form></main>`;
}

async function load(page: Page, width: number, height: number, operation: Operation) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;background:#f6f8fb}body{padding:10px}${styles}</style>${markup(operation)}`);
}

const viewports = [[360, 800], [390, 844], [430, 932], [768, 1024], [1024, 768], [1440, 900]];
const operations: Operation[] = ["Stock In", "Stock Out", "Transfer"];

for (const [width, height] of viewports) {
  for (const operation of operations) {
    test(`${operation} cleanup fits ${width}x${height}`, async ({ page }) => {
      await load(page, width, height, operation);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.getByRole("heading", { name: operation })).toBeVisible();
      await expect(page.getByText("Additional details", { exact: true })).toBeVisible();
      await expect(page.getByText("Document number", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Invoice number", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Notes", { exact: true })).toHaveCount(0);
      await page.getByText("Additional details", { exact: true }).click();
      await expect(page.getByPlaceholder("Why is this stock being changed? (optional)")).toBeVisible();
      await expect(page.getByText("Movement time", { exact: true })).toBeVisible();
      if (operation === "Stock In") await expect(page.locator("label").filter({ hasText: "Supplier" })).toBeVisible();
      else await expect(page.locator("label").filter({ hasText: "Supplier" })).toHaveCount(0);
      for (const control of await page.locator("input, select, textarea, summary, button").all()) {
        const box = await control.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }
    });
  }
}
