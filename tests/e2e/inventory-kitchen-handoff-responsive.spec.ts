import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryDashboard.css"), "utf8");
const requestCard = (index: number, state = "normal") => `<article class="ia-i1-request-card ${state}"><header><div class="ia-i1-request-primary"><strong>${index === 1 ? "Extra Fine Imported Brown Sugar With A Long Ingredient Name" : `Ingredient ${index}`}</strong><b>${index + 1} kg</b></div></header><strong class="ia-i1-station">Cold Drinks and Beverage Preparation</strong><div class="ia-i1-request-meta"><span>Requested by Chef With A Long Name</span><time>Aug 23, 2:40 PM</time></div><div class="ia-i1-request-meta"><span>Approved by Manager Sada</span><time>Aug 23, 2:43 PM</time></div><div class="ia-i1-availability available"><span>Available</span><strong>70 kg</strong></div><footer><button>Issue</button><button class="secondary">Cannot Fulfill</button></footer></article>`;
const markup = `<main class="ia-i1-dashboard">
  <section class="ia-i1-section"><div class="ia-i1-title"><div><span>OPERATIONS</span><h2>Needs Attention</h2></div></div><div class="ia-i1-attention-grid"><button><strong>4</strong><span>Kitchen Requests</span><small>Awaiting action</small></button><button class="critical"><strong>1</strong><span>Out of Stock</span><small>Review items</small></button><button><strong>7</strong><span>Pending Purchases</span><small>Open purchases</small></button></div></section>
  <section class="ia-i1-section ia-i1-requests"><div class="ia-i1-title"><div><span>KITCHEN HANDOFF</span><h2>Kitchen Requests</h2></div></div><div class="ia-i1-tabs"><button aria-selected="true">Awaiting Inventory <span>4</span></button><button>Awaiting Kitchen <span>1</span></button><button>History</button></div><div class="ia-i1-request-list">${[1, 2, 3, 4].map((index) => requestCard(index, index === 4 ? "insufficient" : "normal")).join("")}</div></section>
  <section class="ia-i1-section"><div class="ia-i1-title"><div><span>SHIFT WORK</span><h2>Quick Operations</h2></div></div><div class="ia-i1-quick-grid"><button><span>+</span><strong>Receive Stock</strong></button><button><span>−</span><strong>Stock Out / Issue Stock</strong></button><button><span>±</span><strong>Adjustment</strong></button><button><span>⇄</span><strong>Transfer</strong></button><button><span>!</span><strong>Waste</strong></button></div></section>
  <section class="ia-i1-section"><div class="ia-i1-title"><div><span>STOCK POSITION</span><h2>Stock Snapshot</h2></div><button>View Current Stock</button></div></section>
  <section class="ia-i1-section"><div class="ia-i1-title"><div><span>LEDGER</span><h2>Recent Activity</h2></div></div></section>
</main>`;

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, columns: 3 },
  { name: "laptop", width: 1024, height: 768, columns: 2 },
  { name: "tablet", width: 768, height: 1024, columns: 2 },
  { name: "mobile", width: 375, height: 812, columns: 1 },
]) {
  test(`Inventory I1.1 dashboard fits ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:hidden;background:#f6f8fb}.ia-i1-dashboard{padding:12px}${styles}</style>${markup}`);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    const cards = page.locator(".ia-i1-request-card");
    await expect(cards).toHaveCount(4);
    const topPositions = await cards.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
    expect(topPositions.filter((top) => top === topPositions[0])).toHaveLength(viewport.columns);
    const borderColors = await cards.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).borderLeftColor));
    expect(borderColors[0]).not.toBe("rgb(220, 38, 38)");
    expect(borderColors[3]).toBe("rgb(220, 38, 38)");
    await expect(page.getByRole("button", { name: /Awaiting Inventory/ })).toHaveCount(1);
    await expect(page.locator(".ia-i1-status.accepted")).toHaveCount(0);
    for (const action of ["Issue", "Cannot Fulfill"]) {
      const button = cards.first().getByRole("button", { name: action, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    }
    if (viewport.width >= 1440) {
      const requestsBox = await page.locator(".ia-i1-requests").boundingBox();
      expect(requestsBox?.y).toBeLessThan(180);
      expect(topPositions[0]).toBeLessThan(270);
      expect((await page.locator(".ia-i1-attention-grid button").first().boundingBox())?.height).toBeLessThan(80);
      expect((await cards.first().boundingBox())?.height).toBeLessThan(240);
    }
  });
}

test("Inventory I1.1 supports four request columns on a wide workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0}${styles}</style>${markup}`);
  const tops = await page.locator(".ia-i1-request-card").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
});

test("Inventory I1.1 mobile issue confirmation is compact and business-friendly", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0}${styles}</style><div class="ia-i1-dialog-backdrop"><section class="ia-i1-dialog" role="dialog" aria-label="Issue Stock"><header><div><span>KITCHEN REQUEST</span><h2>Issue Stock</h2><p>Sugar → Beverages</p></div><button aria-label="Close">×</button></header><dl class="ia-i1-dialog-summary"><div><dt>Requested</dt><dd>2 kg</dd></div><div><dt>Available</dt><dd>48 kg</dd></div><div><dt>Storage</dt><dd>Main Store</dd></div><div><dt>After issue</dt><dd>46 kg</dd></div></dl><p class="ia-i1-deduction-warning">You are issuing 2 kg of Sugar to Beverages. Stock will decrease from 48 kg to 46 kg.</p><footer><button class="secondary">Cancel</button><button>Issue 2 kg</button></footer></section></div>`);
  const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
  const dialog = page.getByRole("dialog", { name: "Issue Stock" });
  const box = await dialog.boundingBox();
  expect(box?.x).toBe(0);
  expect(box?.width).toBe(375);
  expect(box?.height).toBeLessThan(600);
  await expect(page.getByText("Stock will decrease from 48 kg to 46 kg.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Issue 2 kg" })).toBeVisible();
});
