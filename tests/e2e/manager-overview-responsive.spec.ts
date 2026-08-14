import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(
    process.cwd(),
    "src/modules/manager/styles/managerDashboard.css",
  ),
  "utf8",
);

test("manager overview stays dense and contained across operational widths", async ({
  page,
}) => {
  await page.setContent(`
    <style>${styles}</style>
    <main class="md-overview">
      <section class="md-pulse"><div class="md-kpis">${Array.from({ length: 6 }, (_, index) => `<article class="md-kpi md-kpi-blue"><span>Metric ${index + 1}</span><strong>24</strong><small>Live status</small></article>`).join("")}</div></section>
      <section class="md-attention"><div class="md-attention-list"><div class="md-attention-head"><span>Priority / Issue</span><span>Service Location</span><span>Context</span><span>Waiting</span><span>Action</span></div><div class="md-attention-row"><div><i class="is-critical"></i><strong>Kitchen delay</strong></div><span>Table 12</span><span>Waiter Abdi</span><time>22m</time><a href="#">Review</a></div></div></section>
      <section class="md-main-grid"><article class="md-floor"><div class="md-table-grid">${Array.from({ length: 10 }, (_, index) => `<button class="md-table ${index < 3 ? "md-table-available" : "md-table-occupied"}"><div class="md-table-topline"><strong>Table ${index + 1}</strong><span>${index < 3 ? "Available" : "Occupied"}</span></div>${index < 3 ? "" : '<div class="md-table-meta"><small>Waiter</small><b>Abdi</b></div><div class="md-table-metrics"><div><small>Bill</small><b>ETB 240</b></div><div><small>Duration</small><b>12m</b></div></div>'}</button>`).join("")}</div></article><aside class="md-side">${["Kitchen", "Staff / Shift", "Payments / Collections"].map((title) => `<article class="md-panel"><div class="md-panel-title"><strong>${title}</strong></div><dl class="md-health-stats"><div><dt>Active</dt><dd>4</dd></div><div><dt>Waiting</dt><dd>2</dd></div></dl></article>`).join("")}</aside></section>
      <section class="md-recent"><div class="md-recent-list"><div><i></i><strong>Table 4 is in active service</strong><span>Live</span></div></div></section>
    </main>
  `);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1180, height: 820 },
    { width: 820, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const overview = document.querySelector<HTMLElement>(".md-overview")!;
      const main = document.querySelector<HTMLElement>(".md-main-grid")!;
      const floor = document.querySelector<HTMLElement>(".md-floor")!;
      const rail = document.querySelector<HTMLElement>(".md-side")!;
      const cards = [...document.querySelectorAll<HTMLElement>(".md-table")];
      const bodyWidth = document.documentElement.scrollWidth;
      const mainStyle = getComputedStyle(main);
      return {
        bodyWidth,
        viewportWidth: innerWidth,
        overviewRight: overview.getBoundingClientRect().right,
        floorTop: floor.getBoundingClientRect().top,
        railTop: rail.getBoundingClientRect().top,
        mainColumns: mainStyle.gridTemplateColumns.split(" ").length,
        minimumCardWidth: Math.min(
          ...cards.map((card) => card.getBoundingClientRect().width),
        ),
      };
    });

    expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.overviewRight).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.minimumCardWidth).toBeGreaterThan(145);
    if (viewport.width >= 1024) {
      expect(geometry.mainColumns).toBeGreaterThanOrEqual(2);
      expect(Math.abs(geometry.floorTop - geometry.railTop)).toBeLessThan(2);
    } else {
      expect(geometry.railTop).toBeGreaterThan(geometry.floorTop);
    }
  }
});
