import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerKitchenSupervision.css"), "utf8");
const markup = `
  <main class="mks-page">
    <section class="mks-panel">
      <header><div><span>Kitchen floor</span><h2>Stations</h2></div></header>
      <div class="mks-station-list">
        <button class="mks-station-row idle"><span class="mks-station-name"><strong>Cold Drinks and Beverage Preparation</strong></span><span class="mks-station-load">No active orders</span><span class="mks-station-meta">No Chefs assigned</span><b>›</b></button>
        <button class="mks-station-row delayed"><span class="mks-station-name"><strong>Main Kitchen</strong><em>Delayed</em></span><span class="mks-station-load">3 waiting · 2 preparing · 1 delayed</span><span class="mks-station-meta">2 Chefs</span><b>›</b></button>
      </div>
    </section>
  </main>
  <div class="mks-inspector-layer">
    <aside class="mks-inspector mks-request-inspector" role="dialog" aria-label="Kitchen request review">
      <header><div><span>Kitchen material request</span><h2>Extra Fine Imported Brown Sugar With A Very Long Item Name</h2></div><div><em>Pending Manager Review</em><button aria-label="Close request review">×</button></div></header>
      <section><h3>Request details</h3><dl><div><dt>Requested item</dt><dd>Extra Fine Imported Brown Sugar With A Very Long Item Name</dd></div><div><dt>Quantity</dt><dd>25 kilograms</dd></div><div><dt>Station</dt><dd>Cold Drinks and Beverage Preparation</dd></div><div><dt>Requested by</dt><dd>Chef With A Very Long Display Name</dd></div><div><dt>Priority</dt><dd>High</dd></div><div><dt>Status</dt><dd>Pending Manager Review</dd></div><div><dt>Requested</dt><dd>8/13/2026, 11:40:55 PM</dd></div><div><dt>Request age</dt><dd>203h 18m</dd></div></dl></section>
      <p class="mks-request-reason"><strong>Request reason</strong><span>Low stock for juice preparation during unexpected customer demand across several service locations.</span></p>
      <section><h3>Current inventory</h3><dl><div><dt>Available</dt><dd>7 kilograms</dd></div><div><dt>Reorder level</dt><dd>10 kilograms</dd></div></dl></section>
      <section class="mks-request-review"><h3>Manager review</h3><div><button>Approve for Inventory</button><button class="danger">Reject request</button></div></section>
      <footer><button class="secondary">Open Inventory</button><button>Close</button></footer>
    </aside>
  </div>`;

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
]) {
  test(`Manager Kitchen request review and stations fit ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;background:#f6f8fb}.mks-page{padding:16px}${styles}</style>${markup}`);

    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    await expect(page.getByRole("dialog", { name: "Kitchen request review" })).toBeVisible();
    await expect(page.getByText("No active orders")).toBeAttached();
    await expect(page.getByText("3 waiting · 2 preparing · 1 delayed")).toBeAttached();
    await expect(page.getByText("IDLE", { exact: true })).toHaveCount(0);

    const inspector = page.locator(".mks-request-inspector");
    const inspectorBox = await inspector.boundingBox();
    expect(inspectorBox?.x).toBeGreaterThanOrEqual(0);
    expect((inspectorBox?.x ?? 0) + (inspectorBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);

    await inspector.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    for (const action of ["Approve for Inventory", "Reject request", "Open Inventory", "Close"]) {
      const button = page.getByRole("button", { name: action, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      if (viewport.width <= 768) expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });
}
