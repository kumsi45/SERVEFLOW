import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerKitchenSupervision.css"), "utf8");
const markup = `<div class="mks-inspector-layer"><aside class="mks-inspector mks-request-inspector" role="dialog" aria-label="Issued kitchen request">
  <header><div><span>Kitchen Material Request</span><h2>Extra Fine Imported Brown Sugar With A Very Long Item Name</h2></div><div><em class="issued">Issued · Awaiting Kitchen Confirmation</em><button aria-label="Close issued request">×</button></div></header>
  <section><h3>Request details</h3><dl><div><dt>Requested item</dt><dd>Extra Fine Imported Brown Sugar With A Very Long Item Name</dd></div><div><dt>Station</dt><dd>Cold Drinks and Beverage Preparation</dd></div><div><dt>Requested by</dt><dd>Chef With A Long Display Name</dd></div></dl></section>
  <section class="mks-request-outcome issued"><h3>Issued · Awaiting Kitchen Confirmation</h3><p>Waiting for Kitchen to confirm receipt.</p><dl><div><dt>Issued quantity</dt><dd>25 kilograms</dd></div><div><dt>Issued by</dt><dd>Inventory Officer With A Long Display Name</dd></div><div><dt>Issued at</dt><dd>Aug 22, 2026 · 3:45 PM</dd></div></dl></section>
  <section class="mks-request-navigation"><button class="secondary">Open Inventory</button></section>
</aside></div>`;

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
]) {
  test(`issued request lifecycle drawer fits ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;background:#f6f8fb}${styles}</style>${markup}`);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    const drawer = page.getByRole("dialog", { name: "Issued kitchen request" });
    await expect(drawer).toBeVisible();
    await expect(page.getByText("Waiting for Kitchen to confirm receipt.")).toBeVisible();
    await expect(page.getByText("Inventory Officer With A Long Display Name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve Request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
    const box = await drawer.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    await drawer.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const inventoryButton = page.getByRole("button", { name: "Open Inventory" });
    await expect(inventoryButton).toBeVisible();
    if (viewport.width <= 768) expect((await inventoryButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  });
}
