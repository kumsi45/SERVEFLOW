import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerCustomerExperience.css"), "utf8");

function attentionRow(index: number) {
  return `<article class="mcx-row mcx-attention-row ${index === 1 ? "critical" : "warning"}">
    <div data-label="Location / Order"><strong>${index % 2 ? `Table ${index}` : `Order SF-${index}`}</strong><small>SF-${index}</small></div>
    <div data-label="Issue"><strong>Excessive service wait</strong><small>Current service requires attention.</small></div>
    <span data-label="Waiting Time">${12 + index}m</span>
    <span data-label="Priority" class="mcx-priority critical"><i></i>Urgent</span>
    <span data-label="Assigned Staff">Staff member with a long name</span>
    <button type="button">View</button>
  </article>`;
}

test("guest attention rows stay contained and become touch-friendly cards", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}html,body{margin:0}</style>
    <main class="mcx-page">
      <nav class="mcx-tabs"><button class="active">Needs Attention <span>4</span></button><button>Complaints</button><button>Special Requests</button><button>Guest Lookup</button></nav>
      <section class="mcx-workspace" aria-label="Needs Attention">
        <div class="mcx-row-list mcx-attention-list"><div class="mcx-row mcx-row-head"><span>Location / Order</span><span>Issue</span><span>Waiting Time</span><span>Priority</span><span>Assigned Staff</span><span></span></div>${[1, 2, 3, 4].map(attentionRow).join("")}</div>
      </section>
    </main>`);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const firstRow = document.querySelector<HTMLElement>(".mcx-attention-row")!;
      const view = firstRow.querySelector<HTMLElement>("button")!;
      const tabs = document.querySelector<HTMLElement>(".mcx-tabs")!;
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        rowRight: firstRow.getBoundingClientRect().right,
        rowColumns: getComputedStyle(firstRow).gridTemplateColumns.split(" ").length,
        viewHeight: view.getBoundingClientRect().height,
        tabsContained: tabs.getBoundingClientRect().right <= innerWidth,
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.rowRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.tabsContained).toBe(true);
    if (viewport.width <= 760) {
      expect(geometry.rowColumns).toBe(2);
      expect(geometry.viewHeight).toBeGreaterThanOrEqual(44);
    } else expect(geometry.rowColumns).toBeGreaterThanOrEqual(5);
  }
});

test("guest inspector is a desktop drawer and full-screen on mobile", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}html,body{margin:0}</style>
    <main class="mcx-page"><section class="mcx-workspace">Workspace</section></main>
    <button class="mcx-scrim"></button><aside class="mcx-inspector"><header><div><span>Guest context</span><h2>Table 8</h2></div><button class="mcx-close">×</button></header><section><h3>Current Service</h3><dl><div><dt>Customer</dt><dd>Not recorded</dd></div></dl></section></aside>`);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>(".mcx-inspector")!.getBoundingClientRect();
      const close = document.querySelector<HTMLElement>(".mcx-close")!.getBoundingClientRect();
      return { width: drawer.width, right: drawer.right, close: Math.min(close.width, close.height), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.right).toBe(viewport.width);
    expect(geometry.close).toBeGreaterThanOrEqual(42);
    expect(geometry.overflow).toBe(false);
    if (viewport.width <= 480) expect(geometry.width).toBe(viewport.width);
    else expect(geometry.width).toBeLessThanOrEqual(440);
  }
});
