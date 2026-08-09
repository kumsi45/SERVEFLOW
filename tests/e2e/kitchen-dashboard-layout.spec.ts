import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/kitchen/styles/kitchenDashboard.css"),
  "utf8",
);

const cards = ["accepted", "preparing", "ready", "accepted"]
  .map(
    (state, index) => `
      <article class="kd-order-card status-${state}">
        <header class="kd-card-header">
          <div class="kd-card-title"><h2>Table ${index + 1}</h2><span class="kd-state-badge ${state}">${state}</span></div>
          <span class="kd-card-timer kd-timer-normal">${index + 4}m</span>
        </header>
        <div class="kd-card-context"><span class="kd-service-badge dine-in">Dine-in</span><span class="kd-card-source">Waiter Abdi</span><time>10:02</time></div>
        <div class="kd-card-items">
          <div class="kd-card-item">
            <div class="kd-card-item-main"><strong>2x</strong><span>Mango Juice</span></div>
            ${index === 0 ? '<div class="kd-card-instruction"><strong>Instruction:</strong> No sugar</div>' : ""}
          </div>
          <div class="kd-card-item"><div class="kd-card-item-main"><strong>1x</strong><span>Macchiato</span></div></div>
        </div>
        <footer class="kd-card-action"><button class="kd-context-action ${state}">Context action</button></footer>
      </article>`,
  )
  .join("");

test("kitchen cards stay dense, readable, and responsive", async ({ page }) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${styles}</style>
    <div class="kd-root">
      <header class="kd-header"><div class="kd-header-logo-area"><div class="kd-logo-mark">S</div><div><div class="kd-restaurant-name">ServeFlow</div><div class="kd-kitchen-label">Kitchen - Beverages</div></div></div><div class="kd-header-search"><input aria-label="Search orders"></div><div class="kd-active-badge"><span></span>4 Active</div></header>
      <div class="kd-filter-bar"><div class="kd-filter-group"><span class="kd-filter-label">Service</span><button class="kd-filter-btn active">All</button><button class="kd-filter-btn">Dine-in</button><button class="kd-filter-btn">Takeaway</button><button class="kd-filter-btn">Delivery</button></div><div class="kd-filter-group kd-state-filters"><span class="kd-filter-label">State</span><button class="kd-filter-btn active">All</button><button class="kd-filter-btn">New</button><button class="kd-filter-btn">Preparing</button><button class="kd-filter-btn">Ready</button></div><div class="kd-sort-control"><button class="kd-sort-trigger" aria-haspopup="menu" aria-expanded="false">Sort: Oldest First <span class="kd-sort-chevron"></span></button></div></div>
      <main class="kd-order-workspace"><div class="kd-order-grid">${cards}</div></main>
    </div>
  `);

  const expectedColumns = [
    { width: 1920, height: 1080, columns: 4 },
    { width: 1440, height: 900, columns: 4 },
    { width: 1366, height: 768, columns: 3 },
    { width: 1100, height: 800, columns: 3 },
    { width: 800, height: 900, columns: 2 },
    { width: 390, height: 844, columns: 1 },
  ];

  for (const viewport of expectedColumns) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(".kd-order-card")];
      const firstTop = cards[0].getBoundingClientRect().top;
      const firstRowCount = cards.filter(
        (card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2,
      ).length;
      const firstCard = cards[0].getBoundingClientRect();
      const action = cards[0].querySelector<HTMLElement>(".kd-context-action")!.getBoundingClientRect();
      const instruction = cards[0].querySelector<HTMLElement>(".kd-card-instruction")!;
      return {
        firstRowCount,
        bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cardWidth: firstCard.width,
        actionWidth: action.width,
        instructionColor: getComputedStyle(instruction).color,
        instructionBackground: getComputedStyle(instruction).backgroundColor,
      };
    });

    expect(geometry.firstRowCount).toBe(viewport.columns);
    expect(geometry.bodyOverflow).toBe(false);
    expect(geometry.cardWidth).toBeGreaterThan(280);
    expect(geometry.actionWidth).toBeGreaterThan(geometry.cardWidth - 30);
    expect(geometry.instructionColor).not.toBe(geometry.instructionBackground);
  }
});
