import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerCopilot.css"), "utf8");

test("ServeFlow Copilot is a contained drawer and mobile full-screen sheet", async ({ page }) => {
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}*{box-sizing:border-box}body{margin:0;font-family:Arial}.workspace{height:1200px;background:#f4f6f9}</style></head><body><main class="workspace">Manager workspace</main><button class="mcp-launcher"><svg></svg><span>Copilot</span></button><div class="mcp-layer"><aside class="mcp-panel"><header class="mcp-header"><div class="mcp-title"><span class="mcp-mark"></span><div><strong>ServeFlow Copilot</strong><small>Live · Example Business</small></div></div><button>×</button></header><div class="mcp-context"><span>Viewing: Inventory</span><small>Supported business data synchronized</small></div><div class="mcp-conversation">${Array.from({ length: 18 }, (_, index) => `<article class="mcp-message copilot"><span>Copilot</span><section><h3>Evidence</h3><p>Operational evidence ${index + 1} remains readable and contained.</p></section></article>`).join("")}</div><div class="mcp-prompts"><button>What needs attention?</button><button>Inventory risks</button></div><form class="mcp-composer"><label><textarea placeholder="Ask about current operations"></textarea></label><button>Send</button></form><footer class="mcp-disclaimer">Review changes before acting.</footer></aside></div></body></html>`);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 430, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".mcp-panel")!;
      const conversation = document.querySelector<HTMLElement>(".mcp-conversation")!;
      const composer = document.querySelector<HTMLElement>(".mcp-composer")!;
      return { panelWidth: panel.getBoundingClientRect().width, panelRight: panel.getBoundingClientRect().right, viewportWidth: innerWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, conversationScrollable: conversation.scrollHeight > conversation.clientHeight, composerBottom: composer.getBoundingClientRect().bottom, viewportHeight: innerHeight };
    });
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.panelRight).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.conversationScrollable).toBe(true);
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    if (viewport.width <= 767) expect(Math.abs(geometry.panelWidth - viewport.width)).toBeLessThan(2);
    else expect(geometry.panelWidth).toBeLessThan(viewport.width);
  }
});
