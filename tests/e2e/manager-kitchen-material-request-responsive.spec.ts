import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const styles = read("src/modules/manager/styles/managerOperationsCenter.css");
const layoutStyles = read("src/modules/manager/styles/managerLayout.css");
const copilotStyles = read("src/modules/manager/styles/managerCopilot.css");

function requestCard(index: number, long = false) {
  const item = long
    ? "Extra Fine Imported Brown Sugar With A Very Long Item Name"
    : `Rice ${index + 1}`;
  return `<article class="moc-request-action ${index % 3 === 0 ? "critical" : index % 2 === 0 ? "attention" : "normal"}"><header><div><span>Ingredient / Food Material</span><h3>${item}</h3></div><span class="moc-status amber">Pending Review</span></header><div class="moc-request-mobile-summary"><p><strong>5 kg</strong><i>·</i><span>Main Kitchen Preparation Station</span></p><p><span>KUMSI</span><i>·</i><strong class="moc-request-wait">Waiting ${index + 2}h 14m</strong></p></div><dl><div><dt>Quantity</dt><dd>5 kg</dd></div><div><dt>Station</dt><dd>Main Kitchen Preparation Station</dd></div><div><dt>Requested by</dt><dd>KUMSI</dd></div><div class="is-wide"><dt>Reason</dt><dd>Low stock for service preparation.</dd></div><div><dt>Requested</dt><dd>23 Aug 2026, 18:33</dd></div><div><dt>Waiting</dt><dd>${index + 2}h 14m</dd></div></dl><footer><button>Review</button><button class="secondary">Inventory <span>↗</span></button></footer></article>`;
}

function markup(count: number, long = false) {
  return `<main class="ml-shell"><section class="ml-workspace"><div class="ml-content"><main class="moc-page"><section class="moc-panel moc-actions"><div class="moc-section-head"><div><h2>Manager Actions <b>${count}</b></h2></div><div class="moc-filter-row"><button class="is-active">All <span>${count}</span></button><button>Urgent <span>${Math.ceil(count / 3)}</span></button><button>Approvals <span>${count}</span></button><button>Service <span class="is-zero">0</span></button></div></div><div class="moc-action-list">${Array.from({ length: count }, (_, index) => requestCard(index, long && index === 0)).join("")}</div></section></main></div><nav class="ml-bottom-nav"><a><span></span>Overview</a><a><span></span>Operations</a><a><span></span>Kitchen</a><a><span></span>More</a></nav><button class="mcp-launcher"><svg></svg><span>Copilot</span></button></section></main>`;
}

test("Manager Action requests use responsive scan density without overflow", async ({ page }) => {
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1366, height: 900 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.setContent(
      `<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;background:#f6f8fb}${layoutStyles}${copilotStyles}${styles}</style>${markup(20, true)}`,
    );
    const geometry = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(".moc-request-action")];
      const first = cards[0].getBoundingClientRect();
      const firstHeader = cards[0].querySelector("header")!.getBoundingClientRect();
      const status = cards[0].querySelector<HTMLElement>(".moc-status")!.getBoundingClientRect();
      return {
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        firstHeight: first.height,
        statusInside: status.right <= first.right && status.top >= firstHeader.top,
        summaryDisplay: getComputedStyle(cards[0].querySelector<HTMLElement>(".moc-request-mobile-summary")!).display,
        detailsDisplay: getComputedStyle(cards[0].querySelector<HTMLElement>("dl")!).display,
      };
    });
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.statusInside).toBe(true);
    if (viewport.width <= 767) {
      // Exceptional names may wrap beyond the ordinary-card target without clipping.
      expect(geometry.firstHeight).toBeLessThanOrEqual(180);
      expect(geometry.summaryDisplay).not.toBe("none");
      expect(geometry.detailsDisplay).toBe("none");
      await expect(page.getByText("Ingredient / Food Material").first()).toBeHidden();
      await expect(page.getByText("Low stock for service preparation.").first()).toBeHidden();
      await expect(page.locator(".moc-actions .moc-filter-row .is-zero")).toBeHidden();
    } else {
      expect(geometry.summaryDisplay).toBe("none");
      expect(geometry.detailsDisplay).not.toBe("none");
      await expect(page.getByText("Low stock for service preparation.").first()).toBeVisible();
    }
  }
});

test("1, 5, 10, and 20 requests remain one shared queue without nested card scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const count of [1, 5, 10, 20]) {
    await page.setContent(
      `<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;background:#f6f8fb}${layoutStyles}${copilotStyles}${styles}</style>${markup(count)}`,
    );
    await expect(page.locator(".moc-request-action")).toHaveCount(count);
    const density = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(".moc-request-action")];
      return {
        averageHeight: cards.reduce((sum, card) => sum + card.getBoundingClientRect().height, 0) / cards.length,
        nestedScroll: cards.some((card) => card.scrollHeight > card.clientHeight),
        visibleCards: cards.filter((card) => card.getBoundingClientRect().top < innerHeight).length,
      };
    });
    expect(density.averageHeight).toBeLessThanOrEqual(150);
    expect(density.nestedScroll).toBe(false);
    expect(density.visibleCards).toBeGreaterThanOrEqual(Math.min(count, 4));
    if (count === 20) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const collision = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>(".ml-bottom-nav")!.getBoundingClientRect();
        const launcher = document.querySelector<HTMLElement>(".mcp-launcher")!.getBoundingClientRect();
        const lastFooter = [...document.querySelectorAll<HTMLElement>(".moc-request-action footer")].at(-1)!;
        const lastButtons = [...lastFooter.querySelectorAll<HTMLElement>("button")].map((button) => button.getBoundingClientRect());
        const intersects = (a: DOMRect, b: DOMRect) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          launcherAndNav: intersects(launcher, nav),
          launcherAndLastActions: lastButtons.some((button) => intersects(launcher, button)),
          lastActionsAboveNav: lastButtons.every((button) => button.bottom <= nav.top),
        };
      });
      expect(collision.launcherAndNav).toBe(false);
      expect(collision.launcherAndLastActions).toBe(false);
      expect(collision.lastActionsAboveNav).toBe(true);
    }
  }
});
