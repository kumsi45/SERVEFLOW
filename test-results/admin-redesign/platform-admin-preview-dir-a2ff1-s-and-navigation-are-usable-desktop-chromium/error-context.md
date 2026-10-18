# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: platform-admin-preview.spec.ts >> directory search, filters, pagination, details and navigation are usable
- Location: tests\e2e\platform-admin-preview.spec.ts:118:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.selectOption: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByLabel('Status', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to content" [ref=e4] [cursor=pointer]:
    - /url: "#pa-content"
  - banner [ref=e5]:
    - link "ServeFlow Platform" [ref=e6] [cursor=pointer]:
      - /url: /platform-admin/preview/overview
      - img [ref=e7]
      - text: ServeFlow
      - generic [ref=e10]: Platform
    - generic [ref=e11]:
      - button "Switch to dark mode" [ref=e12] [cursor=pointer]:
        - img [ref=e13]
      - link "Exit preview" [ref=e15] [cursor=pointer]:
        - /url: /platform-admin/login
  - generic [ref=e16]:
    - generic [ref=e17]:
      - img [ref=e19]
      - generic [ref=e22]:
        - strong [ref=e23]: Platform workspace
        - generic [ref=e24]: ServeFlow administration
    - navigation "Platform administration" [ref=e25]:
      - paragraph [ref=e26]: Workspace
      - link "Overview" [ref=e27] [cursor=pointer]:
        - /url: /platform-admin/preview/overview
        - img [ref=e28]
        - generic [ref=e33]: Overview
      - link "Applications" [ref=e34] [cursor=pointer]:
        - /url: /platform-admin/preview/applications
        - img [ref=e35]
        - generic [ref=e39]: Applications
      - link "Businesses" [ref=e40] [cursor=pointer]:
        - /url: /platform-admin/preview/businesses
        - img [ref=e41]
        - generic [ref=e45]: Businesses
      - link "Subscriptions & Payments" [ref=e46] [cursor=pointer]:
        - /url: /platform-admin/preview/contracts
        - img [ref=e47]
        - generic [ref=e49]: Subscriptions & Payments
      - link "Users & Access" [ref=e50] [cursor=pointer]:
        - /url: /platform-admin/preview/users
        - img [ref=e51]
        - generic [ref=e56]: Users & Access
      - link "Notifications" [ref=e57] [cursor=pointer]:
        - /url: /platform-admin/preview/notifications
        - img [ref=e58]
        - generic [ref=e61]: Notifications
      - paragraph [ref=e62]: Platform operations
      - button "System & Security" [ref=e63] [cursor=pointer]:
        - img [ref=e64]
        - generic [ref=e67]: System & Security
        - img [ref=e68]
    - generic [ref=e70]:
      - generic [ref=e71]: P
      - generic [ref=e72]:
        - strong [ref=e73]: Visual preview
        - generic [ref=e74]: No administrative access
    - button "Collapse sidebar" [ref=e75] [cursor=pointer]:
      - img [ref=e76]
      - generic [ref=e79]: Collapse sidebar
  - main [ref=e80]:
    - generic [ref=e81]:
      - strong [ref=e82]: LOCAL PREVIEW · SYNTHETIC DATA
      - group [ref=e83]:
        - generic "Preview controls" [ref=e84] [cursor=pointer]:
          - img [ref=e85]
          - text: Preview controls
        - option "Populated" [selected]
        - option "Loading"
        - option "Empty"
        - option "Error"
    - generic [ref=e86]:
      - generic [ref=e87]:
        - paragraph [ref=e88]: Workspace
        - heading "Businesses" [level=1] [ref=e89]
        - paragraph [ref=e90]: Your hospitality business directory, with ownership and reviewed classification.
      - button "Refresh" [ref=e91] [cursor=pointer]:
        - img [ref=e92]
        - generic [ref=e97]: Refresh
    - group [ref=e98]:
      - generic "Available actions & policy" [ref=e99] [cursor=pointer]
    - generic [ref=e100]:
      - generic [ref=e101]:
        - text: Search
        - textbox "Search" [ref=e102]:
          - /placeholder: Search records
          - text: Acacia
      - generic [ref=e103]:
        - text: Status
        - combobox "Status" [ref=e104]:
          - option "All" [selected]
          - option "demo"
          - option "live"
          - option "unclassified"
      - button "Search" [ref=e105] [cursor=pointer]:
        - img [ref=e106]
        - text: Search
    - region "Businesses records" [ref=e109]:
      - table [ref=e110]:
        - rowgroup [ref=e111]:
          - row "Business Slug Classification Owner association Entitlement Created Details Review" [ref=e112]:
            - columnheader "Business" [ref=e113]
            - columnheader "Slug" [ref=e114]
            - columnheader "Classification" [ref=e115]
            - columnheader "Owner association" [ref=e116]
            - columnheader "Entitlement" [ref=e117]
            - columnheader "Created" [ref=e118]
            - columnheader "Details" [ref=e119]
            - columnheader "Review" [ref=e120]
        - rowgroup [ref=e121]:
          - row "Synthetic Acacia Lodge synthetic-business-2 live Preview Owner Unavailable in preview 1/14/2026, 12:30:00 PM View details for Synthetic Acacia Lodge Review classification" [ref=e122]:
            - cell "Synthetic Acacia Lodge" [ref=e123]
            - cell "synthetic-business-2" [ref=e124]
            - cell "live" [ref=e125]:
              - generic [ref=e126]: live
            - cell "Preview Owner" [ref=e127]
            - cell "Unavailable in preview" [ref=e128]
            - cell "1/14/2026, 12:30:00 PM" [ref=e129]
            - cell "View details for Synthetic Acacia Lodge" [ref=e130]:
              - button "View details for Synthetic Acacia Lodge" [active] [ref=e131] [cursor=pointer]: View details
            - cell "Review classification" [ref=e132]:
              - button "Review classification" [ref=e134] [cursor=pointer]
    - generic [ref=e135]:
      - button "First page" [disabled] [ref=e136]:
        - img [ref=e137]
        - text: First page
      - button "Next page" [disabled] [ref=e139]
    - paragraph [ref=e140]: "Source: Synthetic preview fixture — not platform data · Checked 1/15/2026, 12:30:00 PM"
```

# Test source

```ts
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
  110 |         expect(contrast).toBeGreaterThanOrEqual(4.5);
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
> 132 |   await page.getByLabel("Status",{exact:true}).selectOption("demo");
      |                                                ^ Error: locator.selectOption: Test timeout of 30000ms exceeded.
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