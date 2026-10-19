import { expect, test, type Page } from "@playwright/test";

const sections = ["overview", "applications", "businesses", "users", "contracts", "payments", "notifications", "system-health", "diagnostics", "integrations", "backups", "audit-logs", "administrators", "security"] as const;
const widths = [320, 375, 430, 768, 1024, 1280, 1440] as const;
const productionGuard = process.env.SERVEFLOW_EXPECT_PREVIEW_BLOCKED === "1";

async function isolatePreview(page: Page, baseURL: string | undefined) {
  if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Platform preview checks require localhost.");
  const external: string[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) return route.continue();
    external.push(url.href);
    return route.abort("blockedbyclient");
  });
  return external;
}

test("production build does not expose the synthetic preview route", async ({ page, baseURL }) => {
  test.skip(!productionGuard, "Runs against the production preview server in the build verification step.");
  await isolatePreview(page, baseURL);
  await page.goto("/platform-admin/preview");
  await expect(page.getByText("Menu link not found.")).toBeVisible();
  await expect(page.getByText("Demo data", { exact: true })).toHaveCount(0);
});

for (const width of widths) {
  test(`local synthetic preview has no page overflow at ${width}px`, async ({ page, baseURL }, testInfo) => {
    test.skip(productionGuard, "Development preview only.");
    const external = await isolatePreview(page, baseURL);
    await page.setViewportSize({ width, height: width <= 375 ? 760 : 900 });
    await page.goto("/platform-admin/preview");
    await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
    expect(await page.evaluate(() => ({ document: document.documentElement.scrollWidth <= document.documentElement.clientWidth, body: document.body.scrollWidth <= document.body.clientWidth }))).toEqual({ document: true, body: true });
    expect(external).toEqual([]);
    if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`platform-admin-preview-${width}.png`), fullPage: true });
  });
}

test("all fourteen synthetic sections render without platform requests", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  test.skip(productionGuard, "Development preview only.");
  const external = await isolatePreview(page, baseURL);
  for (const section of sections) {
    await page.goto(`/platform-admin/preview/${section}`);
    await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
    await expect(page.locator('nav[aria-label="Platform administration"] a[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator("#pa-content h1")).toBeVisible();
  }
  expect(external).toEqual([]);
});

test("preview states, filters and mutation dialogs remain local", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  const external = await isolatePreview(page, baseURL);
  await page.goto("/platform-admin/preview/businesses");
  await page.getByRole("button", { name: "Review classification" }).first().click();
  await expect(page.getByRole("dialog", { name: /confirm classification/i })).toBeVisible();
  await page.getByLabel("Decision reason").fill("Synthetic visual review");
  await page.getByLabel(/I reviewed this demo record/).check();
  await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.getByText(/Demo decision saved for this preview session/i)).toBeVisible();

  await page.getByText("Demo modes", { exact: true }).click();
  await page.getByLabel("Display state").selectOption("loading");
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Loading authorized platform information" })).toBeVisible();
  await page.getByLabel("Display state").selectOption("error");
  await expect(page.getByRole("alert")).toContainText("Demo data could not be loaded");
  await page.getByLabel("Display state").selectOption("empty");
  await expect(page.getByText("No records match this query.")).toBeVisible();
  expect(external).toEqual([]);
});

test("mobile drawer and keyboard focus controls remain accessible", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  await isolatePreview(page, baseURL);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto("/platform-admin/preview/users");
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pa-content")).toBeFocused();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog", { name: "Platform navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close platform navigation" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Platform navigation" })).toHaveCount(0);
  await page.getByRole("button", { name: "Invitations" }).click();
  await expect(page.getByRole("region", { name: "Users & Access records" })).toBeVisible();
});

test("mobile tabs show supported destinations and More returns focus", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  await isolatePreview(page, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform-admin/preview/overview");
  const tabs = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(tabs.getByRole("link")).toHaveCount(4);
  await expect(tabs.getByRole("button", { name: "More" })).toBeVisible();
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog", { name: "Platform navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tabs.getByRole("button", { name: "More" })).toBeFocused();
  await tabs.getByRole("link", { name: /Payments/ }).click();
  await expect(page.getByRole("heading", { name: "Payments & Renewals" })).toBeVisible();
});

test("overview prioritizes work without inventing health or missing counts", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  await isolatePreview(page, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform-admin/preview/overview");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  const order = await page.locator(".pa-overview > *").evaluateAll(elements => elements.map(element => element.className));
  expect(order[0]).toContain("pa-ui-attention");
  expect(order[1]).toContain("pa-overview-stats");
  await expect(page.locator(".pa-overview-stats")).toContainText("Total businesses");
  await expect(page.locator(".pa-overview-stats")).not.toContainText("Applications to decide");
  await expect(page.locator(".pa-ui-health .pa-badge-positive")).toHaveCount(0);
  await page.getByText("Demo modes", { exact: true }).click();
  await page.getByLabel("Display state").selectOption("partial");
  await expect(page.locator(".pa-overview-stats")).toContainText("Unavailable");
  await expect(page.locator(".pa-ui-attention")).toContainText("Unknown");
});

test("application review validates reasons, updates the queue, and keeps filters in the URL", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  const external = await isolatePreview(page, baseURL);
  await page.goto("/platform-admin/preview/applications");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.locator("tbody tr").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("tbody tr").nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(new URL(page.url()).searchParams.has("application")).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Reject", exact: true }).first().click();
  await page.getByLabel("Decision reason").fill("short");
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Confirm decision" })).toBeDisabled();
  await page.getByLabel("Decision reason").fill("Registration is incomplete");
  await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "Rejected", exact: true }).click();
  await expect(page).toHaveURL(/status=rejected/);
  await expect(page.locator("tbody")).toContainText("Demo administrator");
  await page.getByRole("searchbox", { name: "Search applications" }).fill("Riverside");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toBeFocused();
  expect(external).toEqual([]);
});

test("business controls preserve unknown lifecycle and only classify unclassified rows", async ({ page, baseURL }) => {
  test.skip(productionGuard, "Development preview only.");
  const external = await isolatePreview(page, baseURL);
  await page.goto("/platform-admin/preview/businesses");
  await expect(page.getByText("Entitlement", { exact: true })).toHaveCount(0);
  await expect(page.locator(".pa-data-table")).toContainText("Unknown");
  await expect(page.getByRole("button", { name: "Suspend" }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Unclassified", exact: true }).click();
  await expect(page).toHaveURL(/status=unclassified/);
  await expect(page.getByRole("button", { name: "Review classification" })).toHaveCount(2);
  await page.getByRole("button", { name: "Review classification" }).first().click();
  await page.getByLabel("Reviewed classification").selectOption("live");
  await page.getByLabel("Decision reason").fill("Reviewed supporting documentation");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect(page.getByText("Demo decision saved for this preview session.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review classification" })).toHaveCount(1);
  expect(external).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`redesigned workspace visual matrix in ${theme} theme`, async ({ page, baseURL }, testInfo) => {
    test.skip(productionGuard, "Development preview only.");
    test.setTimeout(180_000);
    const external = await isolatePreview(page, baseURL);
    await page.addInitScript(theme => localStorage.setItem("serveflow.public-theme", theme), theme);
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const section of ["overview", "applications", "businesses", "contracts", "payments", "users", "system-health"]) {
        await page.goto(`/platform-admin/preview/${section}`);
        await expect(page.locator("#pa-content h1")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-public-theme", theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${section} ${width}`).toBe(true);
        const contrast = await page.evaluate(() => {
          const lum = (color: string) => color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v => v/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          const fg=lum(getComputedStyle(document.querySelector(".pa-content h1")!).color), bg=lum(getComputedStyle(document.querySelector(".pa-root")!).backgroundColor);
          return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        await page.screenshot({path:testInfo.outputPath(`${theme}-${width}-${section}.png`),fullPage:true});
      }
    }
    expect(external).toEqual([]);
  });
}

test("directory search, filters, pagination, details and navigation are usable", async ({page,baseURL}) => {
  test.skip(productionGuard, "Development preview only.");
  const external=await isolatePreview(page,baseURL);
  await page.goto("/platform-admin/preview/businesses");
  await page.getByRole("button",{name:"Next page"}).click();
  await expect(page.getByRole("button",{name:"First page"})).toBeEnabled();
  await page.getByRole("button",{name:"First page"}).click();
  await page.getByLabel("Search",{exact:true}).fill("Acacia");
  await page.getByRole("button",{name:"Search",exact:true}).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button",{name:/View details for/}).click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic Acacia Lodge");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name:/View details for/})).toBeFocused();
  await page.getByLabel("Status",{exact:true}).selectOption("demo");
  await expect(page.getByText("No records match this query.",{exact:false})).toBeVisible();
  await page.setViewportSize({width:320,height:760});
  await page.getByRole("button",{name:"More"}).click();
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe("hidden");
  await page.getByRole("dialog",{name:"Platform navigation"}).getByRole("link",{name:"Applications",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Applications",exact:true})).toBeVisible();
  await expect(page.getByRole("dialog",{name:"Platform navigation"})).toHaveCount(0);
  expect(external).toEqual([]);
});

test("reviewed applications and payments have no repeat decision action", async ({page,baseURL}) => {
  test.skip(productionGuard, "Development preview only.");
  const external = await isolatePreview(page,baseURL);
  await page.goto("/platform-admin/preview/applications?status=approved");
  await expect(page.getByRole("button",{name:"Approve",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Reject",exact:true})).toHaveCount(0);
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
  await page.goto("/platform-admin/preview/payments?status=rejected");
  await expect(page.getByRole("button",{name:"Reject payment"})).toHaveCount(0);
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
  await page.setViewportSize({width:320,height:760});
  const reviewLabel = await page.locator('tbody tr:first-child td[data-label="Review"]').evaluate(cell => getComputedStyle(cell,"::before").content);
  expect(reviewLabel).toBe('"Review"');
  expect(external).toEqual([]);
});

test("sidebar, shared theme, status contrast and preview session isolation", async ({page,baseURL}, testInfo) => {
  test.skip(productionGuard, "Development preview only.");
  const external = await isolatePreview(page,baseURL);
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/platform-admin/preview/applications");
  await page.getByRole("button",{name:"Collapse sidebar"}).click();
  await expect(page.locator(".pa-shell")).toHaveClass(/pa-collapsed/);
  await page.getByRole("button",{name:"Expand sidebar"}).click();
  await expect(page.locator(".pa-shell")).not.toHaveClass(/pa-collapsed/);
  for (const theme of ["dark", "light"]) {
    const toggle = page.getByRole("button",{name:`Switch to ${theme} mode`});
    if (await toggle.count()) { await toggle.focus(); await page.keyboard.press("Enter"); }
    await expect(page.locator("html")).toHaveAttribute("data-public-theme",theme);
    const ratios = await page.locator(".pa-badge").evaluateAll(elements => {
      const lum = (color:string) => color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      return elements.map(el=>{const style=getComputedStyle(el),fg=lum(style.color),bg=lum(style.backgroundColor);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)});
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.includes("platform-admin")))).toEqual([]);
  await page.setViewportSize({width:320,height:760});
  await page.getByRole("button",{name:"More"}).click();
  await page.screenshot({path:testInfo.outputPath("mobile-navigation.png")});
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name:"More"})).toBeFocused();
  await page.getByRole("button",{name:"Approve",exact:true}).first().click();
  await page.screenshot({path:testInfo.outputPath("mobile-review-dialog.png")});
  await expect(page.getByRole("dialog")).toContainText("Changes stay in this preview session");
  await page.keyboard.press("Escape");
  expect(external).toEqual([]);
});
