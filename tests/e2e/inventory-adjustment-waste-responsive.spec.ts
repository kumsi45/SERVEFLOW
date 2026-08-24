import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const styles = ["inventoryAdjustments.css", "inventoryStockOperations.css"]
  .map((file) => readFileSync(resolve(process.cwd(), `src/modules/inventory/styles/${file}`), "utf8")).join("\n");

const adjustment = `<main class="iad-page"><header class="iad-heading"><div><h2>Inventory Adjustments</h2></div><button>Create Adjustment</button></header><form class="iad-editor"><div class="iad-editor-heading"><h3>New Adjustment</h3><span>Step 1 of 2</span></div><div class="iad-direction"><button class="active increase">Increase</button><button>Decrease</button></div><div class="iad-header-fields"><label>Reason<select><option>Stock Count Difference</option></select></label><label class="wide">Note (optional)<input placeholder="Short correction note"></label></div><div class="iad-lines"><div class="iad-line"><label>Material<select><option>Coffee</option></select></label><div class="ia-so-auto-storage"><span>Storage</span><strong>Main Store</strong><small>Current 60 kg</small></div><label>Quantity<input value="2"></label><div class="iad-stock-preview"><span>Current → After</span><strong>60 → 62</strong><small>kg</small></div></div></div><footer><button>Cancel</button><button>Review Adjustment</button></footer></form></main>`;

const waste = `<main class="iad-page iaw-page"><header class="iad-heading"><div><h2>Waste</h2></div></header><form class="iad-editor iaw-form"><label>Material *<select><option>Coffee</option></select></label><div class="ia-so-auto-storage"><span>Storage</span><strong>Main Store</strong><small>40 kg available</small></div><label>Quantity *<input value="2"></label><label>Reason *<select><option>Spillage</option></select></label><label class="wide">Note (optional)<input placeholder="Short waste note"></label><div class="iad-stock-preview iaw-stock-preview"><span>Available → After waste</span><strong>40 kg → 38 kg</strong></div><footer><button>Record Waste</button></footer></form></main>`;

async function load(page: Page, width: number, height: number, markup: string) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:hidden}body{padding:12px;background:#f6f8f7}${styles}</style>${markup}`);
}

for (const [width, height] of [[360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [768, 1024], [1024, 768], [1440, 900]]) {
  test(`Adjustment remains compact at ${width}px`, async ({ page }) => {
    await load(page, width, height, adjustment);
    await expect(page.getByText("Current → After")).toBeVisible();
    await expect(page.getByRole("button", { name: "Review Adjustment" })).toBeVisible();
    await expect(page.locator(".ia-so-auto-storage")).toContainText("Main Store");
    for (const control of await page.locator("button, input, select").all()) expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test(`Waste remains compact at ${width}px`, async ({ page }) => {
    await load(page, width, height, waste);
    await expect(page.getByText("Available → After waste")).toBeVisible();
    await expect(page.getByRole("button", { name: "Record Waste" })).toBeVisible();
    await expect(page.locator(".ia-so-auto-storage")).toContainText("40 kg available");
    for (const control of await page.locator("button, input, select").all()) expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
