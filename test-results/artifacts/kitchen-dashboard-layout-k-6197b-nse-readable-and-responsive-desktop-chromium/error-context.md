# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: kitchen-dashboard-layout.spec.ts >> kitchen cards stay dense, readable, and responsive
- Location: tests\e2e\kitchen-dashboard-layout.spec.ts:31:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 3
Received: 4
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: S
      - generic [ref=e6]:
        - generic [ref=e7]: ServeFlow
        - generic [ref=e8]: Kitchen - Beverages
    - textbox "Search orders" [ref=e10]
    - generic [ref=e11]: 4 Active
  - generic [ref=e13]:
    - generic [ref=e14]:
      - generic [ref=e15]: Service
      - button "All" [ref=e16] [cursor=pointer]
      - button "Dine-in" [ref=e17] [cursor=pointer]
      - button "Takeaway" [ref=e18] [cursor=pointer]
      - button "Delivery" [ref=e19] [cursor=pointer]
    - generic [ref=e20]:
      - generic [ref=e21]: State
      - button "All" [ref=e22] [cursor=pointer]
      - button "New" [ref=e23] [cursor=pointer]
      - button "Preparing" [ref=e24] [cursor=pointer]
      - button "Ready" [ref=e25] [cursor=pointer]
    - 'button "Sort: Oldest First" [ref=e27] [cursor=pointer]': "Sort: Oldest First"
  - main [ref=e29]:
    - generic [ref=e30]:
      - article [ref=e31]:
        - generic [ref=e32]:
          - generic [ref=e33]:
            - heading "Table 1" [level=2] [ref=e34]
            - generic [ref=e35]: accepted
          - generic [ref=e36]: ◷4m
        - generic [ref=e37]:
          - generic [ref=e38]: Dine-in
          - generic [ref=e39]: Waiter Abdi
          - time [ref=e40]: 10:02
        - generic [ref=e41]:
          - generic [ref=e42]:
            - generic [ref=e43]:
              - strong [ref=e44]: 2x
              - generic [ref=e45]: Mango Juice
            - generic [ref=e46]:
              - strong [ref=e47]: "Instruction:"
              - text: No sugar
          - generic [ref=e49]:
            - strong [ref=e50]: 1x
            - generic [ref=e51]: Macchiato
        - button "Context action" [ref=e53] [cursor=pointer]
      - article [ref=e54]:
        - generic [ref=e55]:
          - generic [ref=e56]:
            - heading "Table 2" [level=2] [ref=e57]
            - generic [ref=e58]: preparing
          - generic [ref=e59]: ◷5m
        - generic [ref=e60]:
          - generic [ref=e61]: Dine-in
          - generic [ref=e62]: Waiter Abdi
          - time [ref=e63]: 10:02
        - generic [ref=e64]:
          - generic [ref=e66]:
            - strong [ref=e67]: 2x
            - generic [ref=e68]: Mango Juice
          - generic [ref=e70]:
            - strong [ref=e71]: 1x
            - generic [ref=e72]: Macchiato
        - button "Context action" [ref=e74] [cursor=pointer]
      - article [ref=e75]:
        - generic [ref=e76]:
          - generic [ref=e77]:
            - heading "Table 3" [level=2] [ref=e78]
            - generic [ref=e79]: ready
          - generic [ref=e80]: ◷6m
        - generic [ref=e81]:
          - generic [ref=e82]: Dine-in
          - generic [ref=e83]: Waiter Abdi
          - time [ref=e84]: 10:02
        - generic [ref=e85]:
          - generic [ref=e87]:
            - strong [ref=e88]: 2x
            - generic [ref=e89]: Mango Juice
          - generic [ref=e91]:
            - strong [ref=e92]: 1x
            - generic [ref=e93]: Macchiato
        - button "Context action" [ref=e95] [cursor=pointer]
      - article [ref=e96]:
        - generic [ref=e97]:
          - generic [ref=e98]:
            - heading "Table 4" [level=2] [ref=e99]
            - generic [ref=e100]: accepted
          - generic [ref=e101]: ◷7m
        - generic [ref=e102]:
          - generic [ref=e103]: Dine-in
          - generic [ref=e104]: Waiter Abdi
          - time [ref=e105]: 10:02
        - generic [ref=e106]:
          - generic [ref=e108]:
            - strong [ref=e109]: 2x
            - generic [ref=e110]: Mango Juice
          - generic [ref=e112]:
            - strong [ref=e113]: 1x
            - generic [ref=e114]: Macchiato
        - button "Context action" [ref=e116] [cursor=pointer]
```

# Test source

```ts
  1  | import { readFileSync } from "node:fs";
  2  | import { resolve } from "node:path";
  3  | import { expect, test } from "@playwright/test";
  4  | 
  5  | const styles = readFileSync(
  6  |   resolve(process.cwd(), "src/modules/kitchen/styles/kitchenDashboard.css"),
  7  |   "utf8",
  8  | );
  9  | 
  10 | const cards = ["accepted", "preparing", "ready", "accepted"]
  11 |   .map(
  12 |     (state, index) => `
  13 |       <article class="kd-order-card status-${state}">
  14 |         <header class="kd-card-header">
  15 |           <div class="kd-card-title"><h2>Table ${index + 1}</h2><span class="kd-state-badge ${state}">${state}</span></div>
  16 |           <span class="kd-card-timer kd-timer-normal">${index + 4}m</span>
  17 |         </header>
  18 |         <div class="kd-card-context"><span class="kd-service-badge dine-in">Dine-in</span><span class="kd-card-source">Waiter Abdi</span><time>10:02</time></div>
  19 |         <div class="kd-card-items">
  20 |           <div class="kd-card-item">
  21 |             <div class="kd-card-item-main"><strong>2x</strong><span>Mango Juice</span></div>
  22 |             ${index === 0 ? '<div class="kd-card-instruction"><strong>Instruction:</strong> No sugar</div>' : ""}
  23 |           </div>
  24 |           <div class="kd-card-item"><div class="kd-card-item-main"><strong>1x</strong><span>Macchiato</span></div></div>
  25 |         </div>
  26 |         <footer class="kd-card-action"><button class="kd-context-action ${state}">Context action</button></footer>
  27 |       </article>`,
  28 |   )
  29 |   .join("");
  30 | 
  31 | test("kitchen cards stay dense, readable, and responsive", async ({ page }) => {
  32 |   await page.setContent(`
  33 |     <meta name="viewport" content="width=device-width, initial-scale=1">
  34 |     <style>${styles}</style>
  35 |     <div class="kd-root">
  36 |       <header class="kd-header"><div class="kd-header-logo-area"><div class="kd-logo-mark">S</div><div><div class="kd-restaurant-name">ServeFlow</div><div class="kd-kitchen-label">Kitchen - Beverages</div></div></div><div class="kd-header-search"><input aria-label="Search orders"></div><div class="kd-active-badge"><span></span>4 Active</div></header>
  37 |       <div class="kd-filter-bar"><div class="kd-filter-group"><span class="kd-filter-label">Service</span><button class="kd-filter-btn active">All</button><button class="kd-filter-btn">Dine-in</button><button class="kd-filter-btn">Takeaway</button><button class="kd-filter-btn">Delivery</button></div><div class="kd-filter-group kd-state-filters"><span class="kd-filter-label">State</span><button class="kd-filter-btn active">All</button><button class="kd-filter-btn">New</button><button class="kd-filter-btn">Preparing</button><button class="kd-filter-btn">Ready</button></div><div class="kd-sort-control"><button class="kd-sort-trigger" aria-haspopup="menu" aria-expanded="false">Sort: Oldest First <span class="kd-sort-chevron"></span></button></div></div>
  38 |       <main class="kd-order-workspace"><div class="kd-order-grid">${cards}</div></main>
  39 |     </div>
  40 |   `);
  41 | 
  42 |   const expectedColumns = [
  43 |     { width: 1920, height: 1080, columns: 4 },
  44 |     { width: 1440, height: 900, columns: 4 },
  45 |     { width: 1366, height: 768, columns: 3 },
  46 |     { width: 1100, height: 800, columns: 3 },
  47 |     { width: 800, height: 900, columns: 2 },
  48 |     { width: 390, height: 844, columns: 1 },
  49 |   ];
  50 | 
  51 |   for (const viewport of expectedColumns) {
  52 |     await page.setViewportSize(viewport);
  53 |     const geometry = await page.evaluate(() => {
  54 |       const cards = [...document.querySelectorAll<HTMLElement>(".kd-order-card")];
  55 |       const firstTop = cards[0].getBoundingClientRect().top;
  56 |       const firstRowCount = cards.filter(
  57 |         (card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2,
  58 |       ).length;
  59 |       const firstCard = cards[0].getBoundingClientRect();
  60 |       const action = cards[0].querySelector<HTMLElement>(".kd-context-action")!.getBoundingClientRect();
  61 |       const instruction = cards[0].querySelector<HTMLElement>(".kd-card-instruction")!;
  62 |       return {
  63 |         firstRowCount,
  64 |         bodyOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  65 |         cardWidth: firstCard.width,
  66 |         actionWidth: action.width,
  67 |         instructionColor: getComputedStyle(instruction).color,
  68 |         instructionBackground: getComputedStyle(instruction).backgroundColor,
  69 |       };
  70 |     });
  71 | 
> 72 |     expect(geometry.firstRowCount).toBe(viewport.columns);
     |                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  73 |     expect(geometry.bodyOverflow).toBe(false);
  74 |     expect(geometry.cardWidth).toBeGreaterThan(280);
  75 |     expect(geometry.actionWidth).toBeGreaterThan(geometry.cardWidth - 30);
  76 |     expect(geometry.instructionColor).not.toBe(geometry.instructionBackground);
  77 |   }
  78 | });
  79 | 
```