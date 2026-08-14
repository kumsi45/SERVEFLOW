import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const layout = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerLayout.css"), "utf8");
const dashboard = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerDashboard.css"), "utf8");

test("manager shell uses one document scroll at mobile and tablet widths", async ({ page }) => {
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${layout}\n${dashboard}\nbody{margin:0}.fixture{height:430px;border:1px solid #ddd}</style></head><body>
    <main class="ml-shell"><section class="ml-workspace"><header class="ml-header">Manager</header><div class="ml-content"><main class="md-overview">
      <section class="fixture">Metrics</section><section class="fixture">Operations</section><aside class="md-side fixture">Health</aside><section class="md-recent fixture">Recent Activity</section>
    </main></div></section></main></body></html>`);

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 10_000));
    const result = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(".ml-content")!;
      const recent = document.querySelector<HTMLElement>(".md-recent")!;
      return {
        pageScroll: scrollY,
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: innerHeight,
        contentOverflow: getComputedStyle(content).overflowY,
        recentPosition: getComputedStyle(recent).position,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        recentBottom: recent.getBoundingClientRect().bottom,
      };
    });
    expect(result.pageHeight).toBeGreaterThan(result.viewportHeight);
    expect(result.pageScroll).toBeGreaterThan(0);
    expect(result.contentOverflow).toBe("visible");
    expect(result.recentPosition).toBe("static");
    expect(result.horizontalOverflow).toBe(false);
    expect(result.recentBottom).toBeLessThanOrEqual(result.viewportHeight);
  }
});

test("1024px desktop shell remains contained and bottom content stays reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${layout}\n${dashboard}\nbody{margin:0}.fixture{height:430px;border:1px solid #ddd}</style></head><body>
    <main class="ml-shell"><section class="ml-workspace"><header class="ml-header">Manager</header><div class="ml-content"><main class="md-overview"><section class="fixture">Metrics</section><section class="fixture">Operations</section><section class="md-recent fixture">Recent Activity</section></main></div></section></main></body></html>`);
  const result = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".ml-content")!;
    content.scrollTop = content.scrollHeight;
    const recent = document.querySelector<HTMLElement>(".md-recent")!;
    return { horizontalOverflow: document.documentElement.scrollWidth > innerWidth, contentOverflow: getComputedStyle(content).overflowY, recentBottom: recent.getBoundingClientRect().bottom, viewportHeight: innerHeight };
  });
  expect(result.horizontalOverflow).toBe(false);
  expect(result.contentOverflow).toBe("auto");
  expect(result.recentBottom).toBeLessThanOrEqual(result.viewportHeight);
});
