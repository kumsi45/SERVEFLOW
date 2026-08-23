import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const liveStyles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerOperationsCenter.css"), "utf8");
const assignmentStyles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerWaiterTableAssignments.css"), "utf8");
const kitchenStyles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerKitchenSupervision.css"), "utf8");

test("waiter multi-table assignment is responsive at all target widths", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${liveStyles}${assignmentStyles}html,body{margin:0}</style>
    <main class="moc-page"><section class="moc-panel mwta-shell"><div class="mwta-heading"><div><span>Current responsibility</span><h2>Table Assignments</h2><p>Assign operational table responsibility without changing occupancy.</p></div><button>Assign Tables</button></div><div class="mwta-board"><article class="mwta-waiter"><header><span><strong>Ahmed With A Very Long Staff Name</strong><small>3 tables</small></span><button>Manage</button></header><div class="mwta-table-chips"><span><b>Table 1</b><small>Occupied</small></span><span><b>Table 2</b><small>Available</small></span></div></article><article class="mwta-waiter mwta-unassigned"><header><span><strong>Unassigned Tables</strong><small>1 table</small></span><button>Assign</button></header><div class="mwta-table-chips"><span><b>Table 8</b><small>Occupied</small></span></div></article></div></section></main>
    <div class="mwta-layer"><section class="mwta-dialog"><header><div><span>Table Assignments</span><h2>Assign Tables</h2><p>Choose a Waiter, then select one or more tables.</p></div><button>×</button></header><div class="mwta-dialog-body"><section class="mwta-step"><div class="mwta-step-title"><b>1</b><span><strong>Select Waiter</strong><small>Active Waiters only</small></span></div><select><option>Ahmed With A Very Long Staff Name — 3 tables</option></select></section><section class="mwta-step"><div class="mwta-step-title"><b>2</b><span><strong>Select Tables</strong><small>3 tables selected</small></span></div><div class="mwta-table-options"><label class="selected"><input type="checkbox" checked><span><strong>Table 5</strong><small><em class="occupied">Occupied</em>Currently assigned to Abdi</small></span></label><label class="selected"><input type="checkbox" checked><span><strong>Table 6</strong><small><em>Available</em>Unassigned</small></span></label><label class="selected"><input type="checkbox" checked><span><strong>Table 7</strong><small><em class="occupied">Occupied</em>Currently assigned to Hana</small></span></label></div></section><section class="mwta-summary"><strong>3 tables will be assigned.</strong><p>2 tables currently belong to another Waiter.</p><small>Existing orders, payments, kitchen state, and occupancy remain unchanged.</small></section></div><footer><button class="secondary">Cancel</button><button class="unassign">Move selected to Unassigned</button><button>Confirm Assignment</button></footer></section></div>
  `);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>(".mwta-dialog")!.getBoundingClientRect();
      const close = document.querySelector<HTMLElement>(".mwta-dialog header button")!.getBoundingClientRect();
      const action = document.querySelector<HTMLElement>(".mwta-dialog footer button:last-child")!.getBoundingClientRect();
      const board = document.querySelector<HTMLElement>(".mwta-board")!.getBoundingClientRect();
      return { width: dialog.width, height: dialog.height, boardRight: board.right, overflow: document.documentElement.scrollWidth > innerWidth, close: close.height, action: action.height };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.boardRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.close).toBeGreaterThanOrEqual(44);
    expect(geometry.action).toBeGreaterThanOrEqual(44);
    if (viewport.width <= 767) {
      expect(geometry.width).toBe(viewport.width);
      expect(geometry.height).toBe(viewport.height);
    } else expect(geometry.width).toBeLessThanOrEqual(700);
  }
});

test("chef selector is responsive and preserves readable workload context", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${kitchenStyles}html,body{margin:0}</style>
    <main class="mks-page"><section class="mks-panel"><div class="mks-station-list"><button class="mks-station-row critical"><span class="mks-station-name"><strong>Beverages</strong><em>Critical</em></span><span class="mks-station-load">Queue 5 · Preparing 0</span><span class="mks-station-meta">Chefs 0 <b>· No active chefs</b></span><b>›</b></button></div></section></main>
    <div class="mks-staffing-layer"><section class="mks-staffing-dialog"><header><div><span>Station Chefs</span><h2>Beverages</h2><p>Current chefs: None</p></div><button>×</button></header><div class="mks-kitchen-staff-list"><article><span><strong>Alemu With A Very Long Staff Name</strong><small>Chef · KT-00004 · Main Kitchen</small></span><em class="on-shift">On shift</em><button>Move here</button></article><article><span><strong>Hana</strong><small>Chef · KT-00005 · No station</small></span><em>Offline</em><button>Assign</button></article></div><footer><button>Close</button></footer></section></div>
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
