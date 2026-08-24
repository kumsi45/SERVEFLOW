import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryStockMovements.css"), "utf8");
const data = [
  ["Extra Fine Imported Brown Sugar With A Very Long Material Name", "Stock In", "Main Beverage and Dry Goods Storage", "+12.375 kg", "Purchase Order #PO-6670C2F2", "in"],
  ["Rice", "Stock Out", "Kitchen Store", "−5 kg", "Kitchen Request", "out"],
  ["Cooking Oil", "Transfer", "Main Store → Bar and Beverage Store", "8.5 L", "Transfer", "transfer"],
  ["Cleaning Gloves", "Adjustment Increase", "General Supplies", "+2 box", "Adjustment", "in"],
  ["Coffee", "Waste", "Bar Store", "−1.25 kg", "Waste", "out"],
];
const cards = data.map(([material, movement, storage, quantity, source, effect]) => `<button><div class="ia-sm-main"><strong>${material}</strong><span>${movement} · ${storage}</span></div><strong class="ia-sm-quantity ${effect}">${quantity}</strong>${movement === "Transfer" ? `<div class="ia-sm-route"><span>Main Store</span><b>→</b><span>Bar and Beverage Store</span></div>` : ""}<div class="ia-sm-source">${source}</div><div class="ia-sm-meta"><time>Aug 23, 5:41 PM</time><span>Inventory Officer With A Long Name</span></div></button>`).join("");
const tableRows = data.map(([material, movement, storage, quantity, source, effect]) => `<tr><td>Aug 23, 5:41 PM</td><td>${movement}</td><td><strong>${material}</strong></td><td><span class="ia-sm-table-route">${storage}</span></td><td><strong class="ia-sm-quantity ${effect}">${quantity}</strong></td><td><span>${source}</span></td><td>Inventory Officer</td><td><button>Details</button></td></tr>`).join("");
const markup = `<main class="ia-sm-page"><header class="ia-sm-heading"><div><h2>Stock Movements</h2></div><button>Refresh</button></header><section class="ia-sm-tools"><label><span>Search movements</span><input placeholder="Search materials, storage, staff..."></label><button>Filters<strong>2</strong></button></section><div class="ia-sm-mobile-list">${cards}</div><div class="ia-sm-desktop-table"><table><thead><tr><th>Date / Time</th><th>Movement</th><th>Material</th><th>Storage</th><th>Quantity</th><th>Source / Reason</th><th>Staff</th><th>Actions</th></tr></thead><tbody>${tableRows}</tbody></table></div><div class="ia-sm-load-more"><span>Showing 25 of 48</span><button>Load More</button></div></main>`;

async function load(page: Page, width: number, height: number, body = markup) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;background:#f6f8fb}body{padding:10px}${styles}</style>${body}`);
}

const viewports = [
  [360, 800], [375, 812], [390, 844], [412, 915], [430, 932],
  [768, 1024], [820, 1180], [1024, 768],
  [1280, 800], [1366, 768], [1440, 900], [1920, 1080],
];

for (const [width, height] of viewports) {
  test(`Inventory Phase 3B Stock Movements fits ${width}x${height}`, async ({ page }) => {
    await load(page, width, height);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    await expect(page.getByRole("heading", { name: "Stock Movements" })).toBeVisible();
    await expect(page.getByPlaceholder("Search materials, storage, staff...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Load More" })).toBeVisible();
    if (width < 1024) {
      await expect(page.locator(".ia-sm-mobile-list")).toBeVisible();
      await expect(page.locator(".ia-sm-desktop-table")).toBeHidden();
      for (const card of await page.locator(".ia-sm-mobile-list > button").all()) {
        const box = await card.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }
    } else {
      await expect(page.locator(".ia-sm-mobile-list")).toBeHidden();
      await expect(page.locator(".ia-sm-desktop-table")).toBeVisible();
    }
    const visibleSources = page.locator(width < 1024 ? ".ia-sm-mobile-list .ia-sm-source" : ".ia-sm-desktop-table tbody td:nth-child(6)");
    await expect(visibleSources.filter({ hasText: "Kitchen Request" })).toHaveCount(1);
    await expect(visibleSources.filter({ hasText: "Purchase Order #PO-6670C2F2" })).toHaveCount(1);
  });
}

test("Inventory Phase 3B filters and details fit a 360px viewport", async ({ page }) => {
  const sheet = `<div class="ia-sm-backdrop"><section class="ia-sm-sheet"><header><h3>Filter Stock Movements</h3><button>×</button></header><div class="ia-sm-filter-fields"><label>Movement Type<select><option>All movements</option></select></label><label>Storage<select><option>All storage</option></select></label><label>Material<select><option>All materials</option></select></label><label>Staff<select><option>All staff</option></select></label><fieldset><legend>Date range</legend><div class="ia-sm-date-options"><label><input type="radio">Today</label><label><input type="radio">Last 7 Days</label><label><input type="radio">This Month</label><label><input type="radio">Custom</label></div></fieldset></div><footer><button class="secondary">Clear</button><button>Apply Filters</button></footer></section></div>`;
  await load(page, 360, 800, `${markup}${sheet}`);
  const box = await page.locator(".ia-sm-sheet").boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(box?.height).toBeLessThanOrEqual(740);
  for (const button of await page.locator(".ia-sm-sheet footer button").all()) expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  const detail = `<div class="ia-sm-backdrop"><section class="ia-sm-sheet ia-sm-detail"><header><div><span>MOVEMENT DETAILS</span><h3>Extra Fine Imported Brown Sugar With A Very Long Material Name</h3></div><button>×</button></header><dl><div><dt>Movement</dt><dd>Transfer</dd></div><div><dt>Quantity</dt><dd>12.375 kg</dd></div><div><dt>From</dt><dd>Main Beverage and Dry Goods Storage</dd></div><div><dt>To</dt><dd>Bar and Beverage Store</dd></div><div><dt>Date and time</dt><dd>Aug 23, 5:41 PM</dd></div><div><dt>Performed by</dt><dd>Inventory Officer With A Long Name</dd></div><div><dt>Source</dt><dd>Purchase Order #PO-6670C2F2</dd></div></dl></section></div>`;
  await load(page, 360, 800, detail);
  const detailBox = await page.locator(".ia-sm-detail").boundingBox();
  expect(detailBox?.x).toBeGreaterThanOrEqual(0);
  expect((detailBox?.x ?? 0) + (detailBox?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(detailBox?.height).toBeLessThanOrEqual(740);
});

test("Inventory Phase 3B state messages are concise and operational", async ({ page }) => {
  for (const message of ["Loading stock movements...", "No stock movements yet.", "No movements match these filters.", "No movements found.", "We couldn't load stock movements. Try again."]) {
    await load(page, 360, 800, `<main class="ia-sm-page"><div class="ia-sm-state">${message}</div></main>`);
    await expect(page.getByText(message)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
