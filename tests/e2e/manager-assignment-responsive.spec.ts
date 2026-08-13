import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const liveStyles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerOperationsCenter.css"), "utf8");
const kitchenStyles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerKitchenSupervision.css"), "utf8");

test("waiter assignment is compact on desktop and full-screen on mobile", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${liveStyles}html,body{margin:0}</style>
    <main class="moc-page"><section class="moc-panel"><div class="moc-coverage-strip"><div><strong>Unassigned Locations</strong><span>2 active service locations need coverage.</span></div><div class="moc-unassigned-list"><button><span><strong>Table 4</strong><small>Active session</small></span>Assign waiter</button></div></div></section></main>
    <div class="moc-assignment-layer"><section class="moc-assignment-dialog"><header><div><span>Assign Waiter</span><h2>Table 8</h2><p>Current waiter: Abdi</p></div><button>×</button></header><div class="moc-waiter-list"><label class="selected"><input type="radio"><span><strong>Ahmed With A Very Long Staff Name</strong><small>2 tables · 1 active order</small></span><em class="available">Available</em></label><label><input type="radio"><span><strong>Sara</strong><small>5 tables · 3 active orders</small></span><em class="busy">Busy</em></label></div><footer><button class="secondary">Cancel</button><button>Reassign</button></footer></section></div>
  `);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>(".moc-assignment-dialog")!.getBoundingClientRect();
      const close = document.querySelector<HTMLElement>(".moc-assignment-dialog header button")!.getBoundingClientRect();
      const action = document.querySelector<HTMLElement>(".moc-assignment-dialog footer button:last-child")!.getBoundingClientRect();
      return { width: dialog.width, height: dialog.height, right: dialog.right, overflow: document.documentElement.scrollWidth > innerWidth, close: close.height, action: action.height };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.close).toBeGreaterThanOrEqual(44);
    expect(geometry.action).toBeGreaterThanOrEqual(44);
    if (viewport.width <= 767) {
      expect(geometry.width).toBe(viewport.width);
      expect(geometry.height).toBe(viewport.height);
    } else expect(geometry.width).toBeLessThanOrEqual(520);
  }
});

test("kitchen staff selector is responsive and preserves readable workload context", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${kitchenStyles}html,body{margin:0}</style>
    <main class="mks-page"><section class="mks-panel"><div class="mks-station-list"><button class="mks-station-row critical"><span class="mks-station-name"><strong>Beverages</strong><em>Critical</em></span><span class="mks-station-load">Queue 5 · Preparing 0</span><span class="mks-station-meta">Staff 0 <b>· No active kitchen staff</b></span><b>›</b></button></div></section></main>
    <div class="mks-staffing-layer"><section class="mks-staffing-dialog"><header><div><span>Station Staff</span><h2>Beverages</h2><p>Current active staff: None</p></div><button>×</button></header><div class="mks-kitchen-staff-list"><article><span><strong>Alemu With A Very Long Staff Name</strong><small>KT-00004 · Main Kitchen</small></span><em class="on-shift">On shift</em><button>Move here</button></article><article><span><strong>Hana</strong><small>KT-00005 · No station</small></span><em>Offline</em><button>Assign</button></article></div><footer><button>Close</button></footer></section></div>
  `);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>(".mks-staffing-dialog")!.getBoundingClientRect();
      const close = document.querySelector<HTMLElement>(".mks-staffing-dialog header button")!.getBoundingClientRect();
      const action = document.querySelector<HTMLElement>(".mks-kitchen-staff-list button")!.getBoundingClientRect();
      return { width: dialog.width, height: dialog.height, overflow: document.documentElement.scrollWidth > innerWidth, close: close.height, action: action.height };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.close).toBeGreaterThanOrEqual(44);
    if (viewport.width <= 767) {
      expect(geometry.width).toBe(viewport.width);
      expect(geometry.height).toBe(viewport.height);
      expect(geometry.action).toBeGreaterThanOrEqual(44);
    } else expect(geometry.width).toBeLessThanOrEqual(540);
  }
});
