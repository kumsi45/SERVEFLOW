# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cashier-checkout-workspace.spec.ts >> checkout slide-over is fixed, single, scrollable, and mode aware
- Location: tests\e2e\cashier-checkout-workspace.spec.ts:89:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

@@ -1,10 +1,10 @@
  Object {
    "bodyScrolls": true,
    "closeTarget": true,
    "drawerCount": 1,
-   "drawerLeft": 792,
+   "drawerLeft": 791,
    "drawerOverflow": false,
    "drawerRight": 1366,
    "footerVisible": true,
    "headerVisible": true,
    "onePrimary": 1,
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]
    - complementary [ref=e4]
    - main [ref=e5]:
      - button "Verify Payment" [ref=e6] [cursor=pointer]
    - complementary "Service locations" [ref=e7]:
      - button "Quick Switch" [ref=e9] [cursor=pointer]
  - dialog "Service Location 9" [ref=e10]:
    - banner [ref=e11]:
      - generic [ref=e12]:
        - generic [ref=e13]: Checkout
        - button "Close checkout" [ref=e14] [cursor=pointer]: ×
      - generic [ref=e15]:
        - heading "Service Location 9" [level=2] [ref=e16]
        - 'generic "Waiter: Abdi" [ref=e17]':
          - generic [ref=e18]: Waiter
          - generic [ref=e19]: •
          - strong [ref=e20]: Abdi
      - 'generic "Current queue status: Payment Due" [ref=e21]': Payment Due
    - generic [ref=e23]:
      - region "Transaction information" [ref=e24]:
        - generic [ref=e25]: Inv 42·
        - generic [ref=e26]: Created 12:03 PM·
        - generic [ref=e27]: Payment Due
      - region "Order Items 32" [ref=e29]:
        - generic [ref=e30]:
          - text: Order Items
          - generic [ref=e31]: "32"
        - generic [ref=e32]:
          - generic [ref=e33]:
            - generic [ref=e34]:
              - text: Long service item name 1 with extra preparation text x1
              - generic [ref=e35]: No onions, extra sauce, table note 1
            - generic [ref=e36]: ETB 180
          - generic [ref=e37]:
            - generic [ref=e38]:
              - text: Long service item name 2 with extra preparation text x2
              - generic [ref=e39]: No onions, extra sauce, table note 2
            - generic [ref=e40]: ETB 187
          - generic [ref=e41]:
            - generic [ref=e42]:
              - text: Long service item name 3 with extra preparation text x3
              - generic [ref=e43]: No onions, extra sauce, table note 3
            - generic [ref=e44]: ETB 194
          - generic [ref=e45]:
            - generic [ref=e46]:
              - text: Long service item name 4 with extra preparation text x1
              - generic [ref=e47]: No onions, extra sauce, table note 4
            - generic [ref=e48]: ETB 201
          - generic [ref=e49]:
            - generic [ref=e50]:
              - text: Long service item name 5 with extra preparation text x2
              - generic [ref=e51]: No onions, extra sauce, table note 5
            - generic [ref=e52]: ETB 208
          - generic [ref=e53]:
            - generic [ref=e54]:
              - text: Long service item name 6 with extra preparation text x3
              - generic [ref=e55]: No onions, extra sauce, table note 6
            - generic [ref=e56]: ETB 215
          - generic [ref=e57]:
            - generic [ref=e58]:
              - text: Long service item name 7 with extra preparation text x1
              - generic [ref=e59]: No onions, extra sauce, table note 7
            - generic [ref=e60]: ETB 222
          - generic [ref=e61]:
            - generic [ref=e62]:
              - text: Long service item name 8 with extra preparation text x2
              - generic [ref=e63]: No onions, extra sauce, table note 8
            - generic [ref=e64]: ETB 229
          - generic [ref=e65]:
            - generic [ref=e66]:
              - text: Long service item name 9 with extra preparation text x3
              - generic [ref=e67]: No onions, extra sauce, table note 9
            - generic [ref=e68]: ETB 236
          - generic [ref=e69]:
            - generic [ref=e70]:
              - text: Long service item name 10 with extra preparation text x1
              - generic [ref=e71]: No onions, extra sauce, table note 10
            - generic [ref=e72]: ETB 243
          - generic [ref=e73]:
            - generic [ref=e74]:
              - text: Long service item name 11 with extra preparation text x2
              - generic [ref=e75]: No onions, extra sauce, table note 11
            - generic [ref=e76]: ETB 250
          - generic [ref=e77]:
            - generic [ref=e78]:
              - text: Long service item name 12 with extra preparation text x3
              - generic [ref=e79]: No onions, extra sauce, table note 12
            - generic [ref=e80]: ETB 257
          - generic [ref=e81]:
            - generic [ref=e82]:
              - text: Long service item name 13 with extra preparation text x1
              - generic [ref=e83]: No onions, extra sauce, table note 13
            - generic [ref=e84]: ETB 264
          - generic [ref=e85]:
            - generic [ref=e86]:
              - text: Long service item name 14 with extra preparation text x2
              - generic [ref=e87]: No onions, extra sauce, table note 14
            - generic [ref=e88]: ETB 271
          - generic [ref=e89]:
            - generic [ref=e90]:
              - text: Long service item name 15 with extra preparation text x3
              - generic [ref=e91]: No onions, extra sauce, table note 15
            - generic [ref=e92]: ETB 278
          - generic [ref=e93]:
            - generic [ref=e94]:
              - text: Long service item name 16 with extra preparation text x1
              - generic [ref=e95]: No onions, extra sauce, table note 16
            - generic [ref=e96]: ETB 285
          - generic [ref=e97]:
            - generic [ref=e98]:
              - text: Long service item name 17 with extra preparation text x2
              - generic [ref=e99]: No onions, extra sauce, table note 17
            - generic [ref=e100]: ETB 292
          - generic [ref=e101]:
            - generic [ref=e102]:
              - text: Long service item name 18 with extra preparation text x3
              - generic [ref=e103]: No onions, extra sauce, table note 18
            - generic [ref=e104]: ETB 299
          - generic [ref=e105]:
            - generic [ref=e106]:
              - text: Long service item name 19 with extra preparation text x1
              - generic [ref=e107]: No onions, extra sauce, table note 19
            - generic [ref=e108]: ETB 306
          - generic [ref=e109]:
            - generic [ref=e110]:
              - text: Long service item name 20 with extra preparation text x2
              - generic [ref=e111]: No onions, extra sauce, table note 20
            - generic [ref=e112]: ETB 313
          - generic [ref=e113]:
            - generic [ref=e114]:
              - text: Long service item name 21 with extra preparation text x3
              - generic [ref=e115]: No onions, extra sauce, table note 21
            - generic [ref=e116]: ETB 320
          - generic [ref=e117]:
            - generic [ref=e118]:
              - text: Long service item name 22 with extra preparation text x1
              - generic [ref=e119]: No onions, extra sauce, table note 22
            - generic [ref=e120]: ETB 327
          - generic [ref=e121]:
            - generic [ref=e122]:
              - text: Long service item name 23 with extra preparation text x2
              - generic [ref=e123]: No onions, extra sauce, table note 23
            - generic [ref=e124]: ETB 334
          - generic [ref=e125]:
            - generic [ref=e126]:
              - text: Long service item name 24 with extra preparation text x3
              - generic [ref=e127]: No onions, extra sauce, table note 24
            - generic [ref=e128]: ETB 341
          - generic [ref=e129]:
            - generic [ref=e130]:
              - text: Long service item name 25 with extra preparation text x1
              - generic [ref=e131]: No onions, extra sauce, table note 25
            - generic [ref=e132]: ETB 348
          - generic [ref=e133]:
            - generic [ref=e134]:
              - text: Long service item name 26 with extra preparation text x2
              - generic [ref=e135]: No onions, extra sauce, table note 26
            - generic [ref=e136]: ETB 355
          - generic [ref=e137]:
            - generic [ref=e138]:
              - text: Long service item name 27 with extra preparation text x3
              - generic [ref=e139]: No onions, extra sauce, table note 27
            - generic [ref=e140]: ETB 362
          - generic [ref=e141]:
            - generic [ref=e142]:
              - text: Long service item name 28 with extra preparation text x1
              - generic [ref=e143]: No onions, extra sauce, table note 28
            - generic [ref=e144]: ETB 369
          - generic [ref=e145]:
            - generic [ref=e146]:
              - text: Long service item name 29 with extra preparation text x2
              - generic [ref=e147]: No onions, extra sauce, table note 29
            - generic [ref=e148]: ETB 376
          - generic [ref=e149]:
            - generic [ref=e150]:
              - text: Long service item name 30 with extra preparation text x3
              - generic [ref=e151]: No onions, extra sauce, table note 30
            - generic [ref=e152]: ETB 383
          - generic [ref=e153]:
            - generic [ref=e154]:
              - text: Long service item name 31 with extra preparation text x1
              - generic [ref=e155]: No onions, extra sauce, table note 31
            - generic [ref=e156]: ETB 390
          - generic [ref=e157]:
            - generic [ref=e158]:
              - text: Long service item name 32 with extra preparation text x2
              - generic [ref=e159]: No onions, extra sauce, table note 32
            - generic [ref=e160]: ETB 397
      - region "Bill summary" [ref=e161]:
        - generic [ref=e162]: Bill Summary
        - generic [ref=e163]:
          - generic [ref=e164]: Subtotal
          - strong [ref=e165]: ETB 520.00
          - generic [ref=e166]: VAT
          - strong [ref=e167]: ETB 78.00
          - generic [ref=e168]: Service Charge
          - strong [ref=e169]: ETB 52.00
          - generic [ref=e170]: Discount
          - strong [ref=e171]: "- ETB 17.50"
        - generic [ref=e172]: Total
        - generic [ref=e173]:
          - generic [ref=e174]: ETB
          - strong [ref=e175]: "632.50"
      - region "Payment Verification" [ref=e176]:
        - generic [ref=e177]: Payment Verification
        - radiogroup "Payment Method" [ref=e178]:
          - radio "Cash" [ref=e179] [cursor=pointer]:
            - generic [ref=e180]: Cash
          - radio "Telebirr" [checked] [ref=e181] [cursor=pointer]:
            - generic [ref=e182]: Telebirr
          - radio "CBE Birr" [ref=e183] [cursor=pointer]:
            - generic [ref=e184]: CBE Birr
        - generic [ref=e185]:
          - generic [ref=e186]:
            - generic [ref=e187]: Reference Number
            - strong [ref=e188]: FT3421189
          - generic [ref=e189]:
            - generic [ref=e190]:
              - generic [ref=e191]: Payment Method
              - strong [ref=e192]: Telebirr
            - generic [ref=e193]:
              - generic [ref=e194]: Reference
              - strong [ref=e195]: FT3421189
            - generic [ref=e196]:
              - generic [ref=e197]: Screenshot
              - strong [ref=e198]: Uploaded
            - generic [ref=e199]:
              - generic [ref=e200]:
                - strong [ref=e201]: Payment screenshot
                - generic [ref=e202]: Aug 3, 12:15 PM
              - button "View Screenshot" [ref=e203] [cursor=pointer]
    - contentinfo [ref=e204]:
      - generic "Checkout total" [ref=e205]:
        - generic [ref=e206]: Total
        - strong [ref=e207]: ETB 632.50
      - button "Verify Payment" [ref=e208] [cursor=pointer]
      - button "Cancel" [ref=e209] [cursor=pointer]
```

# Test source

```ts
  49  |         <div class="cd-checkout-topline">
  50  |           <span>Checkout</span>
  51  |           <button class="cd-drawer-close" aria-label="Close checkout">&times;</button>
  52  |         </div>
  53  |         <div class="cd-checkout-heading">
  54  |           <h2 class="cd-drawer-title" id="cashier-checkout-drawer-title">Service Location 9</h2>
  55  |           <div class="cd-checkout-assignee" aria-label="Waiter: Abdi"><span>Waiter</span><i>•</i><strong>Abdi</strong></div>
  56  |         </div>
  57  |         <span class="cd-checkout-status-badge ${status}" aria-label="Current queue status: ${action}"><i></i>${action}</span>
  58  |       </header>
  59  |       <div class="cd-drawer-body">
  60  |         <section class="cd-checkout-meta" aria-label="Transaction information"><span>Inv 42</span><span>Created 12:03 PM</span><span>${action}</span></section>
  61  |         <div class="cd-checkout-scroll-region">
  62  |           <section class="cd-checkout-items-panel" aria-labelledby="checkout-items-title">
  63  |             <div class="cd-drawer-section-title" id="checkout-items-title">Order Items <span>32</span></div>
  64  |             <div class="cd-drawer-items">${thirtyItems}</div>
  65  |           </section>
  66  |         </div>
  67  |         <section class="cd-drawer-total" aria-label="Bill summary">
  68  |           <span class="cd-bill-summary-label">Bill Summary</span>
  69  |           <div class="cd-checkout-breakdown">
  70  |             <span>Subtotal</span><strong>ETB 520.00</strong>
  71  |             <span>VAT</span><strong>ETB 78.00</strong>
  72  |             <span>Service Charge</span><strong>ETB 52.00</strong>
  73  |             <span>Discount</span><strong>- ETB 17.50</strong>
  74  |           </div>
  75  |           <span class="cd-drawer-total-label">Total</span>
  76  |           <span class="cd-drawer-total-value"><span>ETB</span><strong>632.50</strong></span>
  77  |         </section>
  78  |         ${evidence}
  79  |       </div>
  80  |       <footer class="cd-drawer-footer">
  81  |         <div class="cd-drawer-footer-total" aria-label="Checkout total"><span>Total</span><strong>ETB 632.50</strong></div>
  82  |         <button class="cd-checkout-primary-action">${action === "Completed" ? "View Receipt" : action === "Bill Requested" ? "Print Bill" : action === "Receipt Pending" ? "Print Receipt" : "Verify Payment"}</button>
  83  |         <button class="cd-checkout-secondary-action">${status === "payment-due" ? "Cancel" : "Close"}</button>
  84  |       </footer>
  85  |     </section>
  86  |   `;
  87  | }
  88  | 
  89  | test("checkout slide-over is fixed, single, scrollable, and mode aware", async ({ page }) => {
  90  |   await page.setContent(`
  91  |     <style>${styles}html,body{margin:0}.cd-checkout-slide-over{animation:none!important}</style>
  92  |     <div class="cd-root">
  93  |       <header class="cd-header"></header>
  94  |       <aside class="cd-pos-nav"></aside>
  95  |       <main class="cd-body"><button id="queue-action" class="cd-row-action">Verify Payment</button></main>
  96  |       <aside class="cd-right-panel" aria-label="Service locations">
  97  |         <section class="cd-location-switch"><button class="cd-location-tile payment-due">Quick Switch</button></section>
  98  |       </aside>
  99  |     </div>
  100 |   `);
  101 |   await page.setViewportSize({ width: 1366, height: 768 });
  102 |   const closed = await page.evaluate(() => {
  103 |     const root = document.querySelector<HTMLElement>(".cd-root")!.getBoundingClientRect();
  104 |     const right = document.querySelector<HTMLElement>(".cd-right-panel")!;
  105 |     return {
  106 |       drawerCount: document.querySelectorAll(".cd-checkout-slide-over").length,
  107 |       rightText: right.textContent?.trim(),
  108 |       rightLabel: right.getAttribute("aria-label"),
  109 |       rootWidth: root.width,
  110 |       overflow: document.documentElement.scrollWidth > window.innerWidth,
  111 |     };
  112 |   });
  113 |   expect(closed).toEqual({
  114 |     drawerCount: 0,
  115 |     rightText: "Quick Switch",
  116 |     rightLabel: "Service locations",
  117 |     rootWidth: 1366,
  118 |     overflow: false,
  119 |   });
  120 | 
  121 |   await page.locator(".cd-root").evaluate((root, html) => {
  122 |     root.insertAdjacentHTML("afterend", html);
  123 |   }, drawerFixture("payment-due", "Payment Due"));
  124 |   await page.waitForTimeout(50);
  125 |   const open = await page.evaluate(() => {
  126 |     const root = document.querySelector<HTMLElement>(".cd-root")!.getBoundingClientRect();
  127 |     const drawer = document.querySelector<HTMLElement>(".cd-checkout-slide-over")!;
  128 |     const body = document.querySelector<HTMLElement>(".cd-drawer-body")!;
  129 |     const header = document.querySelector<HTMLElement>(".cd-drawer-header")!.getBoundingClientRect();
  130 |     const footer = document.querySelector<HTMLElement>(".cd-drawer-footer")!.getBoundingClientRect();
  131 |     const close = document.querySelector<HTMLElement>(".cd-drawer-close")!.getBoundingClientRect();
  132 |     const items = document.querySelector<HTMLElement>(".cd-drawer-items")!;
  133 |     body.scrollTop = 400;
  134 |     return {
  135 |       drawerCount: document.querySelectorAll(".cd-checkout-slide-over").length,
  136 |       rootWidth: root.width,
  137 |       drawerLeft: Math.round(drawer.getBoundingClientRect().left),
  138 |       drawerRight: Math.round(drawer.getBoundingClientRect().right),
  139 |       closeTarget: close.width >= 44 && close.height >= 44,
  140 |       headerVisible: header.top >= 0 && header.height > 0,
  141 |       footerVisible: footer.bottom <= window.innerHeight && footer.height > 0,
  142 |       onePrimary: document.querySelectorAll(".cd-checkout-primary-action").length,
  143 |       oneSecondary: document.querySelectorAll(".cd-checkout-secondary-action").length,
  144 |       bodyScrolls: items.scrollHeight > items.clientHeight,
  145 |       pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
  146 |       drawerOverflow: drawer.scrollWidth > drawer.clientWidth,
  147 |     };
  148 |   });
> 149 |   expect(open).toEqual({
      |                ^ Error: expect(received).toEqual(expected) // deep equality
  150 |     drawerCount: 1,
  151 |     rootWidth: 1366,
  152 |     drawerLeft: 792,
  153 |     drawerRight: 1366,
  154 |     closeTarget: true,
  155 |     headerVisible: true,
  156 |     footerVisible: true,
  157 |     onePrimary: 1,
  158 |     oneSecondary: 1,
  159 |     bodyScrolls: true,
  160 |     pageOverflow: false,
  161 |     drawerOverflow: false,
  162 |   });
  163 | 
  164 |   for (const [status, label, primary] of [
  165 |     ["bill-requested", "Bill Requested", "Print Bill"],
  166 |     ["receipt-pending", "Receipt Pending", "Print Receipt"],
  167 |     ["completed", "Completed", "View Receipt"],
  168 |   ] as const) {
  169 |     await page.locator(".cd-checkout-slide-over").evaluate((node, html) => {
  170 |       node.outerHTML = html;
  171 |     }, drawerFixture(status, label));
  172 |     await expect(page.locator(".cd-checkout-status-badge")).toHaveText(label);
  173 |     await expect(page.locator(".cd-checkout-primary-action")).toHaveText(primary);
  174 |   }
  175 | });
  176 | 
  177 | test("screenshot preview opens and closes without exposing upload controls", async ({ page }) => {
  178 |   await page.setContent(`
  179 |     <style>${styles}html,body{margin:0}[hidden]{display:none!important}</style>
  180 |     ${drawerFixture("payment-due", "Payment Due")}
  181 |     <div id="preview" class="cd-screenshot-preview" role="dialog" aria-modal="true" aria-label="Payment screenshot preview" hidden>
  182 |       <header><strong>Payment Screenshot</strong><div><button>Zoom</button><button id="close-preview" aria-label="Close screenshot preview">Close</button></div></header>
  183 |       <div class="cd-screenshot-stage fit"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='%2315803d'/%3E%3C/svg%3E" alt="Payment screenshot"></div>
  184 |     </div>
  185 |     <script>
  186 |       const trigger = document.getElementById("view-shot");
  187 |       const preview = document.getElementById("preview");
  188 |       const close = document.getElementById("close-preview");
  189 |       trigger.addEventListener("click", () => { preview.hidden = false; close.focus(); });
  190 |       close.addEventListener("click", () => { preview.hidden = true; trigger.focus(); });
  191 |       document.addEventListener("keydown", (event) => {
  192 |         if (event.key === "Escape" && !preview.hidden) {
  193 |           preview.hidden = true;
  194 |           trigger.focus();
  195 |         }
  196 |       });
  197 |     </script>
  198 |   `);
  199 |   await page.locator("#view-shot").click();
  200 |   await expect(page.locator("#preview")).toBeVisible();
  201 |   await expect(page.locator("text=Upload Screenshot")).toHaveCount(0);
  202 |   await page.keyboard.press("Escape");
  203 |   await expect(page.locator("#preview")).toBeHidden();
  204 |   await expect(page.locator("#view-shot")).toBeFocused();
  205 | });
  206 | 
```