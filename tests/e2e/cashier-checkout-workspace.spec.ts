import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"),
  "utf8",
);

const thirtyItems = Array.from({ length: 32 }, (_, index) => `
  <div class="cd-drawer-item">
    <div class="cd-drawer-item-name">
      Long service item name ${index + 1} with extra preparation text <span>x${(index % 3) + 1}</span>
      <div class="cd-drawer-item-modifiers">No onions, extra sauce, table note ${index + 1}</div>
    </div>
    <div class="cd-drawer-item-price">ETB ${180 + index * 7}</div>
  </div>
`).join("");

function drawerFixture(status: string, action: string) {
  const evidence = status === "payment-due" || status === "receipt-pending" || status === "completed"
    ? `<section class="cd-payment-verification-box" aria-labelledby="checkout-payment-verification-title">
        <div class="cd-drawer-section-title" id="checkout-payment-verification-title">${status === "payment-due" ? "Payment Verification" : "Payment Evidence"}</div>
        ${status === "payment-due"
          ? `<div class="cd-payment-method-grid" role="radiogroup" aria-label="Payment Method">
              <button role="radio" aria-checked="false"><span>Cash</span></button>
              <button class="selected" role="radio" aria-checked="true"><span>Telebirr</span></button>
              <button role="radio" aria-checked="false"><span>CBE Birr</span></button>
            </div>`
          : `<div class="cd-readonly-payment-method"><span>Payment Method</span><strong>Telebirr</strong></div>`}
        <div class="cd-digital-payment-details">
          <div><span>Reference Number</span><strong>FT3421189</strong></div>
          <div class="cd-payment-evidence-card">
            <div><span>Payment Method</span><strong>Telebirr</strong></div>
            <div><span>Reference</span><strong>FT3421189</strong></div>
            <div><span>Screenshot</span><strong>Uploaded</strong></div>
            <div class="cd-payment-screenshot-row">
              <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%2315803d'/%3E%3C/svg%3E" alt="">
              <div><strong>Payment screenshot</strong><span>Aug 3, 12:15 PM</span></div>
              <button type="button" id="view-shot">View Screenshot</button>
            </div>
          </div>
        </div>
      </section>`
    : "";
  return `
    <section class="cd-drawer cd-checkout-slide-over status-${status}" role="dialog" aria-modal="true" aria-labelledby="cashier-checkout-drawer-title">
      <header class="cd-drawer-header">
        <div class="cd-checkout-topline">
          <span>Checkout</span>
          <button class="cd-drawer-close" aria-label="Close checkout">&times;</button>
        </div>
        <div class="cd-checkout-heading">
          <h2 class="cd-drawer-title" id="cashier-checkout-drawer-title">Service Location 9</h2>
          <div class="cd-checkout-assignee" aria-label="Waiter: Abdi"><span>Waiter</span><i>•</i><strong>Abdi</strong></div>
        </div>
        <span class="cd-checkout-status-badge ${status}" aria-label="Current queue status: ${action}"><i></i>${action}</span>
      </header>
      <div class="cd-drawer-body">
        <section class="cd-checkout-meta" aria-label="Transaction information"><span>Inv 42</span><span>Created 12:03 PM</span><span>${action}</span></section>
        <div class="cd-checkout-scroll-region">
          <section class="cd-checkout-items-panel" aria-labelledby="checkout-items-title">
            <div class="cd-drawer-section-title" id="checkout-items-title">Order Items <span>32</span></div>
            <div class="cd-drawer-items">${thirtyItems}</div>
          </section>
        </div>
        <section class="cd-drawer-total" aria-label="Bill summary">
          <span class="cd-bill-summary-label">Bill Summary</span>
          <div class="cd-checkout-breakdown">
            <span>Subtotal</span><strong>ETB 520.00</strong>
            <span>VAT</span><strong>ETB 78.00</strong>
            <span>Service Charge</span><strong>ETB 52.00</strong>
            <span>Discount</span><strong>- ETB 17.50</strong>
          </div>
          <span class="cd-drawer-total-label">Total</span>
          <span class="cd-drawer-total-value"><span>ETB</span><strong>632.50</strong></span>
        </section>
        ${evidence}
      </div>
      <footer class="cd-drawer-footer">
        <div class="cd-drawer-footer-total" aria-label="Checkout total"><span>Total</span><strong>ETB 632.50</strong></div>
        <button class="cd-checkout-primary-action">${action === "Completed" ? "View Receipt" : action === "Bill Requested" ? "Print Bill" : action === "Receipt Pending" ? "Print Receipt" : "Verify Payment"}</button>
        <button class="cd-checkout-secondary-action">${status === "payment-due" ? "Cancel" : "Close"}</button>
      </footer>
    </section>
  `;
}

test("checkout slide-over is fixed, single, scrollable, and mode aware", async ({ page }) => {
  await page.setContent(`
    <style>${styles}html,body{margin:0}.cd-checkout-slide-over{animation:none!important}</style>
    <div class="cd-root">
      <header class="cd-header"></header>
      <aside class="cd-pos-nav"></aside>
      <main class="cd-body"><button id="queue-action" class="cd-row-action">Verify Payment</button></main>
      <aside class="cd-right-panel" aria-label="Service locations">
        <section class="cd-location-switch"><button class="cd-location-tile payment-due">Quick Switch</button></section>
      </aside>
    </div>
  `);
  await page.setViewportSize({ width: 1366, height: 768 });
  const closed = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".cd-root")!.getBoundingClientRect();
    const right = document.querySelector<HTMLElement>(".cd-right-panel")!;
    return {
      drawerCount: document.querySelectorAll(".cd-checkout-slide-over").length,
      rightText: right.textContent?.trim(),
      rightLabel: right.getAttribute("aria-label"),
      rootWidth: root.width,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(closed).toEqual({
    drawerCount: 0,
    rightText: "Quick Switch",
    rightLabel: "Service locations",
    rootWidth: 1366,
    overflow: false,
  });

  await page.locator(".cd-root").evaluate((root, html) => {
    root.insertAdjacentHTML("afterend", html);
  }, drawerFixture("payment-due", "Payment Due"));
  await page.waitForTimeout(50);
  const open = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".cd-root")!.getBoundingClientRect();
    const drawer = document.querySelector<HTMLElement>(".cd-checkout-slide-over")!;
    const body = document.querySelector<HTMLElement>(".cd-drawer-body")!;
    const header = document.querySelector<HTMLElement>(".cd-drawer-header")!.getBoundingClientRect();
    const footer = document.querySelector<HTMLElement>(".cd-drawer-footer")!.getBoundingClientRect();
    const close = document.querySelector<HTMLElement>(".cd-drawer-close")!.getBoundingClientRect();
    const items = document.querySelector<HTMLElement>(".cd-drawer-items")!;
    body.scrollTop = 400;
    return {
      drawerCount: document.querySelectorAll(".cd-checkout-slide-over").length,
      rootWidth: root.width,
      drawerLeft: Math.round(drawer.getBoundingClientRect().left),
      drawerRight: Math.round(drawer.getBoundingClientRect().right),
      closeTarget: close.width >= 44 && close.height >= 44,
      headerVisible: header.top >= 0 && header.height > 0,
      footerVisible: footer.bottom <= window.innerHeight && footer.height > 0,
      onePrimary: document.querySelectorAll(".cd-checkout-primary-action").length,
      oneSecondary: document.querySelectorAll(".cd-checkout-secondary-action").length,
      bodyScrolls: items.scrollHeight > items.clientHeight,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      drawerOverflow: drawer.scrollWidth > drawer.clientWidth,
    };
  });
  expect(open).toEqual({
    drawerCount: 1,
    rootWidth: 1366,
    drawerLeft: 792,
    drawerRight: 1366,
    closeTarget: true,
    headerVisible: true,
    footerVisible: true,
    onePrimary: 1,
    oneSecondary: 1,
    bodyScrolls: true,
    pageOverflow: false,
    drawerOverflow: false,
  });

  for (const [status, label, primary] of [
    ["bill-requested", "Bill Requested", "Print Bill"],
    ["receipt-pending", "Receipt Pending", "Print Receipt"],
    ["completed", "Completed", "View Receipt"],
  ] as const) {
    await page.locator(".cd-checkout-slide-over").evaluate((node, html) => {
      node.outerHTML = html;
    }, drawerFixture(status, label));
    await expect(page.locator(".cd-checkout-status-badge")).toHaveText(label);
    await expect(page.locator(".cd-checkout-primary-action")).toHaveText(primary);
  }
});

test("screenshot preview opens and closes without exposing upload controls", async ({ page }) => {
  await page.setContent(`
    <style>${styles}html,body{margin:0}[hidden]{display:none!important}</style>
    ${drawerFixture("payment-due", "Payment Due")}
    <div id="preview" class="cd-screenshot-preview" role="dialog" aria-modal="true" aria-label="Payment screenshot preview" hidden>
      <header><strong>Payment Screenshot</strong><div><button>Zoom</button><button id="close-preview" aria-label="Close screenshot preview">Close</button></div></header>
      <div class="cd-screenshot-stage fit"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='%2315803d'/%3E%3C/svg%3E" alt="Payment screenshot"></div>
    </div>
    <script>
      const trigger = document.getElementById("view-shot");
      const preview = document.getElementById("preview");
      const close = document.getElementById("close-preview");
      trigger.addEventListener("click", () => { preview.hidden = false; close.focus(); });
      close.addEventListener("click", () => { preview.hidden = true; trigger.focus(); });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !preview.hidden) {
          preview.hidden = true;
          trigger.focus();
        }
      });
    </script>
  `);
  await page.locator("#view-shot").click();
  await expect(page.locator("#preview")).toBeVisible();
  await expect(page.locator("text=Upload Screenshot")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#preview")).toBeHidden();
  await expect(page.locator("#view-shot")).toBeFocused();
});
