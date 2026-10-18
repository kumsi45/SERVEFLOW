# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: platform-admin-preview.spec.ts >> redesigned workspace visual matrix in light theme
- Location: tests\e2e\platform-admin-preview.spec.ts:93:3

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 4.5
Received:    1.0759538694802715
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to content" [ref=e4] [cursor=pointer]:
    - /url: "#pa-content"
  - banner [ref=e5]:
    - link "ServeFlow" [ref=e6] [cursor=pointer]:
      - /url: /platform-admin/preview/overview
      - img [ref=e7]
      - text: ServeFlow
    - generic [ref=e10]:
      - button "Switch to dark mode" [ref=e11] [cursor=pointer]:
        - img [ref=e12]
      - link "Exit preview" [ref=e14] [cursor=pointer]:
        - /url: /platform-admin/login
      - button "Open platform navigation" [ref=e15] [cursor=pointer]:
        - img [ref=e16]
  - main [ref=e17]:
    - generic [ref=e18]:
      - strong [ref=e19]: LOCAL PREVIEW · SYNTHETIC DATA
      - group [ref=e20]:
        - generic "Preview controls" [ref=e21] [cursor=pointer]:
          - img [ref=e22]
          - text: Preview controls
        - option "Populated" [selected]
        - option "Loading"
        - option "Empty"
        - option "Error"
    - generic [ref=e23]:
      - generic [ref=e24]:
        - paragraph [ref=e25]: Workspace
        - heading "Platform overview" [level=1] [ref=e26]
        - paragraph [ref=e27]: Monitor businesses, subscriptions, payments, and platform health.
      - button [ref=e28] [cursor=pointer]:
        - img [ref=e29]
    - generic [ref=e34]:
      - generic [ref=e35]:
        - heading "Total businesses" [level=2] [ref=e37]
        - paragraph [ref=e38]: "7"
        - generic [ref=e39]:
          - generic [ref=e40]: Your complete business directory
          - link "View total businesses" [ref=e41] [cursor=pointer]:
            - /url: /platform-admin/preview/businesses
            - img [ref=e42]
      - generic [ref=e45]:
        - heading "Active businesses" [level=2] [ref=e47]
        - paragraph [ref=e48]: Unavailable
        - generic [ref=e49]:
          - generic [ref=e50]: Verified data not available
          - link "View active businesses" [ref=e51] [cursor=pointer]:
            - /url: /platform-admin/preview/businesses
            - img [ref=e52]
      - generic [ref=e55]:
        - heading "Applications awaiting review" [level=2] [ref=e57]
        - paragraph [ref=e58]: "3"
        - generic [ref=e59]:
          - generic [ref=e60]: New businesses requesting access
          - link "View applications awaiting review" [ref=e61] [cursor=pointer]:
            - /url: /platform-admin/preview/applications
            - img [ref=e62]
      - generic [ref=e65]:
        - heading "Contracts expiring soon" [level=2] [ref=e67]
        - paragraph [ref=e68]: Unavailable
        - generic [ref=e69]:
          - generic [ref=e70]: Verified data not available
          - link "View contracts expiring soon" [ref=e71] [cursor=pointer]:
            - /url: /platform-admin/preview/contracts
            - img [ref=e72]
      - generic [ref=e75]:
        - heading "Payments awaiting review" [level=2] [ref=e77]
        - paragraph [ref=e78]: "4"
        - generic [ref=e79]:
          - generic [ref=e80]: Submitted evidence to review
          - link "View payments awaiting review" [ref=e81] [cursor=pointer]:
            - /url: /platform-admin/preview/payments
            - img [ref=e82]
      - generic [ref=e85]:
        - heading "Active trials" [level=2] [ref=e87]
        - paragraph [ref=e88]: Unavailable
        - generic [ref=e89]:
          - generic [ref=e90]: Verified data not available
          - link "View active trials" [ref=e91] [cursor=pointer]:
            - /url: /platform-admin/preview/contracts
            - img [ref=e92]
    - generic [ref=e95]:
      - generic [ref=e96]:
        - generic [ref=e97]:
          - generic [ref=e98]:
            - paragraph [ref=e99]: Your work queue
            - heading "Needs your attention" [level=2] [ref=e100]
          - img [ref=e101]
        - link "3 Applications need a decision Review business details before approving or rejecting." [ref=e105] [cursor=pointer]:
          - /url: /platform-admin/preview/applications
          - generic [ref=e106]: "3"
          - generic [ref=e107]:
            - strong [ref=e108]: Applications need a decision
            - generic [ref=e109]: Review business details before approving or rejecting.
          - img [ref=e110]
        - link "4 Payment evidence needs review Check submitted evidence; no payment is confirmed automatically." [ref=e113] [cursor=pointer]:
          - /url: /platform-admin/preview/payments
          - generic [ref=e114]: "4"
          - generic [ref=e115]:
            - strong [ref=e116]: Payment evidence needs review
            - generic [ref=e117]: Check submitted evidence; no payment is confirmed automatically.
          - img [ref=e118]
        - link "— Upcoming contract renewals This queue is not yet available." [ref=e121] [cursor=pointer]:
          - /url: /platform-admin/preview/contracts
          - generic [ref=e122]: —
          - generic [ref=e123]:
            - strong [ref=e124]: Upcoming contract renewals
            - generic [ref=e125]: This queue is not yet available.
          - img [ref=e126]
        - link "Platform health & security Open service checks · overall status not verified" [ref=e129] [cursor=pointer]:
          - /url: /platform-admin/preview/system-health
          - img [ref=e130]
          - generic [ref=e133]:
            - text: Platform health & security
            - generic [ref=e134]: Open service checks · overall status not verified
          - img [ref=e135]
      - generic [ref=e138]:
        - generic [ref=e139]:
          - generic [ref=e140]:
            - paragraph [ref=e141]: A clear record
            - heading "Recent platform activity" [level=2] [ref=e142]
          - img [ref=e143]
        - list [ref=e145]:
          - listitem [ref=e146]:
            - generic [ref=e148]:
              - strong [ref=e149]: Application reviewed
              - paragraph [ref=e150]: Synthetic Acacia Lodge
              - generic [ref=e151]: Synthetic reviewer · 1/14/2026, 1:00:00 PM
          - listitem [ref=e152]:
            - generic [ref=e154]:
              - strong [ref=e155]: Payment evidence rejected
              - paragraph [ref=e156]: Synthetic Market Bistro
              - generic [ref=e157]: Synthetic reviewer · 1/14/2026, 12:00:00 PM
          - listitem [ref=e158]:
            - generic [ref=e160]:
              - strong [ref=e161]: Business classification reviewed
              - paragraph [ref=e162]: Synthetic Riverside Cafe
              - generic [ref=e163]: Synthetic reviewer · 1/13/2026, 6:30:00 PM
        - link "View audit logs" [ref=e164] [cursor=pointer]:
          - /url: /platform-admin/preview/audit-logs
          - text: View audit logs
          - img [ref=e165]
    - generic [ref=e168]:
      - generic [ref=e169]:
        - paragraph [ref=e170]: Subscription portfolio
        - heading "Contracts & business continuity" [level=2] [ref=e171]
        - paragraph [ref=e172]: Review terms before renewal. Expiry never means deleting business history.
      - generic [ref=e173]:
        - generic [ref=e174]: Active annual contracts
        - strong [ref=e175]: Unavailable
      - generic [ref=e176]:
        - generic [ref=e177]: Expired contracts
        - strong [ref=e178]: Unavailable
      - link "Review contracts" [ref=e179] [cursor=pointer]:
        - /url: /platform-admin/preview/contracts
        - text: Review contracts
        - img [ref=e180]
    - paragraph [ref=e183]: "Source: Synthetic preview fixture — not platform data · Checked 1/15/2026, 12:30:00 PM"
```

# Test source

```ts
  10  |   await page.route("**/*", route => {
  11  |     const url = new URL(route.request().url());
  12  |     if (url.origin === new URL(baseURL).origin) return route.continue();
  13  |     external.push(url.href);
  14  |     return route.abort("blockedbyclient");
  15  |   });
  16  |   return external;
  17  | }
  18  | 
  19  | test("production build does not expose the synthetic preview route", async ({ page, baseURL }) => {
  20  |   test.skip(!productionGuard, "Runs against the production preview server in the build verification step.");
  21  |   await isolatePreview(page, baseURL);
  22  |   await page.goto("/platform-admin/preview");
  23  |   await expect(page.getByText("Menu link not found.")).toBeVisible();
  24  |   await expect(page.getByText("LOCAL PREVIEW · SYNTHETIC DATA")).toHaveCount(0);
  25  | });
  26  | 
  27  | for (const width of widths) {
  28  |   test(`local synthetic preview has no page overflow at ${width}px`, async ({ page, baseURL }, testInfo) => {
  29  |     test.skip(productionGuard, "Development preview only.");
  30  |     const external = await isolatePreview(page, baseURL);
  31  |     await page.setViewportSize({ width, height: width <= 375 ? 760 : 900 });
  32  |     await page.goto("/platform-admin/preview");
  33  |     await expect(page.getByText("LOCAL PREVIEW · SYNTHETIC DATA")).toBeVisible();
  34  |     await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
  35  |     expect(await page.evaluate(() => ({ document: document.documentElement.scrollWidth <= document.documentElement.clientWidth, body: document.body.scrollWidth <= document.body.clientWidth }))).toEqual({ document: true, body: true });
  36  |     expect(external).toEqual([]);
  37  |     if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`platform-admin-preview-${width}.png`), fullPage: true });
  38  |   });
  39  | }
  40  | 
  41  | test("all fourteen synthetic sections render without platform requests", async ({ page, baseURL }) => {
  42  |   test.skip(productionGuard, "Development preview only.");
  43  |   const external = await isolatePreview(page, baseURL);
  44  |   for (const section of sections) {
  45  |     await page.goto(`/platform-admin/preview/${section}`);
  46  |     await expect(page.getByText("LOCAL PREVIEW · SYNTHETIC DATA")).toBeVisible();
  47  |     await expect(page.locator('nav[aria-label="Platform administration"] a[aria-current="page"]')).toHaveCount(1);
  48  |     await expect(page.locator("#pa-content h1")).toBeVisible();
  49  |   }
  50  |   expect(external).toEqual([]);
  51  | });
  52  | 
  53  | test("preview states, filters and mutation dialogs remain synthetic no-ops", async ({ page, baseURL }) => {
  54  |   test.skip(productionGuard, "Development preview only.");
  55  |   const external = await isolatePreview(page, baseURL);
  56  |   await page.goto("/platform-admin/preview/businesses");
  57  |   await page.getByRole("button", { name: "Review classification" }).first().click();
  58  |   await expect(page.getByRole("dialog", { name: /confirm classification/i })).toBeVisible();
  59  |   await page.getByLabel("Decision reason").fill("Synthetic visual review");
  60  |   await page.getByLabel(/I reviewed the synthetic target/).check();
  61  |   await page.getByRole("button", { name: "Preview decision — no changes" }).click();
  62  |   await expect(page.getByText(/synthetic decision was not saved/i)).toBeVisible();
  63  | 
  64  |   await page.getByText("Preview controls", { exact: true }).click();
  65  |   await page.getByLabel("Display state").selectOption("loading");
  66  |   await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Loading authorized platform information" })).toBeVisible();
  67  |   await page.getByLabel("Display state").selectOption("error");
  68  |   await expect(page.getByRole("alert")).toContainText("Synthetic preview error");
  69  |   await page.getByLabel("Display state").selectOption("empty");
  70  |   await expect(page.getByText("No records match this query.")).toBeVisible();
  71  |   expect(external).toEqual([]);
  72  | });
  73  | 
  74  | test("mobile drawer and keyboard focus controls remain accessible", async ({ page, baseURL }) => {
  75  |   test.skip(productionGuard, "Development preview only.");
  76  |   await isolatePreview(page, baseURL);
  77  |   await page.setViewportSize({ width: 320, height: 760 });
  78  |   await page.goto("/platform-admin/preview/users");
  79  |   await page.getByRole("link", { name: "Skip to content" }).focus();
  80  |   await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  81  |   await page.keyboard.press("Enter");
  82  |   await expect(page.locator("#pa-content")).toBeFocused();
  83  |   await page.getByRole("button", { name: "Open platform navigation" }).click();
  84  |   await expect(page.getByRole("dialog", { name: "Platform navigation" })).toBeVisible();
  85  |   await expect(page.getByRole("button", { name: "Close platform navigation" })).toBeFocused();
  86  |   await page.keyboard.press("Escape");
  87  |   await expect(page.getByRole("dialog", { name: "Platform navigation" })).toHaveCount(0);
  88  |   await page.getByRole("button", { name: "Invitation intents" }).click();
  89  |   await expect(page.getByRole("region", { name: "Users & Access records" })).toBeVisible();
  90  | });
  91  | 
  92  | for (const theme of ["light", "dark"] as const) {
  93  |   test(`redesigned workspace visual matrix in ${theme} theme`, async ({ page, baseURL }, testInfo) => {
  94  |     test.skip(productionGuard, "Development preview only.");
  95  |     test.setTimeout(180_000);
  96  |     const external = await isolatePreview(page, baseURL);
  97  |     await page.addInitScript(theme => localStorage.setItem("serveflow.public-theme", theme), theme);
  98  |     for (const width of [320, 375, 768, 1024, 1440]) {
  99  |       await page.setViewportSize({ width, height: 900 });
  100 |       for (const section of ["overview", "applications", "businesses", "contracts", "payments", "users", "system-health"]) {
  101 |         await page.goto(`/platform-admin/preview/${section}`);
  102 |         await expect(page.locator("#pa-content h1")).toBeVisible();
  103 |         await expect(page.locator("html")).toHaveAttribute("data-public-theme", theme);
  104 |         expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${section} ${width}`).toBe(true);
  105 |         const contrast = await page.evaluate(() => {
  106 |           const lum = (color: string) => color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v => v/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  107 |           const fg=lum(getComputedStyle(document.querySelector(".pa-content h1")!).color), bg=lum(getComputedStyle(document.querySelector(".pa-root")!).backgroundColor);
  108 |           return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
  109 |         });
> 110 |         expect(contrast).toBeGreaterThanOrEqual(4.5);
      |                          ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  111 |         await page.screenshot({path:testInfo.outputPath(`${theme}-${width}-${section}.png`),fullPage:true});
  112 |       }
  113 |     }
  114 |     expect(external).toEqual([]);
  115 |   });
  116 | }
  117 | 
  118 | test("directory search, filters, pagination, details and navigation are usable", async ({page,baseURL}) => {
  119 |   test.skip(productionGuard, "Development preview only.");
  120 |   const external=await isolatePreview(page,baseURL);
  121 |   await page.goto("/platform-admin/preview/businesses");
  122 |   await page.getByRole("button",{name:"Next page"}).click();
  123 |   await expect(page.getByRole("button",{name:"First page"})).toBeEnabled();
  124 |   await page.getByRole("button",{name:"First page"}).click();
  125 |   await page.getByLabel("Search",{exact:true}).fill("Acacia");
  126 |   await page.getByRole("button",{name:"Search",exact:true}).click();
  127 |   await expect(page.locator("tbody tr")).toHaveCount(1);
  128 |   await page.getByRole("button",{name:/View details for/}).click();
  129 |   await expect(page.getByRole("dialog")).toContainText("Synthetic Acacia Lodge");
  130 |   await page.keyboard.press("Escape");
  131 |   await expect(page.getByRole("button",{name:/View details for/})).toBeFocused();
  132 |   await page.getByLabel("Status",{exact:true}).selectOption("demo");
  133 |   await expect(page.getByText("No records match this query.",{exact:false})).toBeVisible();
  134 |   await page.setViewportSize({width:320,height:760});
  135 |   await page.getByRole("button",{name:"Open platform navigation"}).click();
  136 |   expect(await page.evaluate(()=>document.body.style.overflow)).toBe("hidden");
  137 |   await page.getByRole("dialog",{name:"Platform navigation"}).getByRole("link",{name:"Applications",exact:true}).click();
  138 |   await expect(page.getByRole("heading",{name:"Applications",exact:true})).toBeVisible();
  139 |   await expect(page.getByRole("dialog",{name:"Platform navigation"})).toHaveCount(0);
  140 |   expect(external).toEqual([]);
  141 | });
  142 | 
```