import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerOperationsCenter.css"), "utf8");

test("cashier supervision stays dense on desktop and becomes cards without mobile overflow", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}html,body{margin:0;background:#f6f8fb}.moc-page{padding:16px}</style>
    <main class="moc-page">
      <nav class="moc-workspace-tabs"><button>Service</button><button class="is-active">Cashier <span>2</span></button></nav>
      <div class="moc-cashier-workspace">
        <section class="moc-cashier-kpis">${["Cashiers on shift","Open drawers","Cash collected today","Expense approvals","Reconciliation issues"].map((label) => `<article><span>${label}</span><strong>${label.includes("Cash") ? "ETB 19,850.00" : "2"}</strong></article>`).join("")}</section>
        <section class="moc-panel moc-active-cashiers"><div class="moc-section-head"><div><span>Live drawers</span><h2>Active Cashiers</h2></div></div><div class="moc-cashier-table"><div class="moc-cashier-table-head"><span>Cashier</span><span>Shift start</span><span>Opening</span><span>Cash sales</span><span>Expenses</span><span>Expected drawer</span><span>Status</span></div><button><span data-label="Cashier"><strong>Hana With A Long Cashier Name</strong><small>CS-00004</small></span><span data-label="Shift start">7:00 AM</span><span data-label="Opening">ETB 2,000.00</span><span data-label="Cash sales">ETB 9,000.00</span><span data-label="Expenses">ETB 500.00</span><span data-label="Expected drawer"><strong>ETB 10,500.00</strong></span><span data-label="Status"><em class="moc-status green">Active</em></span></button></div></section>
        <div class="moc-cash-secondary"><section class="moc-panel"><div class="moc-section-head"><div><h2>Recent Handovers</h2></div></div></section><section class="moc-panel"><div class="moc-section-head"><div><h2>Recent Cashier Events</h2></div></div></section></div>
      </div>
    </main>
  `);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      rowDisplay: getComputedStyle(document.querySelector<HTMLElement>(".moc-cashier-table>button")!).display,
      headerDisplay: getComputedStyle(document.querySelector<HTMLElement>(".moc-cashier-table-head")!).display,
      tabHeight: document.querySelector<HTMLElement>(".moc-workspace-tabs button")!.getBoundingClientRect().height,
    }));
    expect(result.overflow).toBe(false);
    if (viewport.width <= 767) {
      expect(result.headerDisplay).toBe("none");
      expect(result.tabHeight).toBeGreaterThanOrEqual(44);
    } else {
      expect(result.rowDisplay).toBe("grid");
    }
  }
});
