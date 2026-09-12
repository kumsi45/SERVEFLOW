import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const css = readFileSync(resolve(process.cwd(), "src/modules/owner/styles/ownerDashboard.css"), "utf8");
const markup = `<meta name="viewport" content="width=device-width, initial-scale=1"><div class="od-root"><main class="od-main"><section class="od-page od-operations-page od-qr-experience"><section class="od-tables-summary"><div><strong>15</strong><span>Tables</span></div><div><strong>3</strong><span>Occupied</span></div><div><strong>11</strong><span>Available</span></div><div><strong>1</strong><span>Disabled</span></div></section><section class="od-tables-workspace"><div class="od-tables-toolbar"><input aria-label="Search tables"><select aria-label="Filter tables by status"><option>All</option></select><button>Print QR</button></div><div class="od-tables-desktop-list"><table class="od-tables-table"><tbody><tr><td>Table 01</td><td>Occupied</td></tr></tbody></table></div><div class="od-tables-mobile-list"><article class="od-tables-mobile-row"><div><strong>Table 01</strong></div><span>Occupied</span><div class="od-tables-mobile-meta"><span>QR Ready</span><span>4 orders today</span></div><button aria-label="Actions for Table 01">⋮</button></article></div></section></section></main><nav class="od-mobile-bottom-nav"><button>Tables</button></nav></div>`;

async function load(page: Page, width: number) { await page.setViewportSize({ width, height: 800 }); await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;max-width:100%}${css}</style>${markup}`); }

const detailsMarkup = `<meta name="viewport" content="width=device-width, initial-scale=1"><div class="od-root"><main><button class="od-table-details-trigger">Table 01 with a deliberately long configured dining-room label</button></main><nav class="od-mobile-bottom-nav"><button>Tables</button></nav><div class="od-table-details-layer"><aside class="od-table-details" role="dialog" aria-modal="true"><header><div><span>TABLE DETAILS</span><h2>Table 01</h2><p>A deliberately long configured dining-room label</p></div><button aria-label="Close table details">×</button></header><section><h3>Current state</h3><dl class="od-table-details-state"><div><dt>Occupancy</dt><dd>Occupied</dd></div><div><dt>Ordering</dt><dd>Disabled</dd></div></dl></section><section><h3>QR code</h3><div class="od-table-details-actions"><button>View QR</button><button>Print QR</button></div></section><section class="od-table-details-security"><h3>QR security</h3><p>Replacing this QR disables every existing printed copy.</p><button>Replace QR Code</button></section></aside></div></div>`;

for (const [width, height] of [[360, 800], [390, 844], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1280, 800], [1440, 900]]) test(`table details fits ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;max-width:100%}${css}</style>${detailsMarkup}`);
  const details = page.locator(".od-table-details");
  await expect(details).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await details.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(width);
  expect(box?.height).toBeLessThanOrEqual(height);
  await expect(page.getByRole("button", { name: "Close table details" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace QR Code" })).toBeVisible();
});

for (const width of [1440, 1280, 1024, 820, 768]) test(`tables desktop layout fits ${width}px`, async ({ page }) => { await load(page, width); await expect(page.locator(".od-tables-desktop-list")).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); });
for (const width of [430, 390, 360]) test(`tables use native mobile rows at ${width}px`, async ({ page }) => { await load(page, width); await expect(page.locator(".od-tables-desktop-list")).toBeHidden(); await expect(page.locator(".od-tables-mobile-list")).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); });
