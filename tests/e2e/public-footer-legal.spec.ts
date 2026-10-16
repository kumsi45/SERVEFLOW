import { expect, test } from "@playwright/test";

const legalPages = [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
  ["/cookies", "Cookie Policy"],
  ["/acceptable-use", "Acceptable Use Policy"],
] as const;
const publicPaths = ["/", "/about", "/pricing", "/contact", ...legalPages.map(([path]) => path)];
const links = [
  ["Features", "/#platform"], ["Industries", "/#industries"],
  ["Pricing", "/pricing"], ["Request a trial", "/contact"],
  ["About ServeFlow", "/about"], ["Contact", "/contact"],
  ["Contact support", "https://wa.me/251990069892?text=Hello%20KumsiTech%2C%20I%20have%20a%20question%20about%20ServeFlow."],
  ["Privacy Policy", "/privacy"], ["Terms of Service", "/terms"],
  ["Cookie Policy", "/cookies"], ["Acceptable Use", "/acceptable-use"],
] as const;
const footer = (page: import("@playwright/test").Page) => page.getByRole("contentinfo", { name: "ServeFlow site footer" });

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL || !["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname)) {
    throw new Error("Public-site checks require a local development server.");
  }
  // Inspect public pages only. Prevent incidental requests to hosted services.
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(baseURL).origin ? route.continue() : route.abort("blockedbyclient");
  });
});

for (const path of publicPaths) {
  test(`shared footer has real destinations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(footer(page)).toHaveCount(1);
    await expect(footer(page).getByText(/Better operations\.\s*Better hospitality\./)).toBeVisible();
    await expect(footer(page).getByRole("navigation")).toHaveCount(3);
    await expect(footer(page).getByRole("link")).toHaveCount(links.length);
    for (const [label, href] of links) {
      await expect(footer(page).getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
    }
    const hrefs = await footer(page).getByRole("link").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    expect(hrefs.every(href => Boolean(href) && href !== "#" && !href?.startsWith("javascript:"))).toBe(true);
    await expect(footer(page).locator('a[href^="mailto:"]')).toHaveCount(0);
  });
}

for (const [path, title] of legalPages) {
  test(`legal route loads directly and refreshes: ${path}`, async ({ page }) => {
    await page.goto(`${path}/`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page).toHaveTitle(`${title} | ServeFlow`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Draft/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", `${title} | ServeFlow`);
    await expect(page.getByText("Draft for review", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: `${title} contents` })).toBeVisible();
    await expect(page.locator(".lp-legal-sections section")).toHaveCount(path === "/terms" ? 6 : 5);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(footer(page)).toBeVisible();
    const contents = page.getByRole("navigation", { name: `${title} contents` });
    await contents.getByRole("link").first().click();
    const section = page.locator(".lp-legal-sections section").first();
    await expect(section).toBeInViewport();
    const bounds = await section.boundingBox();
    const header = await page.locator(".lp-header").boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(header!.height - 1);
  });
}

test("footer internal links resolve to routes and anchors", async ({ page }) => {
  // This test intentionally performs two full-page navigations per internal link.
  test.setTimeout(90_000);
  for (const [label, href] of links.filter(([, href]) => href.startsWith("/"))) {
    await page.goto("/privacy");
    await footer(page).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Menu link not found.", { exact: true })).toHaveCount(0);
    const hash = href.split("#")[1];
    if (hash) await expect(page.locator(`#${hash}`)).toBeInViewport();
  }
});

for (const width of [320, 375, 390, 430, 561, 768, 1024, 1440]) {
  test(`public footer and legal content reflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of publicPaths) {
      await page.goto(path);
      await expect(footer(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
      const targets = await footer(page).getByRole("link").evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, left: rect.left, right: rect.right };
      }));
      for (const target of targets) {
        expect(target.height, path).toBeGreaterThanOrEqual(44);
        expect(target.left, path).toBeGreaterThanOrEqual(0);
        expect(target.right, path).toBeLessThanOrEqual(width);
      }
    }
  });
}

test("footer keyboard order, focus and legal skip link work", async ({ page }) => {
  await page.goto("/privacy");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await footer(page).getByRole("link", { name: links[0][0], exact: true }).focus();
  for (const [index, [label]] of links.entries()) {
    const link = footer(page).getByRole("link", { name: label, exact: true });
    if (index) await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    await expect(link).toHaveCSS("outline-width", "3px");
  }
});

test("public pages reflow at the CSS width equivalent to 200 percent browser zoom", async ({ page }) => {
  // A 1280px browser viewport at 200% zoom exposes 640 CSS pixels.
  // CSS zoom alone does not update media-query breakpoints; use the reflow width.
  await page.setViewportSize({ width: 640, height: 450 });
  for (const path of ["/", ...legalPages.map(([path]) => path)]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    await expect(footer(page).getByRole("link", { name: "Contact support", exact: true })).toBeVisible();
  }
});

test("observe fresh local public-page storage and network without submitting data", async ({ page, context, baseURL }, testInfo) => {
  const requestOrigins = new Set<string>();
  const externalAttempts = new Set<string>();
  const nonReadRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    requestOrigins.add(url.origin);
    if (url.origin !== new URL(baseURL!).origin) externalAttempts.add(url.origin);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) nonReadRequests.push(request.method());
  });
  await page.goto("/");
  await expect(footer(page)).toBeVisible();
  await page.goto("/cookies");
  await expect(page.getByRole("heading", { level: 1, name: "Cookie Policy" })).toBeVisible();
  const storage = await page.evaluate(() => ({
    localKeys: Object.keys(localStorage),
    sessionKeys: Object.keys(sessionStorage).map(key => key.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<tab-id>")),
  }));
  const observation = { storage, cookieNames: (await context.cookies()).map(cookie => cookie.name), requestOrigins: [...requestOrigins], blockedExternalOrigins: [...externalAttempts] };
  await testInfo.attach("local-public-storage-network", { body: JSON.stringify(observation, null, 2), contentType: "application/json" });
  console.log("PUBLIC_OBSERVATION", JSON.stringify(observation));
  expect(nonReadRequests).toEqual([]);
});
