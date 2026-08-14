import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/manager/styles/managerCopilot.css"),
  "utf8",
);

test("ServeFlow Copilot is a contained drawer and mobile full-screen sheet", async ({
  page,
}) => {
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}*{box-sizing:border-box}body{margin:0;font-family:Arial}.workspace{height:1200px;background:#f4f6f9}</style></head><body><main class="workspace">Manager workspace</main><button class="mcp-launcher"><svg></svg><span>Copilot</span></button><div class="mcp-layer"><aside class="mcp-panel"><header class="mcp-header"><div class="mcp-title"><span class="mcp-mark"></span><div><strong>ServeFlow Copilot</strong><small>Live · Example Business</small></div></div><button>×</button></header><div class="mcp-context"><span>Viewing: Inventory</span><small>Supported business data synchronized</small></div><div class="mcp-conversation">${Array.from({ length: 18 }, (_, index) => `<article class="mcp-message copilot"><span>Copilot</span><section><h3>Evidence</h3><p>Operational evidence ${index + 1} remains readable and contained.</p></section></article>`).join("")}</div><div class="mcp-prompts"><button>What needs attention?</button><button>Inventory risks</button></div><form class="mcp-composer"><label><textarea placeholder="Ask about current operations"></textarea></label><button>Send</button></form><footer class="mcp-disclaimer">Review changes before acting.</footer></aside></div></body></html>`,
  );

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 430, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".mcp-panel")!;
      const conversation =
        document.querySelector<HTMLElement>(".mcp-conversation")!;
      const composer = document.querySelector<HTMLElement>(".mcp-composer")!;
      return {
        panelWidth: panel.getBoundingClientRect().width,
        panelRight: panel.getBoundingClientRect().right,
        viewportWidth: innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        conversationScrollable:
          conversation.scrollHeight > conversation.clientHeight,
        composerBottom: composer.getBoundingClientRect().bottom,
        viewportHeight: innerHeight,
      };
    });
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.panelRight).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.conversationScrollable).toBe(true);
    expect(geometry.composerBottom).toBeLessThanOrEqual(
      geometry.viewportHeight,
    );
    if (viewport.width <= 767)
      expect(Math.abs(geometry.panelWidth - viewport.width)).toBeLessThan(2);
    else expect(geometry.panelWidth).toBeLessThan(viewport.width);
  }
});

test("mobile Copilot composer remains usable while typing and submitting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}*{box-sizing:border-box}body{margin:0;font-family:Arial}</style></head><body><div class="mcp-layer"><aside class="mcp-panel"><header class="mcp-header"><div class="mcp-title"><span class="mcp-mark"></span><div><strong>ServeFlow Copilot</strong><small>Live - Example Business</small></div></div><button>×</button></header><div class="mcp-context"><span>Viewing: Live Operations</span></div><div class="mcp-conversation"><div class="mcp-empty"><h2>Good morning, Manager.</h2><p>What would you like to know?</p></div></div><div class="mcp-prompts"><button type="button">What needs attention?</button></div><form class="mcp-composer"><label><textarea placeholder="Ask about current operations"></textarea></label><button type="submit">Send</button></form><footer class="mcp-disclaimer">Review changes before acting.</footer></aside></div><script>document.querySelector('.mcp-composer').addEventListener('submit',event=>{event.preventDefault();const input=document.querySelector('textarea');const conversation=document.querySelector('.mcp-conversation');conversation.querySelector('.mcp-empty')?.remove();conversation.insertAdjacentHTML('beforeend','<article class="mcp-message manager"><span>You</span><p>'+input.value+'</p></article><article class="mcp-message copilot"><span>Copilot</span><section><h3>Answer</h3><p>Current evidence was reviewed.</p></section></article>');input.value='';conversation.scrollTop=conversation.scrollHeight;});</script></body></html>`,
  );
  const input = page.locator(".mcp-composer textarea");
  await input.fill("What needs attention right now?");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 390, height: 520 });
  const beforeSubmit = await page
    .locator(".mcp-composer")
    .evaluate((element) => ({
      bottom: element.getBoundingClientRect().bottom,
      viewport: innerHeight,
    }));
  expect(beforeSubmit.bottom).toBeLessThanOrEqual(beforeSubmit.viewport);
  await page.locator(".mcp-composer button[type=submit]").click();
  await expect(page.locator(".mcp-message.manager")).toContainText(
    "What needs attention right now?",
  );
  await expect(page.locator(".mcp-message.copilot")).toContainText(
    "Current evidence was reviewed.",
  );
  await expect(input).toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
