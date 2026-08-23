import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/kitchen/styles/kitchenDashboard.css"), "utf8");
const cards = Array.from({ length: 10 }, (_, index) => `<article class="kd-stock-card"><div class="kd-stock-card-primary"><strong>${index === 0 ? "Extra Fine Imported Brown Sugar" : `Ingredient ${index + 1}`}</strong><b>${index + 1} kg</b></div><p>From Main Store</p><time>Issued Today, 9:0${index} AM</time><button onclick="document.querySelector('.kd-receipt-dialog-layer').style.display='grid'">Confirm Received</button></article>`).join("");
const markup = `<main class="kd-root"><header class="kd-header"><div class="kd-header-logo-area"><span class="sf-brand"><span class="sf-brand-mark">S</span><span class="sf-brand-name">ServeFlow</span></span><span class="kd-header-kitchen-context">Kitchen: Beverages</span></div><div class="kd-divider"></div><div class="kd-status-pill">ONLINE</div><div class="kd-header-datetime">Sat · 9:10 AM</div><div class="kd-header-search"><input aria-label="Search orders"></div><div class="kd-active-badge">4 Active</div><div class="kd-header-actions"><div class="kd-stock-requests-control"><button class="kd-stock-requests-trigger" aria-expanded="true">Requests <span>10</span><i>⌄</i></button><button class="kd-stock-panel-backdrop" aria-label="Close stock requests" onclick="document.querySelector('.kd-stock-panel').style.display='none';this.style.display='none'"></button><section class="kd-stock-panel" aria-label="Stock Requests"><header class="kd-stock-panel-header"><div><h2>Stock Requests</h2><p>10 waiting for confirmation</p></div><button aria-label="Close stock requests" onclick="this.closest('.kd-stock-panel').style.display='none'">×</button></header><div class="kd-stock-panel-scroll">${cards}</div><footer class="kd-stock-panel-footer"><button>View request history</button></footer></section></div><button class="kd-signout-btn">Create Request</button><button class="kd-icon-btn">🔔</button><button class="kd-signout-btn">Sign Out</button></div></header><section class="kd-filter-bar"><button class="kd-filter-btn active">All</button><button class="kd-filter-btn">New 2</button><button class="kd-filter-btn">Preparing 1</button></section><section class="kd-order-workspace"><div class="kd-order-grid"><article class="kd-order-card"><header class="kd-card-header"><h2>Order 104</h2></header></article></div></section><div class="kd-receipt-dialog-layer" style="display:none"><section class="kd-receipt-dialog" role="dialog" aria-label="Confirm receipt"><header><h2>Confirm receipt</h2><strong>Sugar · 2 kg</strong></header><p>Confirm that 2 kg of Sugar was received from Main Store.</p><footer><button onclick="this.closest('.kd-receipt-dialog-layer').style.display='none'">Cancel</button><button>Confirm Received</button></footer></section></div></main>`;

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet-wide", width: 1280, height: 800 },
  { name: "tablet", width: 1180, height: 820 },
  { name: "tablet-standard", width: 1024, height: 768 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "mobile-compact", width: 375, height: 812 },
]) {
  test(`Kitchen stock requests fit ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:hidden}${styles}</style>${markup}`);
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    await expect(page.getByRole("button", { name: /Requests/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Request" })).toBeVisible();
    const panel = page.getByRole("region", { name: "Stock Requests" });
    const panelBox = await panel.boundingBox();
    expect(panelBox?.x).toBeGreaterThanOrEqual(0);
    expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    expect(panelBox?.height).toBeLessThanOrEqual(viewport.height);
    const confirmButton = panel.getByRole("button", { name: "Confirm Received" }).first();
    const confirmBox = await confirmButton.boundingBox();
    expect(confirmBox?.height).toBeGreaterThanOrEqual(44);
    await confirmButton.click();
    const dialog = page.getByRole("dialog", { name: "Confirm receipt" });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.x).toBeGreaterThanOrEqual(0);
    expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    expect(dialogBox?.height).toBeLessThanOrEqual(viewport.height);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Close stock requests" }).last().click();
    await expect(page.getByText("Order 104")).toBeVisible();
  });
}
