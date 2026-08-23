import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryDashboard.css"), "utf8");

const activity = (index: number) => `<button>
  <span class="ia-i2-direction ${index % 2 ? "out" : "in"}">${index % 2 ? "−" : "+"}</span>
  <span class="ia-i2-activity-main"><strong>${index === 1 ? "Extra Fine Imported Brown Sugar With A Very Long Material Name" : `Material ${index}`}</strong><small>${index % 2 ? "Issued" : "Received"} · Main Beverage and Dry Goods Storage</small></span>
  <strong class="${index % 2 ? "out" : "in"}">${index % 2 ? "−" : "+"}${index + 1} kg</strong>
  <span class="ia-i2-activity-meta"><strong>Inventory Officer With A Long Name</strong><time>Aug 23, 10:16 AM</time></span>
</button>`;

const markup = `<main class="ia-i2-dashboard">
  <section class="ia-i2-section"><div class="ia-i2-title"><div><span>NOW</span><h2>Needs Attention</h2></div></div><div class="ia-i2-attention-grid"><button><strong>3</strong><span>Kitchen Requests</span><small>Awaiting Inventory</small></button><button class="critical"><strong>1</strong><span>Out of Stock</span><small>Needs replenishment</small></button><button class="warning"><strong>4</strong><span>Low Stock</span><small>Below minimum level</small></button><button><strong>6</strong><span>Pending Purchases</span><small>Open orders</small></button></div></section>
  <section class="ia-i2-section"><div class="ia-i2-title"><div><span>DAILY WORK</span><h2>Quick Actions</h2></div></div><div class="ia-i2-quick-grid"><button><span>+</span><strong>Receive Stock</strong></button><button><span>−</span><strong>Issue Stock</strong></button><button><span>⇄</span><strong>Transfer</strong></button><button><span>±</span><strong>Adjust Stock</strong></button><button><span>!</span><strong>Record Waste</strong></button><button><span>PO</span><strong>Purchase Order</strong></button></div></section>
  <section class="ia-i2-section"><div class="ia-i2-title"><div><span>STOCK</span><h2>Stock Snapshot</h2></div><button>View Current Stock</button></div><div class="ia-i2-snapshot-grid"><button><small>Active Materials</small><strong>42</strong></button><button><small>Out of Stock</small><strong>1</strong></button><button><small>Low Stock</small><strong>4</strong></button></div></section>
  <section class="ia-i2-section"><div class="ia-i2-title"><div><span>LATEST CHANGES</span><h2>Recent Activity</h2></div><button>View Stock Movements</button></div><div class="ia-i2-activity-list">${[1, 2, 3, 4, 5, 6].map(activity).join("")}</div></section>
</main>`;

async function loadDashboard(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:hidden;background:#f6f8fb}body{padding:8px}${styles}</style>${markup}`);
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
  { group: "tablet", width: 1180, height: 820 },
  { group: "tablet", width: 1280, height: 800 },
  { group: "desktop", width: 1366, height: 768 },
  { group: "desktop", width: 1440, height: 900 },
  { group: "desktop", width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  test(`Inventory Phase 2 ${viewport.group} dashboard fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await loadDashboard(page, viewport.width, viewport.height);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);

    const sectionTops = await page.locator(".ia-i2-section").evaluateAll((sections) => sections.map((section) => Math.round(section.getBoundingClientRect().top)));
    expect(sectionTops).toEqual([...sectionTops].sort((left, right) => left - right));
    await expect(page.getByRole("heading", { name: "Needs Attention" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quick Actions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stock Snapshot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Activity" })).toBeVisible();
    await expect(page.locator(".ia-i1-tabs")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Issue", exact: true })).toHaveCount(0);

    const quickButtons = page.locator(".ia-i2-quick-grid button");
    const firstQuick = await quickButtons.first().boundingBox();
    expect(firstQuick?.height).toBeGreaterThanOrEqual(48);
    const quickTops = await quickButtons.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    const expectedColumns = viewport.width < 600 ? 2 : viewport.width < 1025 ? 3 : 6;
    expect(quickTops.filter((top) => top === quickTops[0])).toHaveLength(expectedColumns);

    const activityRows = page.locator(".ia-i2-activity-list > button");
    await expect(activityRows).toHaveCount(6);
    for (const row of await activityRows.all()) {
      const box = await row.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    }

    const activityTopBefore = sectionTops[3];
    await page.locator(".ia-i2-attention-grid button strong").first().evaluate((node) => { node.textContent = "12"; });
    const activityTopAfter = Math.round((await page.locator(".ia-i2-section").nth(3).boundingBox())?.y ?? 0);
    expect(Math.abs(activityTopAfter - activityTopBefore)).toBeLessThanOrEqual(1);
  });
}
