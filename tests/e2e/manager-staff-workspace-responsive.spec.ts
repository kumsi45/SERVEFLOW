import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerStaffOperations.css"), "utf8");

function staffCard(index: number) {
  return `<button class="mso-staff-row"><span class="mso-staff-identity"><span class="mso-avatar">S${index}</span><span><strong>Staff member ${index}</strong><small>WT-0000${index}</small></span></span><span data-label="Role">Waiter</span><span data-label="Shift"><span class="mso-not-recorded">Not recorded</span></span><span data-label="Status"><span class="mso-status-pill ${index % 2 ? "busy" : "healthy"}"><span></span>${index % 2 ? "Busy" : "Available"}</span></span><span data-label="Current work" class="mso-current-work">Tables 5, 8, 9</span><span class="mso-chevron">›</span></button>`;
}

test("staff overview stays contained and touch-friendly at required widths", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}html,body{margin:0}</style>
    <main class="mso-page">
      <header class="mso-page-header"><div><p>Tenant</p><h1>Staff</h1><span>Live workforce status</span></div><button class="mso-primary-action">+ Add Staff</button></header>
      <nav class="mso-tabs"><button class="active">Overview</button><button>Directory</button><button>Shift Status</button><button>Create Staff</button></nav>
      <section class="mso-metrics">${["On Shift", "Available", "Busy", "On Break", "Off Shift"].map((label) => `<div><span>${label}</span><strong>2</strong><small>Current state</small></div>`).join("")}</section>
      <section class="mso-panel"><div class="mso-section-heading"><div><p>Current workforce</p><h2>Live Staff</h2></div></div><div class="mso-data-list mso-live-list"><div class="mso-list-header"><span>Staff</span><span>Role</span><span>Shift</span><span>Status</span><span>Current Work</span><span></span></div>${[1, 2, 3, 4].map(staffCard).join("")}</div></section>
    </main>
  `);

  for (const viewport of [
    { width: 1440, height: 900, cards: 1 },
    { width: 1024, height: 800, cards: 1 },
    { width: 768, height: 1024, cards: 2 },
    { width: 390, height: 844, cards: 2 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(".mso-staff-row")];
      const firstTop = cards[0].getBoundingClientRect().top;
      const cardsInFirstRow = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2).length;
      const tab = document.querySelector<HTMLElement>(".mso-tabs button")!.getBoundingClientRect();
      const add = document.querySelector<HTMLElement>(".mso-primary-action")!.getBoundingClientRect();
      return { cardsInFirstRow, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, tabHeight: tab.height, addHeight: add.height };
    });
    expect(geometry.cardsInFirstRow).toBe(viewport.cards);
    expect(geometry.overflow).toBe(false);
    expect(geometry.addHeight).toBeGreaterThanOrEqual(44);
    if (viewport.width <= 820) expect(geometry.tabHeight).toBeGreaterThanOrEqual(44);
  }
});

test("staff inspector is a side drawer and becomes full screen on mobile", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}html,body{margin:0}</style>
    <main class="mso-page"><section class="mso-panel">Staff behind drawer</section></main>
    <button class="mso-drawer-backdrop"></button><aside class="mso-inspector"><header><div><p>Waiter</p><h2>Abdi</h2><span>WT-00002</span></div><button>×</button></header><div class="mso-inspector-body"><section><h3>Current Status</h3><dl><div><dt>Shift</dt><dd>Not recorded</dd></div></dl></section></div></aside>
  `);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>(".mso-inspector")!.getBoundingClientRect();
      const close = document.querySelector<HTMLElement>(".mso-inspector header button")!.getBoundingClientRect();
      return { width: drawer.width, right: drawer.right, close: Math.min(close.width, close.height), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.right).toBe(viewport.width);
    expect(geometry.close).toBeGreaterThanOrEqual(44);
    expect(geometry.overflow).toBe(false);
    if (viewport.width <= 560) expect(geometry.width).toBe(viewport.width);
    else expect(geometry.width).toBeLessThanOrEqual(430);
  }
});

test("directory header and rows align without overlap and become mobile cards", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}html,body{margin:0}</style>
    <main class="mso-page"><section class="mso-panel">
      <div class="mso-section-heading"><div><p>People and access</p><h2>Directory</h2></div><span>2 results</span></div>
      <div class="mso-directory-toolbar"><label class="mso-search"><span>⌕</span><input placeholder="Search staff…"></label><select><option>All roles</option></select><select><option>All statuses</option></select><select><option>All shifts</option></select></div>
      <div class="mso-data-list mso-directory-list">
        <div class="mso-list-header"><span>Staff</span><span>Role</span><span>Shift</span><span>Status</span><span>Current Work</span><span></span></div>
        <button class="mso-directory-row"><span class="mso-staff-identity"><span class="mso-avatar">AL</span><span><strong>Alexandria Extremely Long Employee Name</strong><small>IO-00003</small></span></span><span data-label="Role">Inventory Officer With Long Role Name</span><span data-label="Shift"><span class="mso-not-recorded">Not recorded</span></span><span data-label="Status"><span class="mso-status-pill healthy"><span></span>Available</span></span><span data-label="Current work" class="mso-current-work">Inventory workspace with extended responsibility</span><span class="mso-chevron">›</span></button>
        <button class="mso-directory-row"><span class="mso-staff-identity"><span class="mso-avatar">AM</span><span><strong>Amar</strong><small>KT-00002</small></span></span><span data-label="Role">Kitchen Staff</span><span data-label="Shift"><span class="mso-not-recorded">Not recorded</span></span><span data-label="Status"><span class="mso-status-pill warning"><span></span>On break</span></span><span data-label="Current work" class="mso-current-work">Beverages</span><span class="mso-chevron">›</span></button>
      </div>
    </section></main>
  `);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".mso-directory-list .mso-list-header")!;
      const row = document.querySelector<HTMLElement>(".mso-directory-row")!;
      const inputs = [...document.querySelectorAll<HTMLElement>(".mso-directory-toolbar input, .mso-directory-toolbar select")];
      const headerStyle = getComputedStyle(header);
      const rowStyle = getComputedStyle(row);
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        headerDisplay: headerStyle.display,
        headerColumns: headerStyle.gridTemplateColumns,
        rowColumns: rowStyle.gridTemplateColumns,
        rowRight: row.getBoundingClientRect().right,
        rowWidth: row.getBoundingClientRect().width,
        filterContained: inputs.every((input) => input.getBoundingClientRect().right <= innerWidth),
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.rowRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.filterContained).toBe(true);
    if (viewport.width > 640) {
      expect(geometry.headerDisplay).toBe("grid");
      expect(geometry.rowColumns).toBe(geometry.headerColumns);
    } else {
      expect(geometry.headerDisplay).toBe("none");
      expect(geometry.rowWidth).toBeLessThanOrEqual(viewport.width - 20);
    }
  }
});
