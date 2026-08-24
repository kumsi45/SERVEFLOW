import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryKitchenRequests.css"), "utf8");
const card = (state: "available" | "insufficient" | "out", index: number) => `<article class="ia-kr-card ${state}"><header><div><strong>${index === 1 ? "Extra Fine Imported Brown Sugar With A Very Long Material Name" : `Material ${index}`}</strong><span>Cold Drinks and Beverage Preparation Station</span></div></header><div class="ia-kr-requested"><span>Requested quantity</span><strong>${index + 1}.25 kg</strong></div><div class="ia-kr-availability ${state}"><div><span>Available in Main Beverage and Dry Goods Storage</span><strong>${state === "out" ? "0" : state === "insufficient" ? "2" : "70"} kg</strong></div>${state === "out" ? "<b>OUT OF STOCK</b>" : state === "insufficient" ? "<b>Insufficient stock · short by 3.25 kg</b>" : ""}</div><div class="ia-kr-meta"><span>Requested by Chef With A Long Name</span><time>Aug 23, 12:21 PM</time></div><footer>${state === "available" ? "<button>Issue</button>" : ""}<button class="secondary">Cannot Fulfill</button></footer></article>`;
const markup = `<main class="ia-kr-page"><header class="ia-kr-heading"><div><h2>Kitchen Requests</h2></div></header><div class="ia-kr-tabs" role="tablist"><button aria-selected="true">Awaiting Inventory<span>3</span></button><button>Awaiting Kitchen<span>1</span></button><button>History</button></div><div class="ia-kr-list">${card("available", 1)}${card("insufficient", 2)}${card("out", 3)}</div></main>`;

async function load(page: Page, width: number, height: number, body = markup) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;background:#f6f8fb}body{padding:10px}${styles}</style>${body}`);
}

const viewports = [[360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]];
for (const [width, height] of viewports) {
  test(`Inventory Kitchen Requests fits ${width}x${height}`, async ({ page }) => {
    await load(page, width, height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole("heading", { name: "Kitchen Requests" })).toBeVisible();
    const tabs = page.locator(".ia-kr-tabs");
    expect((await tabs.evaluate((node) => node.scrollWidth)) >= (await tabs.evaluate((node) => node.clientWidth))).toBe(true);
    const cards = page.locator(".ia-kr-card");
    await expect(cards).toHaveCount(3);
    const tops = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(tops.filter((top) => top === tops[0])).toHaveLength(width < 700 ? 1 : 2);
    await expect(cards.nth(0).getByRole("button", { name: "Issue" })).toBeVisible();
    await expect(cards.nth(1).getByRole("button", { name: "Issue" })).toHaveCount(0);
    await expect(cards.nth(2).getByRole("button", { name: "Issue" })).toHaveCount(0);
    await expect(page.getByText("OUT OF STOCK")).toBeVisible();
    await expect(page.getByText(/Insufficient stock/)).toBeVisible();
    for (const button of await page.locator(".ia-kr-card footer button").all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
    for (const forbidden of ["Needs Attention", "Quick Operations", "Stock Snapshot", "Recent Activity", "Ingredient / Food Material"]) await expect(page.getByText(forbidden, { exact: true })).toHaveCount(0);
  });
}

test("Kitchen Request issue confirmation is compact and full-quantity only", async ({ page }) => {
  const dialog = `<div class="ia-kr-backdrop"><section class="ia-kr-dialog" role="dialog" aria-label="Issue Coffee"><header><div><span>KITCHEN REQUEST</span><h2>Issue Coffee</h2><p>Main Kitchen</p></div><button aria-label="Close">×</button></header><dl><div><dt>Requested</dt><dd>12 kg</dd></div><div><dt>From</dt><dd>Main Store</dd></div><div><dt>Available</dt><dd>60 kg</dd></div><div><dt>After issue</dt><dd>48 kg</dd></div></dl><label>Quantity to issue<div class="ia-kr-quantity-input"><input type="number" readonly value="12"><span>kg</span></div></label><p class="ia-kr-integrity-note">This issues the full approved quantity and records one stock movement.</p><footer><button class="secondary">Cancel</button><button>Confirm Issue</button></footer></section></div>`;
  await load(page, 360, 800, dialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(page.getByRole("dialog", { name: "Issue Coffee" })).toBeVisible();
  await expect(page.locator("input[readonly]")).toHaveValue("12");
  await expect(page.getByRole("button", { name: "Confirm Issue" })).toBeVisible();
});

test("Kitchen Request Cannot Fulfill confirmation is compact", async ({ page }) => {
  const dialog = `<div class="ia-kr-backdrop"><section class="ia-kr-dialog" role="dialog" aria-label="Cannot Fulfill"><header><div><span>KITCHEN REQUEST</span><h2>Cannot Fulfill</h2><p>Main Kitchen</p></div><button aria-label="Close">×</button></header><div class="ia-kr-unable-form"><label>Reason<select><option>Insufficient stock</option><option>Out of stock</option><option>Material unavailable</option><option>Other</option></select></label><label>Additional explanation (optional)<textarea rows="2"></textarea></label></div><footer><button class="secondary">Cancel</button><button>Confirm Cannot Fulfill</button></footer></section></div>`;
  await load(page, 360, 800, dialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(page.getByRole("button", { name: "Confirm Cannot Fulfill" })).toBeVisible();
  const box = await page.locator(".ia-kr-dialog").boundingBox();
  expect(box?.height).toBeLessThanOrEqual(800);
});
