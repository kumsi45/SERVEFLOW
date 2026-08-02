import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"),
  "utf8",
);

test("checkout workspace remains contained at required desktop viewports", async ({ page }) => {
  await page.setContent(`
    <style>${styles}</style>
    <div class="cd-root">
      <header class="cd-header"></header>
      <aside class="cd-pos-nav"></aside>
      <main class="cd-body"></main>
      <aside class="cd-right-panel">
        <section class="cd-location-switch"></section>
        <section class="cd-drawer" aria-label="Current checkout workspace">
          <header class="cd-drawer-header">
            <div class="cd-checkout-heading">
              <span class="cd-workspace-label">Checkout Workspace</span>
              <h2 class="cd-drawer-title">Table 9</h2>
              <div class="cd-checkout-assignee"><span>Ordered by waiter</span><i>•</i><strong>Abdi</strong></div>
            </div>
            <span class="cd-checkout-status-badge receipt-pending"><i></i>Receipt Pending</span>
            <button class="cd-drawer-close" aria-label="Close checkout workspace">&times;</button>
          </header>
          <div class="cd-drawer-body">
            <section class="cd-checkout-payment-section">
              <div><span class="cd-drawer-section-title">Payment Method</span><small>Customer-selected method</small></div>
              <strong>Telebirr</strong>
            </section>
            <div class="cd-checkout-items-panel">
              <div class="cd-drawer-section-title">Order Items <span>3</span></div>
              <div class="cd-drawer-items">
                ${["Chicken Wrap", "Fresh Juice", "Chocolate Cake"].map((name, index) => `
                  <div class="cd-drawer-item">
                    <div class="cd-drawer-item-quantity">${index + 1}×</div>
                    <div><div class="cd-drawer-item-name">${name}</div><div class="cd-drawer-item-modifiers">Standard preparation</div></div>
                    <div class="cd-drawer-item-price">ETB ${(index + 1) * 180}</div>
                  </div>`).join("")}
              </div>
            </div>
            <section class="cd-drawer-total">
              <span class="cd-bill-summary-label">Bill Summary</span>
              <div class="cd-checkout-breakdown">
                <span>Subtotal</span><strong>ETB 1,080</strong>
                <span>VAT</span><strong>ETB 162</strong>
                <span>Service Charge</span><strong>ETB 108</strong>
                <span>Discount</span><strong>- ETB 50</strong>
              </div>
              <span class="cd-drawer-total-label">Total</span>
              <span class="cd-drawer-total-value">ETB 1,300</span>
            </section>
          </div>
          <footer class="cd-drawer-footer">
            <button class="cd-checkout-primary-action">Print Receipt</button>
            <div class="cd-checkout-secondary-actions"><button>Share Receipt</button><button>Close Invoice</button></div>
          </footer>
        </section>
      </aside>
    </div>
  `);

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const select = (selector: string) => document.querySelector<HTMLElement>(selector)!;
      const drawer = select(".cd-drawer");
      const header = select(".cd-drawer-header").getBoundingClientRect();
      const badge = select(".cd-checkout-status-badge").getBoundingClientRect();
      const close = select(".cd-drawer-close").getBoundingClientRect();
      const body = select(".cd-drawer-body").getBoundingClientRect();
      const footer = select(".cd-drawer-footer").getBoundingClientRect();
      const primary = select(".cd-checkout-primary-action").getBoundingClientRect();
      const total = getComputedStyle(select(".cd-drawer-total-value"));
      return {
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
        drawerOverflow: drawer.scrollWidth > drawer.clientWidth,
        badgeInsideHeader: badge.left >= header.left && badge.right <= header.right,
        closeInsideHeader: close.left >= header.left && close.right <= header.right,
        badgeClearOfClose: badge.right <= close.left,
        bodyClearOfFooter: body.bottom <= footer.top,
        footerInsideDrawer: footer.bottom <= drawer.getBoundingClientRect().bottom,
        onePrimary: document.querySelectorAll(".cd-checkout-primary-action").length === 1,
        twoSecondary: document.querySelectorAll(".cd-checkout-secondary-actions button").length === 2,
        primaryHeight: primary.height,
        totalFontSize: total.fontSize,
        totalAlignedRight: total.textAlign === "right",
      };
    });
    expect(geometry).toEqual({
      pageOverflow: false,
      drawerOverflow: false,
      badgeInsideHeader: true,
      closeInsideHeader: true,
      badgeClearOfClose: true,
      bodyClearOfFooter: true,
      footerInsideDrawer: true,
      onePrimary: true,
      twoSecondary: true,
      primaryHeight: 52,
      totalFontSize: "40px",
      totalAlignedRight: true,
    });
  }
});

