import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"),
  "utf8",
);

test("service-location quick switch remains readable and internally scrollable", async ({ page }) => {
  const cards = Array.from({ length: 126 }, (_, index) => {
    const number = index + 1;
    const status = number === 1
      ? "payment-due"
      : number === 2
        ? "bill-requested"
        : number === 3
          ? "receipt-pending"
          : number % 3 === 0
            ? "occupied"
            : "available";
    const label = status === "payment-due"
      ? "Payment due"
      : status === "bill-requested"
        ? "Bill requested"
        : status === "receipt-pending"
          ? "Receipt pending"
          : status === "occupied"
            ? "Occupied"
            : "Available";
    return `
      <button id="cashier-location-${number}" type="button" role="option"
        class="cd-location-tile ${status}${number === 2 ? " selected" : ""}"
        aria-selected="${number === 2}" aria-label="Table ${number}, ${label}">
        <strong>Table ${number}</strong>
        <span class="cd-location-status"><i></i><span>${status === "available" ? "Free" : status === "occupied" ? "Busy" : status === "payment-due" ? "Due" : status === "bill-requested" ? "Bill" : "Receipt"}</span></span>
        ${number === 1 ? "<small>ETB 1,250</small>" : ""}
        ${number === 2 ? "<span class=\"cd-location-selected-icon\">✓</span>" : ""}
      </button>`;
  }).join("");

  await page.setContent(`
    <style>${styles}html,body{margin:0}.cd-root{height:100vh!important;min-height:0!important}.cd-right-panel{height:calc(100vh - 70px)!important}.cd-location-switch{height:100%!important;grid-template-rows:minmax(0,1fr)!important}.cd-location-grid{height:100%!important;max-height:100%!important;align-self:stretch!important;overflow-y:auto!important}</style>
    <div class="cd-root">
      <header class="cd-header"></header>
      <aside class="cd-pos-nav"></aside>
      <main class="cd-body"></main>
      <aside class="cd-right-panel" aria-label="Service locations">
        <section class="cd-location-switch">
          <div class="cd-location-grid" role="listbox">${cards}</div>
        </section>
      </aside>
    </div>
    <script>
      document.querySelectorAll('.cd-location-tile').forEach((tile) => {
        tile.addEventListener('click', () => {
          document.querySelectorAll('.cd-location-tile').forEach((candidate) => {
            candidate.classList.remove('selected');
            candidate.setAttribute('aria-selected', 'false');
          });
          tile.classList.add('selected');
          tile.setAttribute('aria-selected', 'true');
        });
      });
    </script>
  `);

  for (const viewport of [
    { width: 1366, height: 768, columns: 6 },
    { width: 1440, height: 900, columns: 6 },
    { width: 1920, height: 1080, columns: 6 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const select = (selector: string) => document.querySelector<HTMLElement>(selector)!;
      const grid = select(".cd-location-grid");
      const panel = select(".cd-location-switch").getBoundingClientRect();
      const right = select(".cd-right-panel").getBoundingClientRect();
      const cards = [...document.querySelectorAll<HTMLElement>(".cd-location-tile")];
      const first = cards[0].getBoundingClientRect();
      const selected = select(".cd-location-tile.selected");
      const selectedStyle = getComputedStyle(selected);
      grid.scrollTop = grid.scrollHeight;
      return {
        horizontalOverflow: grid.scrollWidth > grid.clientWidth,
        verticallyScrollable: grid.scrollHeight > grid.clientHeight,
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        touchHeight: first.height,
        cardsInsidePanel: cards.every((card) => card.getBoundingClientRect().right <= panel.right),
        noCheckoutReservation: document.querySelectorAll(".cd-drawer").length === 0,
        switchFillsRightColumn: Math.abs(panel.height - right.height) <= 2,
        selectedOutline: selectedStyle.outlineWidth,
        gridStartsAtPanelTop: Math.abs(grid.getBoundingClientRect().top - panel.top) <= 12,
      };
    });
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.verticallyScrollable).toBe(true);
    expect(geometry.columns).toBe(viewport.columns);
    expect(geometry.touchHeight).toBeGreaterThanOrEqual(56);
    expect(geometry.cardsInsidePanel).toBe(true);
    expect(geometry.noCheckoutReservation).toBe(true);
    expect(geometry.switchFillsRightColumn).toBe(true);
    expect(geometry.selectedOutline).toBe("2px");
    expect(geometry.gridStartsAtPanelTop).toBe(true);
  }

  const thirdCard = page.locator("#cashier-location-3");
  await thirdCard.focus();
  await page.keyboard.press("Enter");
  await expect(thirdCard).toHaveAttribute("aria-selected", "true");
  await expect(thirdCard).toHaveClass(/selected/);
});
