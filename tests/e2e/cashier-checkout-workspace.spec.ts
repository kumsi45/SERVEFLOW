import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"),
  "utf8",
);

const visibleItems = Array.from({ length: 7 }, (_, index) => `
  <div class="cd-drawer-item">
    <div class="cd-drawer-item-name">
      <span>Long service item name ${index + 1} with extra preparation text</span><strong>×${(index % 3) + 1}</strong>
      <div class="cd-drawer-item-modifiers">No onions, extra sauce, table note ${index + 1}</div>
    </div>
    <div class="cd-drawer-item-price">ETB ${180 + index * 7}</div>
  </div>
`).join("");

function drawerFixture(status: string, action: string) {
  return `
    <section class="cd-drawer cd-checkout-slide-over status-${status}" role="dialog" aria-modal="true" aria-labelledby="cashier-checkout-drawer-title">
      <header class="cd-drawer-header">
        <div class="cd-checkout-heading">
          <span class="cd-checkout-label">Checkout</span>
          <h2 class="cd-drawer-title" id="cashier-checkout-drawer-title">Table 9</h2>
          <div class="cd-checkout-assignee" aria-label="Waiter: Abdi"><span>Waiter</span><i>•</i><strong>Abdi</strong></div>
        </div>
        <div class="cd-checkout-header-actions">
          <span class="cd-checkout-status-badge ${status}" aria-label="Current queue status: ${action}"><i></i>${action}</span>
          <button class="cd-drawer-close" aria-label="Close checkout">&times;</button>
        </div>
      </header>
      <div class="cd-drawer-body">
        <section class="cd-checkout-order-summary" aria-label="Items and bill summary">
          <div class="cd-checkout-item-count">32 items</div>
          <div class="cd-drawer-items">${visibleItems}</div>
          <button type="button" class="cd-checkout-hidden-items" aria-expanded="false">Show 25 more items</button>
          <div class="cd-checkout-breakdown">
            <span>Subtotal</span><strong>ETB 520.00</strong>
            <span>VAT</span><strong>ETB 78.00</strong>
            <span>Service Charge</span><strong>ETB 52.00</strong>
            <span>Discount</span><strong>- ETB 17.50</strong>
            <span class="cd-checkout-total-row">Total</span><strong class="cd-checkout-total-row">ETB 632.50</strong>
          </div>
        </section>
        <section class="cd-payment-method-panel" aria-labelledby="checkout-payment-method-title">
          <label id="checkout-payment-method-title" for="cashier-checkout-payment-method">Payment Method</label>
          <select id="cashier-checkout-payment-method" ${status === "payment-due" ? "" : "disabled"}>
            <option>${status === "payment-due" ? "Not Selected" : "Telebirr"}</option>
          </select>
          <div class="cd-payment-evidence-card">
            <div class="cd-payment-evidence-heading">Payment Evidence</div>
            <div><span>Reference Number <em>Required</em></span><strong>FT3421189</strong></div>
            <div><span>Screenshot <em>Optional</em></span><strong>Uploaded</strong></div>
            <div class="cd-payment-screenshot-row">
              <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%2315803d'/%3E%3C/svg%3E" alt="">
              <div><strong>Payment screenshot</strong><span>Aug 3, 12:15 PM</span></div>
              <button type="button" id="view-shot">View Screenshot</button>
            </div>
          </div>
        </section>
      </div>
      <footer class="cd-drawer-footer">
        <div class="cd-checkout-footer-actions">
          <button class="cd-checkout-secondary-action">Release Table</button>
          <button class="cd-checkout-primary-action">${status === "payment-due" ? "Verify Payment" : status === "bill-requested" ? "Print Bill" : status === "receipt-pending" ? "Print Receipt" : "Reprint Receipt"}</button>
        </div>
      </footer>
    </section>
  `;
}

test("checkout is a fixed, compact, mode-aware single-screen drawer", async ({ page }) => {
  await page.setContent(`
    <style>${styles}html,body{margin:0}.cd-checkout-slide-over{animation:none!important}</style>
    <div class="cd-root">
      <header class="cd-header"></header>
      <aside class="cd-pos-nav"></aside>
      <main class="cd-body"><button class="cd-row-action">Verify Payment</button></main>
      <aside class="cd-right-panel" aria-label="Service locations"><section class="cd-location-switch">Quick Switch</section></aside>
    </div>
  `);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator(".cd-checkout-slide-over")).toHaveCount(0);
  await page.locator(".cd-root").evaluate((root, html) => root.insertAdjacentHTML("afterend", html), drawerFixture("payment-due", "Payment Due"));

  const open = await page.locator(".cd-checkout-slide-over").evaluate((drawer) => {
    const body = drawer.querySelector<HTMLElement>(".cd-drawer-body")!;
    const footer = drawer.querySelector<HTMLElement>(".cd-drawer-footer")!.getBoundingClientRect();
    const primary = drawer.querySelector<HTMLElement>(".cd-checkout-primary-action")!.getBoundingClientRect();
    const secondary = drawer.querySelector<HTMLElement>(".cd-checkout-secondary-action")!.getBoundingClientRect();
      const itemRows = Array.from(drawer.querySelectorAll<HTMLElement>(".cd-drawer-item"));
      const summary = drawer.querySelector<HTMLElement>(".cd-checkout-order-summary")!.getBoundingClientRect();
      const breakdown = drawer.querySelector<HTMLElement>(".cd-checkout-breakdown")!.getBoundingClientRect();
      const payment = drawer.querySelector<HTMLElement>(".cd-payment-method-panel")!.getBoundingClientRect();
      return {
      right: Math.round(drawer.getBoundingClientRect().right),
      closeTarget: drawer.querySelector<HTMLElement>(".cd-drawer-close")!.getBoundingClientRect().width >= 38,
      footerVisible: footer.bottom <= window.innerHeight,
      actionWidth: Math.round(primary.width),
      footerWidth: Math.round(footer.width),
      actionsAligned: Math.abs(primary.top - secondary.top) <= 1,
      orderRows: drawer.querySelectorAll(".cd-drawer-item").length,
      allRowsVisible: itemRows.every((row) => row.getBoundingClientRect().height >= 26),
      hiddenSummary: drawer.querySelector(".cd-checkout-hidden-items")?.textContent,
      billSummaryVisible: breakdown.height > 0 && breakdown.bottom <= summary.bottom,
      billBeforePayment: summary.bottom <= payment.top,
      selectors: drawer.querySelectorAll("select#cashier-checkout-payment-method").length,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      bodyOverflow: getComputedStyle(body).overflowY,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      drawerOverflow: (drawer as HTMLElement).scrollWidth > (drawer as HTMLElement).clientWidth,
    };
  });
  expect(open).toMatchObject({
    right: 1366,
    closeTarget: true,
    footerVisible: true,
    orderRows: 7,
    allRowsVisible: true,
    actionsAligned: true,
    hiddenSummary: "Show 25 more items",
    billSummaryVisible: true,
    billBeforePayment: true,
    selectors: 1,
    bodyScrolls: false,
    bodyOverflow: "auto",
    pageOverflow: false,
    drawerOverflow: false,
  });
  expect(open.actionWidth).toBeGreaterThan(open.footerWidth * .5);

  for (const [status, label, primaryLabel] of [
    ["bill-requested", "Bill Requested", "Print Bill"],
    ["receipt-pending", "Receipt Pending", "Print Receipt"],
    ["completed", "Completed", "Reprint Receipt"],
  ] as const) {
    await page.locator(".cd-checkout-slide-over").evaluate((node, html) => { node.outerHTML = html; }, drawerFixture(status, label));
    await expect(page.locator(".cd-checkout-status-badge")).toHaveText(label);
    await expect(page.locator(".cd-checkout-primary-action")).toHaveText(primaryLabel);
    await expect(page.locator(".cd-checkout-secondary-action")).toHaveText("Release Table");
  }
});

test("checkout remains visible without scrolling at supported desktop sizes", async ({ page }) => {
  await page.setContent(`<style>${styles}html,body{margin:0}.cd-checkout-slide-over{animation:none!important}</style>${drawerFixture("payment-due", "Payment Due")}`);
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.locator(".cd-checkout-slide-over").evaluate((drawer) => {
      const rect = drawer.getBoundingClientRect();
      const body = drawer.querySelector<HTMLElement>(".cd-drawer-body")!;
      const footer = drawer.querySelector<HTMLElement>(".cd-drawer-footer")!.getBoundingClientRect();
      return {
        width: Math.round(rect.width), right: Math.round(rect.right), footerVisible: footer.bottom <= window.innerHeight,
        bodyScrolls: body.scrollHeight > body.clientHeight,
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        drawerOverflow: (drawer as HTMLElement).scrollWidth > (drawer as HTMLElement).clientWidth,
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(520);
    expect(geometry.width).toBeLessThanOrEqual(620);
    expect(geometry).toMatchObject({ right: viewport.width, footerVisible: true, bodyScrolls: false, pageOverflow: false, drawerOverflow: false });
  }
});

test("screenshot preview remains read-only and returns focus", async ({ page }) => {
  await page.setContent(`
    <style>${styles}html,body{margin:0}[hidden]{display:none!important}</style>${drawerFixture("payment-due", "Payment Due")}
    <div id="preview" class="cd-screenshot-preview" role="dialog" aria-modal="true" aria-label="Payment screenshot preview" hidden>
      <header><strong>Payment Screenshot</strong><div><button>Zoom</button><button id="close-preview">Close</button></div></header>
      <div class="cd-screenshot-stage fit"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3C/svg%3E" alt="Payment screenshot"></div>
    </div>
    <script>
      const trigger=document.getElementById("view-shot"),preview=document.getElementById("preview"),close=document.getElementById("close-preview");
      trigger.addEventListener("click",()=>{preview.hidden=false;close.focus()});
      close.addEventListener("click",()=>{preview.hidden=true;trigger.focus()});
      document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!preview.hidden){preview.hidden=true;trigger.focus()}});
    </script>
  `);
  await page.locator("#view-shot").click();
  await expect(page.locator("#preview")).toBeVisible();
  await expect(page.getByText("Upload Screenshot")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#preview")).toBeHidden();
  await expect(page.locator("#view-shot")).toBeFocused();
});
