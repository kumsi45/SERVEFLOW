import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"),
  "utf8",
);

const headings = ["Table", "Requester", "Item(s)", "Reason", "Payment", "Kitchen", "Amount", "Waiting", "Authority / Action"];

test("cancellation requests overlay stays centered without moving the cashier workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}html,body{margin:0}</style>
    <div class="cd-root">
      <header class="cd-header"></header>
      <aside class="cd-pos-nav"></aside>
      <main class="cd-body"><section class="cd-main-grid" style="height:500px"></section></main>
      <div class="cd-cancellation-overlay" style="display:none">
        <section class="cd-cancellation-modal">
          <header class="cd-cancellation-modal-header"><div><span>Cashier review queue</span><h2>Cancellation Requests</h2><p>12 pending requests</p></div><button class="cd-cancellation-modal-close">×</button></header>
          <div class="cd-cancellation-scroll"><table class="cd-cancellation-table"><thead><tr>${headings.map((heading) => `<th>${heading}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: 18 }, (_, index) => `<tr><td><strong>T${index + 1}</strong></td><td>Waiter ${index + 1}</td><td><strong>Burger ×2</strong></td><td>Customer changed mind</td><td><span class="cd-cancellation-status payment pending">Payment Due</span></td><td><span class="cd-cancellation-status kitchen safe">Not started</span></td><td><strong>ETB 320</strong></td><td>${index + 1}m</td><td><button class="cd-cancellation-action direct">Cancel Directly</button></td></tr>`).join("")}</tbody></table></div>
        </section>
      </div>
    </div>
  `);

  const before = await page.locator(".cd-main-grid").boundingBox();
  await page.locator(".cd-cancellation-overlay").evaluate((overlay) => { overlay.style.display = "grid"; });
  const after = await page.locator(".cd-main-grid").boundingBox();
  const desktop = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>(".cd-cancellation-overlay")!;
    const modal = document.querySelector<HTMLElement>(".cd-cancellation-modal")!;
    const scroll = document.querySelector<HTMLElement>(".cd-cancellation-scroll")!;
    const heading = document.querySelector<HTMLElement>(".cd-cancellation-table th")!;
    const modalRect = modal.getBoundingClientRect();
    return {
      overlayPosition: getComputedStyle(overlay).position,
      overlayBackground: getComputedStyle(overlay).backgroundColor,
      modalCenteredX: Math.abs((modalRect.left + modalRect.right) / 2 - innerWidth / 2),
      modalCenteredY: Math.abs((modalRect.top + modalRect.bottom) / 2 - innerHeight / 2),
      internalVerticalScroll: scroll.scrollHeight > scroll.clientHeight,
      internalHorizontalScroll: scroll.scrollWidth > scroll.clientWidth,
      headingPosition: getComputedStyle(heading).position,
      pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(after).toEqual(before);
  expect(desktop.overlayPosition).toBe("fixed");
  expect(desktop.overlayBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(desktop.modalCenteredX).toBeLessThanOrEqual(1);
  expect(desktop.modalCenteredY).toBeLessThanOrEqual(1);
  expect(desktop.internalVerticalScroll).toBe(true);
  expect(desktop.internalHorizontalScroll).toBe(true);
  expect(desktop.headingPosition).toBe("sticky");
  expect(desktop.pageHorizontalOverflow).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>(".cd-cancellation-modal")!.getBoundingClientRect();
    const scroll = document.querySelector<HTMLElement>(".cd-cancellation-scroll")!;
    return {
      left: modal.left,
      top: modal.top,
      width: modal.width,
      height: modal.height,
      radius: getComputedStyle(document.querySelector<HTMLElement>(".cd-cancellation-modal")!).borderRadius,
      internalHorizontalScroll: scroll.scrollWidth > scroll.clientWidth,
      pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(mobile.left).toBe(0);
  expect(mobile.top).toBe(0);
  expect(mobile.width).toBe(390);
  expect(mobile.height).toBe(844);
  expect(mobile.radius).toBe("0px");
  expect(mobile.internalHorizontalScroll).toBe(true);
  expect(mobile.pageHorizontalOverflow).toBe(false);
});
