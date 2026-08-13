import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerRestaurantIntelligence.css"), "utf8");

test("Business Intelligence reflows without horizontal page overflow", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}html,body{margin:0;background:#f6f7f9}.mri-page{padding:12px;box-sizing:border-box}</style>
    <main class="mri-page">
      <section class="mri-toolbar"><p>Forward-looking guidance for upcoming service, operational risks, and preparation.</p><div class="mri-toolbar-controls"><div class="mri-horizons"><button>Today</button><button>Tomorrow</button><button class="active">Next Service</button></div><div class="mri-updated"><span>Updated 10:30 AM</span><button>Refresh</button></div></div></section>
      <section class="mri-next"><header><div><span>Next Service</span><h2>Lunch service</h2><p>12 PM–1 PM</p></div><b>History supported</b></header><div class="mri-readiness">${["Demand", "Staffing", "Kitchen", "Inventory"].map((label) => `<div><span>${label}</span><strong>${label === "Demand" ? "Elevated" : "No current risk"}</strong></div>`).join("")}</div><p class="mri-evidence">Based on recent completed operating days.</p><section class="mri-preparation"><h3>Recommended Preparation</h3><ul><li>Review service coverage before 12 PM.</li><li>Review beverage station readiness.</li></ul></section></section>
      <div class="mri-decision-grid">${["Operational Risks", "Business Opportunities"].map((title) => `<section class="mri-section"><header><div><span>Decision signals</span><h2>${title}</h2></div></header><div class="mri-signal-list"><article class="mri-signal attention"><header><span>Kitchen</span><b>Attention</b></header><h3>Preparation pattern needs review before the upcoming service window</h3><p>This condition may affect service readiness.</p><dl><div><dt>Evidence</dt><dd>Existing operational evidence with an intentionally long description.</dd></div><div><dt>Prepare</dt><dd>Review station coverage before demand increases.</dd></div></dl></article></div></section>`).join("")}</div>
      <section class="mri-section mri-tomorrow"><header><div><span>Next operating day</span><h2>Tomorrow's Preparation</h2></div><b class="limited">Forecast limited</b></header><p class="mri-tomorrow-note">More comparable operating history is required.</p><div class="mri-tomorrow-grid">${["Demand", "Inventory", "Staffing", "Kitchen"].map((label) => `<article><span>${label}</span><p>Forecast not yet available from supported history.</p></article>`).join("")}</div></section>
    </main>`);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const decisions = getComputedStyle(document.querySelector<HTMLElement>(".mri-decision-grid")!).gridTemplateColumns.split(" ").length;
      const readiness = getComputedStyle(document.querySelector<HTMLElement>(".mri-readiness")!).gridTemplateColumns.split(" ").length;
      const horizon = document.querySelector<HTMLElement>(".mri-horizons button")!.getBoundingClientRect();
      const root = document.querySelector<HTMLElement>(".mri-page")!.getBoundingClientRect();
      return { decisions, readiness, horizonHeight: horizon.height, rootRight: root.right, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.rootRight).toBeLessThanOrEqual(viewport.width);
    if (viewport.width <= 760) {
      expect(geometry.decisions).toBe(1);
      expect(geometry.horizonHeight).toBeGreaterThanOrEqual(44);
    } else expect(geometry.decisions).toBe(2);
    if (viewport.width <= 480) expect(geometry.readiness).toBe(1);
    else if (viewport.width <= 1000) expect(geometry.readiness).toBe(2);
    else expect(geometry.readiness).toBe(4);
  }
});
