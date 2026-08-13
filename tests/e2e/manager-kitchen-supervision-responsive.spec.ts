import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerKitchenSupervision.css"), "utf8");

const summary = Array.from({ length: 7 }, (_, index) => `<article><span>Metric ${index + 1}</span><strong>${index + 2}</strong></article>`).join("");
const stations = Array.from({ length: 4 }, (_, index) => `<button class="mks-station-row ${index === 0 ? "delayed" : index === 3 ? "idle" : "normal"}"><span class="mks-station-name"><strong>Station ${index + 1}</strong><em>${index === 0 ? "Delayed" : "Normal"}</em></span><span class="mks-station-load">Queue 2 · Preparing 3 · Ready 1 · Delayed ${index === 0 ? 1 : 0}</span><span class="mks-station-meta">Avg 18m · Staff 2</span><b>›</b></button>`).join("");

test("manager kitchen supervision stays compact and contained across operational widths", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}</style>
    <main class="mks-page">
      <header class="mks-command-header"><div><span>Kitchen supervision</span><h1>Kitchen</h1><p>Current operational state</p></div><strong><i></i>Live</strong></header>
      <nav class="mks-nav"><button class="active">Overview</button><button>Orders</button><button>Performance</button></nav>
      <section class="mks-summary">${summary}</section>
      <section class="mks-panel"><header><div><span>Current workload</span><h2>Stations</h2></div></header><div class="mks-station-list">${stations}</div></section>
    </main>
  `);

  for (const viewport of [
    { width: 1440, height: 900, columns: 7 },
    { width: 1180, height: 820, columns: 4 },
    { width: 820, height: 1024, columns: 4 },
    { width: 390, height: 844, columns: 2 },
    { width: 340, height: 720, columns: 1 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const summary = document.querySelector<HTMLElement>(".mks-summary")!;
      const firstRowTop = summary.children[0].getBoundingClientRect().top;
      const firstRowCount = [...summary.children].filter((item) => Math.abs(item.getBoundingClientRect().top - firstRowTop) < 2).length;
      const station = document.querySelector<HTMLElement>(".mks-station-row")!;
      const navButton = document.querySelector<HTMLElement>(".mks-nav button")!;
      return {
        firstRowCount,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        stationRight: station.getBoundingClientRect().right,
        navHeight: navButton.getBoundingClientRect().height,
      };
    });
    expect(geometry.firstRowCount).toBe(viewport.columns);
    expect(geometry.pageOverflow).toBe(false);
    expect(geometry.stationRight).toBeLessThanOrEqual(viewport.width);
    if (viewport.width <= 1023) expect(geometry.navHeight).toBeGreaterThanOrEqual(44);
  }
});

test("station inspector is a right drawer on desktop and full screen on mobile", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}</style>
    <main class="mks-page"><section class="mks-panel"><h2>Kitchen behind drawer</h2></section></main>
    <div class="mks-inspector-layer"><aside class="mks-inspector"><header><div><span>Kitchen Station</span><h2>Beverages</h2></div><div><em class="delayed">Delayed</em><button>×</button></div></header><section><h3>Current Load</h3><dl><div><dt>Waiting</dt><dd>2</dd></div><div><dt>Preparing</dt><dd>1</dd></div></dl></section></aside></div>
  `);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 820, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>(".mks-inspector")!.getBoundingClientRect();
      const close = document.querySelector<HTMLElement>(".mks-inspector header button")!.getBoundingClientRect();
      return { drawerWidth: drawer.width, drawerRight: drawer.right, closeSize: Math.min(close.width, close.height), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.drawerRight).toBe(viewport.width);
    expect(geometry.overflow).toBe(false);
    expect(geometry.closeSize).toBeGreaterThanOrEqual(44);
    if (viewport.width <= 767) expect(geometry.drawerWidth).toBe(viewport.width);
    else expect(geometry.drawerWidth).toBeLessThanOrEqual(440);
  }
});
