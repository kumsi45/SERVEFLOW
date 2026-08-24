import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerCopilot.css"), "utf8");
const chromeStyles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerWorkspaceChrome.css"), "utf8");

function header(context: string) {
  return `<header class="mcp-header"><div class="mcp-title"><span class="mcp-mark"></span><div><strong>ServeFlow Copilot</strong><small><i></i>Live operations <b>${context}</b></small></div></div><button aria-label="Close Copilot">Close</button></header>`;
}

test("Copilot is a contained desktop/tablet drawer and full-screen mobile chat", async ({ page }) => {
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}*{box-sizing:border-box}body{margin:0;font-family:Arial}.workspace{height:1200px;background:#f4f6f9}</style></head><body><main class="workspace">Manager workspace</main><button class="mcp-launcher"><svg></svg><span>Copilot</span></button><div class="mcp-layer"><aside class="mcp-panel">${header("Inventory")}<div class="mcp-conversation">${Array.from({ length: 18 }, (_, index) => `<article class="mcp-message copilot"><span>Copilot</span><section><h3>Evidence</h3><p>Operational evidence ${index + 1} remains readable and contained.</p></section></article>`).join("")}</div><div class="mcp-prompts"><button>What needs attention?</button><button>Items affected by stock</button><button>What may run out?</button></div><form class="mcp-composer"><label><textarea placeholder="Ask about current operations"></textarea></label><button>Send</button></form><footer class="mcp-disclaimer">Review changes before acting.</footer></aside></div></body></html>`,
  );

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 820, height: 1180 },
    { width: 768, height: 1024 },
    { width: 430, height: 932 },
    { width: 412, height: 915 },
    { width: 390, height: 844 },
    { width: 375, height: 812 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".mcp-panel")!;
      const conversation = document.querySelector<HTMLElement>(".mcp-conversation")!;
      const composer = document.querySelector<HTMLElement>(".mcp-composer")!;
      const prompts = document.querySelector<HTMLElement>(".mcp-prompts")!;
      return {
        panelWidth: panel.getBoundingClientRect().width,
        panelRight: panel.getBoundingClientRect().right,
        viewportWidth: innerWidth,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        conversationScrollable: conversation.scrollHeight > conversation.clientHeight,
        composerBottom: composer.getBoundingClientRect().bottom,
        viewportHeight: innerHeight,
        promptsContained: prompts.getBoundingClientRect().right <= innerWidth,
      };
    });
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.promptsContained).toBe(true);
    expect(geometry.panelRight).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.conversationScrollable).toBe(true);
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    if (viewport.width <= 767) expect(Math.abs(geometry.panelWidth - viewport.width)).toBeLessThan(2);
    else expect(geometry.panelWidth).toBeLessThan(viewport.width);
  }
});

test("mobile greeting collapses, composer survives reduced height, and bottom nav is hidden", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    `<!doctype html><html class="manager-copilot-open"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}*{box-sizing:border-box}body{margin:0;font-family:Arial}.ml-bottom-nav{position:fixed;bottom:0;height:70px}</style></head><body><nav class="ml-bottom-nav">Manager navigation</nav><div class="mcp-layer"><aside class="mcp-panel">${header("Live Operations")}<div class="mcp-conversation is-empty"><div class="mcp-empty"><h2>Good morning, Manager.</h2><p>How can I help?</p></div><div class="mcp-prompts"><button type="button">What needs attention?</button></div></div><form class="mcp-composer"><label><textarea placeholder="Ask about current operations"></textarea></label><button type="submit">Send</button></form><footer class="mcp-disclaimer">Review changes before acting.</footer></aside></div><script>document.querySelector('.mcp-composer').addEventListener('submit',event=>{event.preventDefault();const input=document.querySelector('textarea');const conversation=document.querySelector('.mcp-conversation');conversation.classList.remove('is-empty');conversation.querySelector('.mcp-empty')?.remove();conversation.querySelector('.mcp-prompts')?.remove();conversation.insertAdjacentHTML('beforeend','<article class="mcp-message manager"><span>You</span><p>'+input.value+'</p></article><article class="mcp-message copilot"><span>Copilot</span><section><h3>Answer</h3><p>Current evidence was reviewed.</p></section></article>');input.value='';conversation.scrollTop=conversation.scrollHeight;});</script></body></html>`,
  );
  const input = page.locator(".mcp-composer textarea");
  await input.fill("What needs attention right now?");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 390, height: 520 });
  const beforeSubmit = await page.locator(".mcp-composer").evaluate((element) => ({ bottom: element.getBoundingClientRect().bottom, viewport: innerHeight }));
  expect(beforeSubmit.bottom).toBeLessThanOrEqual(beforeSubmit.viewport);
  await expect(page.locator(".ml-bottom-nav")).toBeHidden();
  await page.locator(".mcp-composer button[type=submit]").click();
  await expect(page.locator(".mcp-empty")).toHaveCount(0);
  await expect(page.locator(".mcp-message.manager")).toContainText("What needs attention right now?");
  await expect(page.locator(".mcp-message.copilot")).toContainText("Current evidence was reviewed.");
  await expect(input).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("mobile live-update banner stays below the Manager header", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${chromeStyles}*{box-sizing:border-box}body{margin:0}.manager-header{height:68px;background:#fff}</style></head><body><header class="manager-header">Manager</header><div class="mwc-live-banner actionable"><button><span aria-hidden="true">!</span><span>An inventory request changed</span><span aria-hidden="true">&gt;</span></button><button class="mwc-banner-dismiss" aria-label="Dismiss">x</button></div></body></html>`,
  );
  const geometry = await page.locator(".mwc-live-banner").evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    right: element.getBoundingClientRect().right,
    width: element.getBoundingClientRect().width,
    viewportWidth: innerWidth,
  }));
  expect(geometry.top).toBeGreaterThanOrEqual(68);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.width).toBeLessThan(geometry.viewportWidth);
  await expect(page.locator(".mwc-live-banner > button").first()).toHaveCSS("min-height", "44px");
});
