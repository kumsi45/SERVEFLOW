# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: platform-admin-preview.spec.ts >> business controls preserve unknown lifecycle and only classify unclassified rows
- Location: tests\e2e\platform-admin-preview.spec.ts:155:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('button', { name: 'Review classification' })
Expected: 1
Received: 2
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for getByRole('button', { name: 'Review classification' })
    4 × locator resolved to 0 elements
      - unexpected value "0"
    10 × locator resolved to 2 elements
       - unexpected value "2"

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
      - generic [ref=e10]: ServeFlow Platform
    - group [ref=e11]:
      - generic "Account and appearance" [ref=e12] [cursor=pointer]:
        - img [ref=e13]
  - main [ref=e16]:
    - generic [ref=e17]:
      - note [ref=e18]: Demo data
      - group [ref=e19]:
        - generic "Demo modes" [ref=e20] [cursor=pointer]:
          - img [ref=e21]
          - text: Demo modes
        - option "Populated" [selected]
        - option "Loading"
        - option "Empty"
        - option "Error"
        - option "Partial"
        - option "525 rows"
    - generic [ref=e22]:
      - heading "Businesses" [level=1] [ref=e24]
      - button "Refresh" [ref=e25] [cursor=pointer]:
        - img [ref=e26]
    - group [ref=e31]:
      - generic "Available actions & policy" [ref=e32] [cursor=pointer]
    - region "Businesses" [ref=e33]:
      - generic [ref=e34]:
        - generic "Business classification" [ref=e35]:
          - button "All" [ref=e36] [cursor=pointer]
          - button "Live" [ref=e37] [cursor=pointer]
          - button "Demo" [ref=e38] [cursor=pointer]
          - button "Unclassified" [pressed] [ref=e39] [cursor=pointer]
        - generic [ref=e40]:
          - img
          - generic [ref=e41]: Search businesses
          - searchbox "Search businesses" [ref=e42]
      - paragraph [ref=e43]:
        - generic "A reviewed label, not a paid entitlement." [ref=e44]: Classification
        - text: is reviewed separately from billing and access enforcement.
      - region "Business records" [ref=e45]:
        - table [ref=e46]:
          - rowgroup [ref=e47]:
            - row "Synthetic Juniper Kitchen Status Unknown Classification unclassified Owner Preview Owner Created Jan 13, 2026 Review classification Suspension needs server enforcement. Restoration needs server enforcement." [ref=e48] [cursor=pointer]:
              - cell "Synthetic Juniper Kitchen" [ref=e49]:
                - button "Synthetic Juniper Kitchen" [ref=e50]
              - cell "Status Unknown" [ref=e51]:
                - text: Status
                - generic [ref=e52]: Unknown
              - cell "Classification unclassified" [ref=e53]:
                - text: Classification
                - generic [ref=e54]: unclassified
              - cell "Owner Preview Owner" [ref=e55]
              - cell "Created Jan 13, 2026" [ref=e56]:
                - text: Created
                - time [ref=e57]: Jan 13, 2026
              - cell "Review classification Suspension needs server enforcement. Restoration needs server enforcement." [ref=e58]:
                - generic [ref=e59]:
                  - button "Review classification" [ref=e60]
                  - generic "Suspension needs server enforcement." [ref=e61]:
                    - button "Suspend" [disabled] [ref=e62]
                  - generic "Restoration needs server enforcement." [ref=e63]:
                    - button "Restore" [disabled] [ref=e64]
            - row "Synthetic Cedar Coffee Status Unknown Classification unclassified Owner Preview Owner Created Jan 10, 2026 Review classification Suspension needs server enforcement. Restoration needs server enforcement." [ref=e65] [cursor=pointer]:
              - cell "Synthetic Cedar Coffee" [ref=e66]:
                - button "Synthetic Cedar Coffee" [ref=e67]
              - cell "Status Unknown" [ref=e68]:
                - text: Status
                - generic [ref=e69]: Unknown
              - cell "Classification unclassified" [ref=e70]:
                - text: Classification
                - generic [ref=e71]: unclassified
              - cell "Owner Preview Owner" [ref=e72]
              - cell "Created Jan 10, 2026" [ref=e73]:
                - text: Created
                - time [ref=e74]: Jan 10, 2026
              - cell "Review classification Suspension needs server enforcement. Restoration needs server enforcement." [ref=e75]:
                - generic [ref=e76]:
                  - button "Review classification" [ref=e77]
                  - generic "Suspension needs server enforcement." [ref=e78]:
                    - button "Suspend" [disabled] [ref=e79]
                  - generic "Restoration needs server enforcement." [ref=e80]:
                    - button "Restore" [disabled] [ref=e81]
    - paragraph [ref=e82]: "Source: Synthetic preview fixture — not platform data · Checked 1/15/2026, 12:30:00 PM"
  - navigation "Primary navigation" [ref=e83]:
    - link "Overview" [ref=e84] [cursor=pointer]:
      - /url: /platform-admin/preview/overview
      - img [ref=e85]
      - generic [ref=e90]: Overview
    - link "Applications 3" [ref=e91] [cursor=pointer]:
      - /url: /platform-admin/preview/applications
      - img [ref=e92]
      - generic [ref=e96]: Applications
      - generic [ref=e97]: "3"
    - link "Businesses" [ref=e98] [cursor=pointer]:
      - /url: /platform-admin/preview/businesses
      - img [ref=e99]
      - generic [ref=e103]: Businesses
    - link "Payments 4" [ref=e104] [cursor=pointer]:
      - /url: /platform-admin/preview/payments
      - img [ref=e105]
      - generic [ref=e107]: Payments
      - generic [ref=e108]: "4"
    - button "More" [ref=e109] [cursor=pointer]:
      - img [ref=e110]
      - generic [ref=e114]: More
```

# Test source

```ts
  64  | 
  65  |   await page.getByText("Demo modes", { exact: true }).click();
  66  |   await page.getByLabel("Display state").selectOption("loading");
  67  |   await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Loading authorized platform information" })).toBeVisible();
  68  |   await page.getByLabel("Display state").selectOption("error");
  69  |   await expect(page.getByRole("alert")).toContainText("Demo data could not be loaded");
  70  |   await page.getByLabel("Display state").selectOption("empty");
  71  |   await expect(page.getByText("No records match this query.")).toBeVisible();
  72  |   expect(external).toEqual([]);
  73  | });
  74  | 
  75  | test("mobile drawer and keyboard focus controls remain accessible", async ({ page, baseURL }) => {
  76  |   test.skip(productionGuard, "Development preview only.");
  77  |   await isolatePreview(page, baseURL);
  78  |   await page.setViewportSize({ width: 320, height: 760 });
  79  |   await page.goto("/platform-admin/preview/users");
  80  |   await page.getByRole("link", { name: "Skip to content" }).focus();
  81  |   await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  82  |   await page.keyboard.press("Enter");
  83  |   await expect(page.locator("#pa-content")).toBeFocused();
  84  |   await page.getByRole("button", { name: "More" }).click();
  85  |   await expect(page.getByRole("dialog", { name: "Platform navigation" })).toBeVisible();
  86  |   await expect(page.getByRole("button", { name: "Close platform navigation" })).toBeFocused();
  87  |   await page.keyboard.press("Escape");
  88  |   await expect(page.getByRole("dialog", { name: "Platform navigation" })).toHaveCount(0);
  89  |   await page.getByRole("button", { name: "Invitations" }).click();
  90  |   await expect(page.getByRole("region", { name: "Users & Access records" })).toBeVisible();
  91  | });
  92  | 
  93  | test("mobile tabs show supported destinations and More returns focus", async ({ page, baseURL }) => {
  94  |   test.skip(productionGuard, "Development preview only.");
  95  |   await isolatePreview(page, baseURL);
  96  |   await page.setViewportSize({ width: 390, height: 844 });
  97  |   await page.goto("/platform-admin/preview/overview");
  98  |   const tabs = page.getByRole("navigation", { name: "Primary navigation" });
  99  |   await expect(tabs.getByRole("link")).toHaveCount(4);
  100 |   await expect(tabs.getByRole("button", { name: "More" })).toBeVisible();
  101 |   await tabs.getByRole("button", { name: "More" }).click();
  102 |   await expect(page.getByRole("dialog", { name: "Platform navigation" })).toBeVisible();
  103 |   await page.keyboard.press("Escape");
  104 |   await expect(tabs.getByRole("button", { name: "More" })).toBeFocused();
  105 |   await tabs.getByRole("link", { name: /Payments/ }).click();
  106 |   await expect(page.getByRole("heading", { name: "Payments & Renewals" })).toBeVisible();
  107 | });
  108 | 
  109 | test("overview prioritizes work without inventing health or missing counts", async ({ page, baseURL }) => {
  110 |   test.skip(productionGuard, "Development preview only.");
  111 |   await isolatePreview(page, baseURL);
  112 |   await page.setViewportSize({ width: 390, height: 844 });
  113 |   await page.goto("/platform-admin/preview/overview");
  114 |   await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  115 |   const order = await page.locator(".pa-overview > *").evaluateAll(elements => elements.map(element => element.className));
  116 |   expect(order[0]).toContain("pa-ui-attention");
  117 |   expect(order[1]).toContain("pa-overview-stats");
  118 |   await expect(page.locator(".pa-overview-stats")).toContainText("Total businesses");
  119 |   await expect(page.locator(".pa-overview-stats")).not.toContainText("Applications to decide");
  120 |   await expect(page.locator(".pa-ui-health .pa-badge-positive")).toHaveCount(0);
  121 |   await page.getByText("Demo modes", { exact: true }).click();
  122 |   await page.getByLabel("Display state").selectOption("partial");
  123 |   await expect(page.locator(".pa-overview-stats")).toContainText("Unavailable");
  124 |   await expect(page.locator(".pa-ui-attention")).toContainText("Unknown");
  125 | });
  126 | 
  127 | test("application review validates reasons, updates the queue, and keeps filters in the URL", async ({ page, baseURL }) => {
  128 |   test.skip(productionGuard, "Development preview only.");
  129 |   const external = await isolatePreview(page, baseURL);
  130 |   await page.goto("/platform-admin/preview/applications");
  131 |   await expect(page.locator("tbody tr")).toHaveCount(3);
  132 |   await page.locator("tbody tr").first().focus();
  133 |   await page.keyboard.press("ArrowDown");
  134 |   await expect(page.locator("tbody tr").nth(1)).toBeFocused();
  135 |   await page.keyboard.press("Enter");
  136 |   await expect(page.getByRole("dialog")).toBeVisible();
  137 |   expect(new URL(page.url()).searchParams.has("application")).toBe(true);
  138 |   await page.keyboard.press("Escape");
  139 |   await page.getByRole("button", { name: "Reject", exact: true }).first().click();
  140 |   await page.getByLabel("Decision reason").fill("short");
  141 |   await page.getByRole("checkbox").check();
  142 |   await expect(page.getByRole("button", { name: "Confirm decision" })).toBeDisabled();
  143 |   await page.getByLabel("Decision reason").fill("Registration is incomplete");
  144 |   await page.getByRole("button", { name: "Confirm decision" }).click();
  145 |   await expect(page.locator("tbody tr")).toHaveCount(2);
  146 |   await page.getByRole("button", { name: "Rejected", exact: true }).click();
  147 |   await expect(page).toHaveURL(/status=rejected/);
  148 |   await expect(page.locator("tbody")).toContainText("Demo administrator");
  149 |   await page.getByRole("searchbox", { name: "Search applications" }).fill("Riverside");
  150 |   await expect(page.locator("tbody tr")).toHaveCount(1);
  151 |   await expect(page.getByRole("searchbox")).toBeFocused();
  152 |   expect(external).toEqual([]);
  153 | });
  154 | 
  155 | test("business controls preserve unknown lifecycle and only classify unclassified rows", async ({ page, baseURL }) => {
  156 |   test.skip(productionGuard, "Development preview only.");
  157 |   const external = await isolatePreview(page, baseURL);
  158 |   await page.goto("/platform-admin/preview/businesses");
  159 |   await expect(page.getByText("Entitlement", { exact: true })).toHaveCount(0);
  160 |   await expect(page.locator(".pa-data-table")).toContainText("Unknown");
  161 |   await expect(page.getByRole("button", { name: "Suspend" }).first()).toBeDisabled();
  162 |   await page.getByRole("button", { name: "Unclassified", exact: true }).click();
  163 |   await expect(page).toHaveURL(/status=unclassified/);
> 164 |   await expect(page.getByRole("button", { name: "Review classification" })).toHaveCount(1);
      |                                                                             ^ Error: expect(locator).toHaveCount(expected) failed
  165 |   await page.getByRole("button", { name: "Review classification" }).click();
  166 |   await page.getByLabel("Reviewed classification").selectOption("live");
  167 |   await page.getByLabel("Decision reason").fill("Reviewed supporting documentation");
  168 |   await page.getByRole("checkbox").check();
  169 |   await page.getByRole("button", { name: "Confirm decision" }).click();
  170 |   await expect(page.getByText("Demo decision saved for this preview session.")).toBeVisible();
  171 |   await expect(page.getByText("No businesses found")).toBeVisible();
  172 |   expect(external).toEqual([]);
  173 | });
  174 | 
  175 | for (const theme of ["light", "dark"] as const) {
  176 |   test(`redesigned workspace visual matrix in ${theme} theme`, async ({ page, baseURL }, testInfo) => {
  177 |     test.skip(productionGuard, "Development preview only.");
  178 |     test.setTimeout(180_000);
  179 |     const external = await isolatePreview(page, baseURL);
  180 |     await page.addInitScript(theme => localStorage.setItem("serveflow.public-theme", theme), theme);
  181 |     for (const width of [320, 375, 768, 1024, 1440]) {
  182 |       await page.setViewportSize({ width, height: 900 });
  183 |       for (const section of ["overview", "applications", "businesses", "contracts", "payments", "users", "system-health"]) {
  184 |         await page.goto(`/platform-admin/preview/${section}`);
  185 |         await expect(page.locator("#pa-content h1")).toBeVisible();
  186 |         await expect(page.locator("html")).toHaveAttribute("data-public-theme", theme);
  187 |         expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${section} ${width}`).toBe(true);
  188 |         const contrast = await page.evaluate(() => {
  189 |           const lum = (color: string) => color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v => v/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  190 |           const fg=lum(getComputedStyle(document.querySelector(".pa-content h1")!).color), bg=lum(getComputedStyle(document.querySelector(".pa-root")!).backgroundColor);
  191 |           return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
  192 |         });
  193 |         expect(contrast).toBeGreaterThanOrEqual(4.5);
  194 |         await page.screenshot({path:testInfo.outputPath(`${theme}-${width}-${section}.png`),fullPage:true});
  195 |       }
  196 |     }
  197 |     expect(external).toEqual([]);
  198 |   });
  199 | }
  200 | 
  201 | test("directory search, filters, pagination, details and navigation are usable", async ({page,baseURL}) => {
  202 |   test.skip(productionGuard, "Development preview only.");
  203 |   const external=await isolatePreview(page,baseURL);
  204 |   await page.goto("/platform-admin/preview/businesses");
  205 |   await page.getByRole("button",{name:"Next page"}).click();
  206 |   await expect(page.getByRole("button",{name:"First page"})).toBeEnabled();
  207 |   await page.getByRole("button",{name:"First page"}).click();
  208 |   await page.getByLabel("Search",{exact:true}).fill("Acacia");
  209 |   await page.getByRole("button",{name:"Search",exact:true}).click();
  210 |   await expect(page.locator("tbody tr")).toHaveCount(1);
  211 |   await page.getByRole("button",{name:/View details for/}).click();
  212 |   await expect(page.getByRole("dialog")).toContainText("Synthetic Acacia Lodge");
  213 |   await page.keyboard.press("Escape");
  214 |   await expect(page.getByRole("button",{name:/View details for/})).toBeFocused();
  215 |   await page.getByLabel("Status",{exact:true}).selectOption("demo");
  216 |   await expect(page.getByText("No records match this query.",{exact:false})).toBeVisible();
  217 |   await page.setViewportSize({width:320,height:760});
  218 |   await page.getByRole("button",{name:"More"}).click();
  219 |   expect(await page.evaluate(()=>document.body.style.overflow)).toBe("hidden");
  220 |   await page.getByRole("dialog",{name:"Platform navigation"}).getByRole("link",{name:"Applications",exact:true}).click();
  221 |   await expect(page.getByRole("heading",{name:"Applications",exact:true})).toBeVisible();
  222 |   await expect(page.getByRole("dialog",{name:"Platform navigation"})).toHaveCount(0);
  223 |   expect(external).toEqual([]);
  224 | });
  225 | 
  226 | test("reviewed applications and payments have no repeat decision action", async ({page,baseURL}) => {
  227 |   test.skip(productionGuard, "Development preview only.");
  228 |   const external = await isolatePreview(page,baseURL);
  229 |   await page.goto("/platform-admin/preview/applications?status=approved");
  230 |   await expect(page.getByRole("button",{name:"Approve",exact:true})).toHaveCount(0);
  231 |   await expect(page.getByRole("button",{name:"Reject",exact:true})).toHaveCount(0);
  232 |   await expect(page.locator("tbody tr")).not.toHaveCount(0);
  233 |   await page.goto("/platform-admin/preview/payments?status=rejected");
  234 |   await expect(page.getByRole("button",{name:"Reject payment"})).toHaveCount(0);
  235 |   await expect(page.locator("tbody tr")).not.toHaveCount(0);
  236 |   await page.setViewportSize({width:320,height:760});
  237 |   const reviewLabel = await page.locator('tbody tr:first-child td[data-label="Review"]').evaluate(cell => getComputedStyle(cell,"::before").content);
  238 |   expect(reviewLabel).toBe('"Review"');
  239 |   expect(external).toEqual([]);
  240 | });
  241 | 
  242 | test("sidebar, shared theme, status contrast and preview session isolation", async ({page,baseURL}, testInfo) => {
  243 |   test.skip(productionGuard, "Development preview only.");
  244 |   const external = await isolatePreview(page,baseURL);
  245 |   await page.setViewportSize({width:1440,height:900});
  246 |   await page.goto("/platform-admin/preview/applications");
  247 |   await page.getByRole("button",{name:"Collapse sidebar"}).click();
  248 |   await expect(page.locator(".pa-shell")).toHaveClass(/pa-collapsed/);
  249 |   await page.getByRole("button",{name:"Expand sidebar"}).click();
  250 |   await expect(page.locator(".pa-shell")).not.toHaveClass(/pa-collapsed/);
  251 |   for (const theme of ["dark", "light"]) {
  252 |     const toggle = page.getByRole("button",{name:`Switch to ${theme} mode`});
  253 |     if (await toggle.count()) { await toggle.focus(); await page.keyboard.press("Enter"); }
  254 |     await expect(page.locator("html")).toHaveAttribute("data-public-theme",theme);
  255 |     const ratios = await page.locator(".pa-badge").evaluateAll(elements => {
  256 |       const lum = (color:string) => color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  257 |       return elements.map(el=>{const style=getComputedStyle(el),fg=lum(style.color),bg=lum(style.backgroundColor);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)});
  258 |     });
  259 |     for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  260 |   }
  261 |   expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.includes("platform-admin")))).toEqual([]);
  262 |   await page.setViewportSize({width:320,height:760});
  263 |   await page.getByRole("button",{name:"More"}).click();
  264 |   await page.screenshot({path:testInfo.outputPath("mobile-navigation.png")});
```