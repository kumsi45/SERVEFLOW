import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"),
  "utf8",
);

test("four-queue cashier workspace stays contained at desktop POS widths", async ({ page }) => {
  await page.setContent(`
    <style>${styles}</style>
    <div class="cd-root">
      <header class="cd-header"></header>
      <aside class="cd-pos-nav"></aside>
      <main class="cd-body">
        <section class="cd-kpi-grid"></section>
        <section class="cd-main-grid">
          <div class="cd-card">
            <div class="cd-card-header">
              <div class="cd-tabs" role="tablist">
                ${["Payment Due", "Bill Requested", "Receipt Pending", "Completed"]
                  .map((label, index) => `<button class="cd-tab queue-${["pending", "preparing", "ready", "completed"][index]}${index === 0 ? " active" : ""}"><span class="cd-tab-label">${label}</span><span class="cd-tab-badge">12</span></button>`)
                  .join("")}
              </div>
            </div>
            <div class="cd-order-list">
              <div class="cd-operational-rows">
                <article class="cd-operational-row queue-pending">
                  <div class="cd-row-location"><strong>T12</strong></div>
                  <div class="cd-row-source"><span>Waiter • Abdi</span></div>
                  <div class="cd-row-items" aria-label="20 items. Coffee ×1, Burger ×2, Pizza ×1, and 17 more items">
                    <div class="cd-row-items-detail" aria-hidden="true">
                      <span class="cd-row-items-preview">An intentionally very long coffee menu item ×1 • Burger ×2 • Pizza ×1</span>
                      <span class="cd-row-items-more">+17 more</span>
                    </div>
                  </div>
                  <div class="cd-row-method"><span class="cd-row-payment-value payment-due">Payment Due</span></div>
                  <div class="cd-row-amount"><strong>ETB 2,587.50</strong></div>
                  <div class="cd-row-wait fresh"><strong>2 min</strong></div>
                  <button class="cd-row-action">Verify Payment</button>
                </article>
                <article class="cd-operational-row queue-ready normal-order">
                  <div class="cd-row-location"><strong>T5</strong></div>
                  <div class="cd-row-source"><span>Waiter • Abdi</span></div>
                  <div class="cd-row-items" aria-label="7 items. Coffee ×1, Pizza ×1, Tea ×1, and 4 more items">
                    <div class="cd-row-items-detail" aria-hidden="true">
                      <span class="cd-row-items-preview">Coffee ×1 • Pizza ×1 • Tea ×1</span>
                      <span class="cd-row-items-more">+4 more</span>
                    </div>
                  </div>
                  <div class="cd-row-method"><span class="cd-row-payment-value">Cash</span></div>
                  <div class="cd-row-amount"><strong>ETB 230.00</strong></div>
                  <div class="cd-row-wait warning"><strong>24 min</strong></div>
                  <button class="cd-row-action">Print Receipt</button>
                </article>
              </div>
            </div>
          </div>
        </section>
      </main>
      <aside class="cd-right-panel"></aside>
    </div>
  `);

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(220);
    const geometry = await page.evaluate(() => {
      const select = (selector: string) => document.querySelector<HTMLElement>(selector)!;
      const body = select(".cd-body").getBoundingClientRect();
      const action = select(".cd-row-action").getBoundingClientRect();
      const amount = select(".cd-row-amount strong");
      const row = select(".cd-operational-row").getBoundingClientRect();
      const more = select(".cd-row-items-more").getBoundingClientRect();
      const tabs = [...document.querySelectorAll<HTMLElement>(".cd-tab")]
        .map((tab) => tab.getBoundingClientRect());
      const minimumTabGap = Math.min(
        ...tabs.slice(1).map((tab, index) => tab.left - tabs[index].right),
      );
      const tabStyles = [...document.querySelectorAll<HTMLElement>(".cd-tab")]
        .map((tab) => getComputedStyle(tab));
      const rowStyles = getComputedStyle(select(".cd-operational-row"));
      const singleLineSelectors = [".cd-row-location strong", ".cd-row-source span", ".cd-row-items-preview", ".cd-row-payment-value", ".cd-row-amount strong", ".cd-row-wait strong", ".cd-row-action"];
      return {
        tabsOverflow: select(".cd-tabs").scrollWidth > select(".cd-tabs").clientWidth,
        tabLabelClipped: [...document.querySelectorAll<HTMLElement>(".cd-tab-label")]
          .some((label) => label.scrollWidth > label.clientWidth),
        tabContentOverflow: [...document.querySelectorAll<HTMLElement>(".cd-tab")]
          .map((tab) => tab.scrollWidth - tab.clientWidth),
        listOverflow: select(".cd-order-list").scrollWidth > select(".cd-order-list").clientWidth,
        rowOverflow: select(".cd-operational-row").scrollWidth > select(".cd-operational-row").clientWidth,
        amountClipped: amount.scrollWidth > amount.clientWidth,
        sourceClipped: select(".cd-row-source span").scrollWidth > select(".cd-row-source span").clientWidth,
        stateClipped: select(".cd-row-payment-value").scrollWidth > select(".cd-row-payment-value").clientWidth,
        waitingClipped: select(".cd-row-wait strong").scrollWidth > select(".cd-row-wait strong").clientWidth,
        normalItemsClipped: select(".normal-order .cd-row-items-preview").scrollWidth > select(".normal-order .cd-row-items-preview").clientWidth,
        normalItemsClientWidth: select(".normal-order .cd-row-items-preview").clientWidth,
        normalItemsScrollWidth: select(".normal-order .cd-row-items-preview").scrollWidth,
        rowClientWidth: select(".normal-order").clientWidth,
        rowGridTemplate: getComputedStyle(select(".normal-order")).gridTemplateColumns,
        normalItemsFontSize: getComputedStyle(select(".normal-order .cd-row-items-preview")).fontSize,
        normalSourceClipped: select(".normal-order .cd-row-source span").scrollWidth > select(".normal-order .cd-row-source span").clientWidth,
        normalMoreVisible: select(".normal-order .cd-row-items-more").getBoundingClientRect().width > 0,
        actionContained: action.right <= body.right && action.left >= body.left,
        actionClipped: action.scrollWidth > action.clientWidth,
        rowHeight: row.height,
        moreVisible: more.width > 0 && more.right <= action.left,
        minimumTabGap,
        distinctTabBackgrounds: new Set(tabStyles.map((style) => style.backgroundColor)).size,
        distinctTabColors: new Set(tabStyles.map((style) => style.color)).size,
        inactiveTabsColored: tabStyles.slice(1).every(
          (style) => style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.color !== "rgb(107, 114, 128)",
        ),
        tabHeight: tabs[0].height,
        rowColumns: rowStyles.gridTemplateColumns.split(" ").length,
        allCellsSingleLine: singleLineSelectors.every((selector) => getComputedStyle(select(selector)).whiteSpace === "nowrap"),
        itemEllipsis: getComputedStyle(select(".cd-row-items-preview")).textOverflow === "ellipsis",
      };
    });
    expect(
      geometry.normalItemsClipped,
      `three-item preview must remain readable at ${viewport.width}px (${geometry.normalItemsClientWidth}/${geometry.normalItemsScrollWidth}; row ${geometry.rowClientWidth}; ${geometry.rowGridTemplate}; ${geometry.normalItemsFontSize})`,
    ).toBe(false);
    expect(geometry).toMatchObject({
      tabsOverflow: false,
      tabLabelClipped: false,
      tabContentOverflow: [0, 0, 0, 0],
      listOverflow: false,
      rowOverflow: false,
      amountClipped: false,
      sourceClipped: false,
      stateClipped: false,
      waitingClipped: false,
      normalItemsClipped: false,
      normalSourceClipped: false,
      normalMoreVisible: true,
      actionContained: true,
      actionClipped: false,
      rowHeight: 76,
      moreVisible: true,
      distinctTabBackgrounds: 4,
      distinctTabColors: 4,
      inactiveTabsColored: true,
      tabHeight: 44,
      rowColumns: 7,
      allCellsSingleLine: true,
      itemEllipsis: true,
    });
    expect(geometry.minimumTabGap).toBeGreaterThanOrEqual(5);
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator(".cd-main-grid").evaluate((workspace) => {
    workspace.style.width = "560px";
    workspace.style.maxWidth = "560px";
  });
  const constrained = await page.evaluate(() => {
    const select = (selector: string) => document.querySelector<HTMLElement>(selector)!;
    const row = select(".cd-operational-row");
    const action = select(".cd-row-action");
    const amount = select(".cd-row-amount strong");
    const tabs = select(".cd-tabs");
    return {
      rowOverflow: row.scrollWidth > row.clientWidth,
      actionClipped: action.scrollWidth > action.clientWidth,
      amountClipped: amount.scrollWidth > amount.clientWidth,
      actionInsideRow: action.getBoundingClientRect().right <= row.getBoundingClientRect().right,
      tabContentClipped: [...document.querySelectorAll<HTMLElement>(".cd-tab")]
        .some((tab) => tab.scrollWidth > tab.clientWidth),
      tabColumns: getComputedStyle(tabs).gridTemplateColumns.split(" ").length,
    };
  });
  expect(constrained).toEqual({
    rowOverflow: false,
    actionClipped: false,
    amountClipped: false,
    actionInsideRow: true,
    tabContentClipped: false,
    tabColumns: 4,
  });
});

test("cashier toasts stay compact and clear of primary controls", async ({ page }) => {
  await page.setContent(`
    <style>${styles}</style>
    <div class="cd-root">
      <header class="cd-header"></header>
      <button id="queue-action" style="position:fixed;left:42%;top:240px;width:140px;height:44px">Verify Payment</button>
      <section id="checkout-totals" style="position:fixed;right:20px;top:340px;width:360px;height:220px">Checkout totals</section>
      <section class="cd-toast-viewport">
        <article class="cd-toast success" role="status">
          <span class="cd-toast-icon"></span>
          <span class="cd-toast-content"><strong>Payment verified</strong><span>Invoice #234 · ETB 3,795</span></span>
          <button class="cd-toast-close">×</button>
        </article>
      </section>
    </div>
  `);

  for (const viewport of [
    { width: 1366, height: 768, expectedWidth: 360, expectedRight: 20 },
    { width: 1920, height: 1080, expectedWidth: 380, expectedRight: 24 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(220);
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      const toast = rect(".cd-toast");
      const queueAction = rect("#queue-action");
      const checkoutTotals = rect("#checkout-totals");
      const overlaps = (left: DOMRect, right: DOMRect) =>
        left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
      return {
        width: Math.round(toast.width),
        right: Math.round(window.innerWidth - toast.right),
        belowHeader: toast.top >= 92,
        queueActionClear: !overlaps(toast, queueAction),
        checkoutTotalsClear: !overlaps(toast, checkoutTotals),
      };
    });
    expect(geometry).toEqual({
      width: viewport.expectedWidth,
      right: viewport.expectedRight,
      belowHeader: true,
      queueActionClear: true,
      checkoutTotalsClear: true,
    });
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".cd-toast")).toHaveCSS("animation-name", "none");
});
