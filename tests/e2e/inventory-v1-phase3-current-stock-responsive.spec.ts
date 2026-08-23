import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryStockOperations.css"), "utf8");

const rows = [
  ["Extra Fine Imported Brown Sugar With A Very Long Material Name", "Main Beverage and Dry Goods Storage", "12.375 kg", "Low Stock", "low_stock"],
  ["Cooking Oil", "Kitchen Store", "0 L", "Out of Stock", "out_of_stock"],
  ["Cleaning Gloves", "General Supplies", "40 box", "In Stock", "in_stock"],
  ["Rice", "Main Store", "250.5 kg", "Over Stock", "over_stock"],
];

const mobileRows = rows.map(([name, storage, quantity, status, statusClass]) => `<button type="button"><span class="ia-cs-card-main"><strong>${name}</strong><small>${storage}</small></span><strong class="ia-cs-quantity">${quantity}</strong><span class="ia-cs-status ${statusClass}">${status}</span></button>`).join("");
const desktopRows = rows.map(([name, storage, quantity, status, statusClass]) => `<tr><td><strong>${name}</strong><small>Food Material</small></td><td><strong>${quantity}</strong></td><td>10 kg</td><td>200 kg</td><td>${storage}</td><td><span class="ia-cs-status ${statusClass}">${status}</span></td><td><button>Actions</button></td></tr>`).join("");

const stockMarkup = `<main class="ia-cs-page"><header class="ia-cs-heading"><div><span>LIVE STOCK</span><h2>Current Stock</h2><p>Live stock across your storage locations</p></div><button>+ Stock Action</button></header><section class="ia-cs-tools"><label class="ia-cs-search"><span>Search stock</span><input placeholder="Material, storage, or category"></label><button class="ia-cs-filter-button">Filters<strong>2</strong></button></section><div class="ia-cs-mobile-list">${mobileRows}</div><div class="ia-cs-desktop-table"><table><thead><tr><th>Material</th><th>Current</th><th>Minimum</th><th>Maximum</th><th>Storage</th><th>Status</th><th>Actions</th></tr></thead><tbody>${desktopRows}</tbody></table></div></main>`;

const operationMarkup = `<main class="ia-so-page"><header><div><span>STOCK OPERATION</span><h2>Stock In</h2><p>Receive material into a storage location.</p></div></header><form class="ia-so-form"><div class="ia-so-primary-fields"><label>Material<select><option>Extra Fine Imported Brown Sugar With A Very Long Material Name</option></select></label><label>Storage<select><option>Main Beverage and Dry Goods Storage</option></select></label><label>Quantity<input inputmode="decimal" value="12.375"></label></div><div class="ia-so-stock-context"><span>Current stock</span><strong>26.125 kg</strong></div><details class="ia-so-details"><summary>Additional details</summary><div><label>Supplier<select><option>General Supplier</option></select></label><label>Reason<textarea class="ia-so-reason" rows="2" placeholder="Why is this stock being changed? (optional)"></textarea></label><label>Movement time<input type="datetime-local"></label></div></details><footer><button>Review Stock In</button></footer></form></main>`;

async function load(page: Page, width: number, height: number, markup: string) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;background:#f6f8fb}body{padding:10px}${styles}</style>${markup}`);
}

const viewports = [
  { group: "mobile", width: 360, height: 800 },
  { group: "mobile", width: 375, height: 812 },
  { group: "mobile", width: 390, height: 844 },
  { group: "mobile", width: 412, height: 915 },
  { group: "mobile", width: 430, height: 932 },
  { group: "tablet", width: 768, height: 1024 },
  { group: "tablet", width: 820, height: 1180 },
  { group: "tablet", width: 1024, height: 768 },
  { group: "desktop", width: 1280, height: 800 },
  { group: "desktop", width: 1366, height: 768 },
  { group: "desktop", width: 1440, height: 900 },
  { group: "desktop", width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  test(`Inventory Phase 3 Current Stock fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await load(page, viewport.width, viewport.height, stockMarkup);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    await expect(page.getByRole("heading", { name: "Current Stock" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Stock Action" })).toBeVisible();
    const actionBox = await page.getByRole("button", { name: "+ Stock Action" }).boundingBox();
    expect(actionBox?.height).toBeGreaterThanOrEqual(44);
    if (viewport.width < 1024) {
      await expect(page.locator(".ia-cs-mobile-list")).toBeVisible();
      await expect(page.locator(".ia-cs-desktop-table")).toBeHidden();
      for (const card of await page.locator(".ia-cs-mobile-list > button").all()) {
        const box = await card.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      }
    } else {
      await expect(page.locator(".ia-cs-mobile-list")).toBeHidden();
      await expect(page.locator(".ia-cs-desktop-table")).toBeVisible();
    }
  });

  test(`Inventory Phase 3 stock operation fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await load(page, viewport.width, viewport.height, operationMarkup);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    await expect(page.getByRole("heading", { name: "Stock In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review Stock In" })).toBeVisible();
    const fields = page.locator(".ia-so-primary-fields > label");
    const tops = await fields.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    const expectedColumns = viewport.width < 700 ? 1 : viewport.width < 1024 ? 2 : 3;
    expect(tops.filter((top) => top === tops[0])).toHaveLength(expectedColumns);
    for (const control of await page.locator("input,select,summary,button").all()) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("Inventory Phase 3 mobile sheets stay in the viewport", async ({ page }) => {
  await load(page, 360, 800, `${stockMarkup}<div class="ia-cs-sheet-backdrop"><section class="ia-cs-sheet"><header><h3>Update Stock</h3><button aria-label="Close">×</button></header><div class="ia-cs-action-list"><button><strong>Stock In</strong><span>Receive stock into storage</span></button><button><strong>Stock Out</strong><span>Issue stock from storage</span></button><button><strong>Transfer</strong><span>Move stock between locations</span></button><button><strong>View details</strong><span>Thresholds and recent movements</span></button></div></section></div>`);
  const sheet = await page.locator(".ia-cs-sheet").boundingBox();
  expect(sheet?.x).toBeGreaterThanOrEqual(0);
  expect((sheet?.x ?? 0) + (sheet?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(sheet?.height).toBeLessThanOrEqual(720);
});
