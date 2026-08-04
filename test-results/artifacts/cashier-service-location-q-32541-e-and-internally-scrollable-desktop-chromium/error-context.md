# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cashier-service-location-quick-switch.spec.ts >> service-location quick switch remains readable and internally scrollable
- Location: tests\e2e\cashier-service-location-quick-switch.spec.ts:10:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]
  - complementary [ref=e4]
  - main [ref=e5]
  - complementary "Service locations" [ref=e6]:
    - listbox [ref=e8]:
      - option "Table 1, Payment due" [ref=e9] [cursor=pointer]:
        - strong [ref=e10]: Table 1
        - generic [ref=e13]: Due
      - option "Table 2, Bill requested" [selected] [ref=e14] [cursor=pointer]:
        - strong [ref=e15]: Table 2
        - generic [ref=e18]: Bill
        - generic [ref=e19]: ✓
      - option "Table 3, Receipt pending" [ref=e20] [cursor=pointer]:
        - strong [ref=e21]: Table 3
        - generic [ref=e24]: Receipt
      - option "Table 4, Available" [ref=e25] [cursor=pointer]:
        - strong [ref=e26]: Table 4
        - generic [ref=e29]: Free
      - option "Table 5, Available" [ref=e30] [cursor=pointer]:
        - strong [ref=e31]: Table 5
        - generic [ref=e34]: Free
      - option "Table 6, Occupied" [ref=e35] [cursor=pointer]:
        - strong [ref=e36]: Table 6
        - generic [ref=e39]: Busy
      - option "Table 7, Available" [ref=e40] [cursor=pointer]:
        - strong [ref=e41]: Table 7
        - generic [ref=e44]: Free
      - option "Table 8, Available" [ref=e45] [cursor=pointer]:
        - strong [ref=e46]: Table 8
        - generic [ref=e49]: Free
      - option "Table 9, Occupied" [ref=e50] [cursor=pointer]:
        - strong [ref=e51]: Table 9
        - generic [ref=e54]: Busy
      - option "Table 10, Available" [ref=e55] [cursor=pointer]:
        - strong [ref=e56]: Table 10
        - generic [ref=e59]: Free
      - option "Table 11, Available" [ref=e60] [cursor=pointer]:
        - strong [ref=e61]: Table 11
        - generic [ref=e64]: Free
      - option "Table 12, Occupied" [ref=e65] [cursor=pointer]:
        - strong [ref=e66]: Table 12
        - generic [ref=e69]: Busy
      - option "Table 13, Available" [ref=e70] [cursor=pointer]:
        - strong [ref=e71]: Table 13
        - generic [ref=e74]: Free
      - option "Table 14, Available" [ref=e75] [cursor=pointer]:
        - strong [ref=e76]: Table 14
        - generic [ref=e79]: Free
      - option "Table 15, Occupied" [ref=e80] [cursor=pointer]:
        - strong [ref=e81]: Table 15
        - generic [ref=e84]: Busy
      - option "Table 16, Available" [ref=e85] [cursor=pointer]:
        - strong [ref=e86]: Table 16
        - generic [ref=e89]: Free
      - option "Table 17, Available" [ref=e90] [cursor=pointer]:
        - strong [ref=e91]: Table 17
        - generic [ref=e94]: Free
      - option "Table 18, Occupied" [ref=e95] [cursor=pointer]:
        - strong [ref=e96]: Table 18
        - generic [ref=e99]: Busy
      - option "Table 19, Available" [ref=e100] [cursor=pointer]:
        - strong [ref=e101]: Table 19
        - generic [ref=e104]: Free
      - option "Table 20, Available" [ref=e105] [cursor=pointer]:
        - strong [ref=e106]: Table 20
        - generic [ref=e109]: Free
      - option "Table 21, Occupied" [ref=e110] [cursor=pointer]:
        - strong [ref=e111]: Table 21
        - generic [ref=e114]: Busy
      - option "Table 22, Available" [ref=e115] [cursor=pointer]:
        - strong [ref=e116]: Table 22
        - generic [ref=e119]: Free
      - option "Table 23, Available" [ref=e120] [cursor=pointer]:
        - strong [ref=e121]: Table 23
        - generic [ref=e124]: Free
      - option "Table 24, Occupied" [ref=e125] [cursor=pointer]:
        - strong [ref=e126]: Table 24
        - generic [ref=e129]: Busy
      - option "Table 25, Available" [ref=e130] [cursor=pointer]:
        - strong [ref=e131]: Table 25
        - generic [ref=e134]: Free
      - option "Table 26, Available" [ref=e135] [cursor=pointer]:
        - strong [ref=e136]: Table 26
        - generic [ref=e139]: Free
      - option "Table 27, Occupied" [ref=e140] [cursor=pointer]:
        - strong [ref=e141]: Table 27
        - generic [ref=e144]: Busy
      - option "Table 28, Available" [ref=e145] [cursor=pointer]:
        - strong [ref=e146]: Table 28
        - generic [ref=e149]: Free
      - option "Table 29, Available" [ref=e150] [cursor=pointer]:
        - strong [ref=e151]: Table 29
        - generic [ref=e154]: Free
      - option "Table 30, Occupied" [ref=e155] [cursor=pointer]:
        - strong [ref=e156]: Table 30
        - generic [ref=e159]: Busy
      - option "Table 31, Available" [ref=e160] [cursor=pointer]:
        - strong [ref=e161]: Table 31
        - generic [ref=e164]: Free
      - option "Table 32, Available" [ref=e165] [cursor=pointer]:
        - strong [ref=e166]: Table 32
        - generic [ref=e169]: Free
      - option "Table 33, Occupied" [ref=e170] [cursor=pointer]:
        - strong [ref=e171]: Table 33
        - generic [ref=e174]: Busy
      - option "Table 34, Available" [ref=e175] [cursor=pointer]:
        - strong [ref=e176]: Table 34
        - generic [ref=e179]: Free
      - option "Table 35, Available" [ref=e180] [cursor=pointer]:
        - strong [ref=e181]: Table 35
        - generic [ref=e184]: Free
      - option "Table 36, Occupied" [ref=e185] [cursor=pointer]:
        - strong [ref=e186]: Table 36
        - generic [ref=e189]: Busy
      - option "Table 37, Available" [ref=e190] [cursor=pointer]:
        - strong [ref=e191]: Table 37
        - generic [ref=e194]: Free
      - option "Table 38, Available" [ref=e195] [cursor=pointer]:
        - strong [ref=e196]: Table 38
        - generic [ref=e199]: Free
      - option "Table 39, Occupied" [ref=e200] [cursor=pointer]:
        - strong [ref=e201]: Table 39
        - generic [ref=e204]: Busy
      - option "Table 40, Available" [ref=e205] [cursor=pointer]:
        - strong [ref=e206]: Table 40
        - generic [ref=e209]: Free
      - option "Table 41, Available" [ref=e210] [cursor=pointer]:
        - strong [ref=e211]: Table 41
        - generic [ref=e214]: Free
      - option "Table 42, Occupied" [ref=e215] [cursor=pointer]:
        - strong [ref=e216]: Table 42
        - generic [ref=e219]: Busy
      - option "Table 43, Available" [ref=e220] [cursor=pointer]:
        - strong [ref=e221]: Table 43
        - generic [ref=e224]: Free
      - option "Table 44, Available" [ref=e225] [cursor=pointer]:
        - strong [ref=e226]: Table 44
        - generic [ref=e229]: Free
      - option "Table 45, Occupied" [ref=e230] [cursor=pointer]:
        - strong [ref=e231]: Table 45
        - generic [ref=e234]: Busy
      - option "Table 46, Available" [ref=e235] [cursor=pointer]:
        - strong [ref=e236]: Table 46
        - generic [ref=e239]: Free
      - option "Table 47, Available" [ref=e240] [cursor=pointer]:
        - strong [ref=e241]: Table 47
        - generic [ref=e244]: Free
      - option "Table 48, Occupied" [ref=e245] [cursor=pointer]:
        - strong [ref=e246]: Table 48
        - generic [ref=e249]: Busy
      - option "Table 49, Available" [ref=e250] [cursor=pointer]:
        - strong [ref=e251]: Table 49
        - generic [ref=e254]: Free
      - option "Table 50, Available" [ref=e255] [cursor=pointer]:
        - strong [ref=e256]: Table 50
        - generic [ref=e259]: Free
      - option "Table 51, Occupied" [ref=e260] [cursor=pointer]:
        - strong [ref=e261]: Table 51
        - generic [ref=e264]: Busy
      - option "Table 52, Available" [ref=e265] [cursor=pointer]:
        - strong [ref=e266]: Table 52
        - generic [ref=e269]: Free
      - option "Table 53, Available" [ref=e270] [cursor=pointer]:
        - strong [ref=e271]: Table 53
        - generic [ref=e274]: Free
      - option "Table 54, Occupied" [ref=e275] [cursor=pointer]:
        - strong [ref=e276]: Table 54
        - generic [ref=e279]: Busy
      - option "Table 55, Available" [ref=e280] [cursor=pointer]:
        - strong [ref=e281]: Table 55
        - generic [ref=e284]: Free
      - option "Table 56, Available" [ref=e285] [cursor=pointer]:
        - strong [ref=e286]: Table 56
        - generic [ref=e289]: Free
      - option "Table 57, Occupied" [ref=e290] [cursor=pointer]:
        - strong [ref=e291]: Table 57
        - generic [ref=e294]: Busy
      - option "Table 58, Available" [ref=e295] [cursor=pointer]:
        - strong [ref=e296]: Table 58
        - generic [ref=e299]: Free
      - option "Table 59, Available" [ref=e300] [cursor=pointer]:
        - strong [ref=e301]: Table 59
        - generic [ref=e304]: Free
      - option "Table 60, Occupied" [ref=e305] [cursor=pointer]:
        - strong [ref=e306]: Table 60
        - generic [ref=e309]: Busy
      - option "Table 61, Available" [ref=e310] [cursor=pointer]:
        - strong [ref=e311]: Table 61
        - generic [ref=e314]: Free
      - option "Table 62, Available" [ref=e315] [cursor=pointer]:
        - strong [ref=e316]: Table 62
        - generic [ref=e319]: Free
      - option "Table 63, Occupied" [ref=e320] [cursor=pointer]:
        - strong [ref=e321]: Table 63
        - generic [ref=e324]: Busy
      - option "Table 64, Available" [ref=e325] [cursor=pointer]:
        - strong [ref=e326]: Table 64
        - generic [ref=e329]: Free
      - option "Table 65, Available" [ref=e330] [cursor=pointer]:
        - strong [ref=e331]: Table 65
        - generic [ref=e334]: Free
      - option "Table 66, Occupied" [ref=e335] [cursor=pointer]:
        - strong [ref=e336]: Table 66
        - generic [ref=e339]: Busy
      - option "Table 67, Available" [ref=e340] [cursor=pointer]:
        - strong [ref=e341]: Table 67
        - generic [ref=e344]: Free
      - option "Table 68, Available" [ref=e345] [cursor=pointer]:
        - strong [ref=e346]: Table 68
        - generic [ref=e349]: Free
      - option "Table 69, Occupied" [ref=e350] [cursor=pointer]:
        - strong [ref=e351]: Table 69
        - generic [ref=e354]: Busy
      - option "Table 70, Available" [ref=e355] [cursor=pointer]:
        - strong [ref=e356]: Table 70
        - generic [ref=e359]: Free
      - option "Table 71, Available" [ref=e360] [cursor=pointer]:
        - strong [ref=e361]: Table 71
        - generic [ref=e364]: Free
      - option "Table 72, Occupied" [ref=e365] [cursor=pointer]:
        - strong [ref=e366]: Table 72
        - generic [ref=e369]: Busy
      - option "Table 73, Available" [ref=e370] [cursor=pointer]:
        - strong [ref=e371]: Table 73
        - generic [ref=e374]: Free
      - option "Table 74, Available" [ref=e375] [cursor=pointer]:
        - strong [ref=e376]: Table 74
        - generic [ref=e379]: Free
      - option "Table 75, Occupied" [ref=e380] [cursor=pointer]:
        - strong [ref=e381]: Table 75
        - generic [ref=e384]: Busy
      - option "Table 76, Available" [ref=e385] [cursor=pointer]:
        - strong [ref=e386]: Table 76
        - generic [ref=e389]: Free
      - option "Table 77, Available" [ref=e390] [cursor=pointer]:
        - strong [ref=e391]: Table 77
        - generic [ref=e394]: Free
      - option "Table 78, Occupied" [ref=e395] [cursor=pointer]:
        - strong [ref=e396]: Table 78
        - generic [ref=e399]: Busy
      - option "Table 79, Available" [ref=e400] [cursor=pointer]:
        - strong [ref=e401]: Table 79
        - generic [ref=e404]: Free
      - option "Table 80, Available" [ref=e405] [cursor=pointer]:
        - strong [ref=e406]: Table 80
        - generic [ref=e409]: Free
      - option "Table 81, Occupied" [ref=e410] [cursor=pointer]:
        - strong [ref=e411]: Table 81
        - generic [ref=e414]: Busy
      - option "Table 82, Available" [ref=e415] [cursor=pointer]:
        - strong [ref=e416]: Table 82
        - generic [ref=e419]: Free
      - option "Table 83, Available" [ref=e420] [cursor=pointer]:
        - strong [ref=e421]: Table 83
        - generic [ref=e424]: Free
      - option "Table 84, Occupied" [ref=e425] [cursor=pointer]:
        - strong [ref=e426]: Table 84
        - generic [ref=e429]: Busy
      - option "Table 85, Available" [ref=e430] [cursor=pointer]:
        - strong [ref=e431]: Table 85
        - generic [ref=e434]: Free
      - option "Table 86, Available" [ref=e435] [cursor=pointer]:
        - strong [ref=e436]: Table 86
        - generic [ref=e439]: Free
      - option "Table 87, Occupied" [ref=e440] [cursor=pointer]:
        - strong [ref=e441]: Table 87
        - generic [ref=e444]: Busy
      - option "Table 88, Available" [ref=e445] [cursor=pointer]:
        - strong [ref=e446]: Table 88
        - generic [ref=e449]: Free
      - option "Table 89, Available" [ref=e450] [cursor=pointer]:
        - strong [ref=e451]: Table 89
        - generic [ref=e454]: Free
      - option "Table 90, Occupied" [ref=e455] [cursor=pointer]:
        - strong [ref=e456]: Table 90
        - generic [ref=e459]: Busy
```

# Test source

```ts
  1   | import { readFileSync } from "node:fs";
  2   | import { resolve } from "node:path";
  3   | import { expect, test } from "@playwright/test";
  4   | 
  5   | const styles = readFileSync(
  6   |   resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"),
  7   |   "utf8",
  8   | );
  9   | 
  10  | test("service-location quick switch remains readable and internally scrollable", async ({ page }) => {
  11  |   const cards = Array.from({ length: 90 }, (_, index) => {
  12  |     const number = index + 1;
  13  |     const status = number === 1
  14  |       ? "payment-due"
  15  |       : number === 2
  16  |         ? "bill-requested"
  17  |         : number === 3
  18  |           ? "receipt-pending"
  19  |           : number % 3 === 0
  20  |             ? "occupied"
  21  |             : "available";
  22  |     const label = status === "payment-due"
  23  |       ? "Payment due"
  24  |       : status === "bill-requested"
  25  |         ? "Bill requested"
  26  |         : status === "receipt-pending"
  27  |           ? "Receipt pending"
  28  |           : status === "occupied"
  29  |             ? "Occupied"
  30  |             : "Available";
  31  |     return `
  32  |       <button id="cashier-location-${number}" type="button" role="option"
  33  |         class="cd-location-tile ${status}${number === 2 ? " selected" : ""}"
  34  |         aria-selected="${number === 2}" aria-label="Table ${number}, ${label}">
  35  |         <strong>Table ${number}</strong>
  36  |         <span class="cd-location-status"><i></i><span>${status === "available" ? "Free" : status === "occupied" ? "Busy" : status === "payment-due" ? "Due" : status === "bill-requested" ? "Bill" : "Receipt"}</span></span>
  37  |         ${number === 1 ? "<small>ETB 1,250</small>" : ""}
  38  |         ${number === 2 ? "<span class=\"cd-location-selected-icon\">✓</span>" : ""}
  39  |       </button>`;
  40  |   }).join("");
  41  | 
  42  |   await page.setContent(`
  43  |     <style>${styles}html,body{margin:0}.cd-root{height:100vh!important;min-height:0!important}.cd-right-panel{height:calc(100vh - 70px)!important}.cd-location-switch{height:100%!important;grid-template-rows:minmax(0,1fr)!important}.cd-location-grid{height:100%!important;max-height:100%!important}</style>
  44  |     <div class="cd-root">
  45  |       <header class="cd-header"></header>
  46  |       <aside class="cd-pos-nav"></aside>
  47  |       <main class="cd-body"></main>
  48  |       <aside class="cd-right-panel" aria-label="Service locations">
  49  |         <section class="cd-location-switch">
  50  |           <div class="cd-location-grid" role="listbox">${cards}</div>
  51  |         </section>
  52  |       </aside>
  53  |     </div>
  54  |     <script>
  55  |       document.querySelectorAll('.cd-location-tile').forEach((tile) => {
  56  |         tile.addEventListener('click', () => {
  57  |           document.querySelectorAll('.cd-location-tile').forEach((candidate) => {
  58  |             candidate.classList.remove('selected');
  59  |             candidate.setAttribute('aria-selected', 'false');
  60  |           });
  61  |           tile.classList.add('selected');
  62  |           tile.setAttribute('aria-selected', 'true');
  63  |         });
  64  |       });
  65  |     </script>
  66  |   `);
  67  | 
  68  |   for (const viewport of [
  69  |     { width: 1366, height: 768, columns: 6 },
  70  |     { width: 1440, height: 900, columns: 6 },
  71  |     { width: 1920, height: 1080, columns: 6 },
  72  |   ]) {
  73  |     await page.setViewportSize(viewport);
  74  |     const geometry = await page.evaluate(() => {
  75  |       const select = (selector: string) => document.querySelector<HTMLElement>(selector)!;
  76  |       const grid = select(".cd-location-grid");
  77  |       const panel = select(".cd-location-switch").getBoundingClientRect();
  78  |       const right = select(".cd-right-panel").getBoundingClientRect();
  79  |       const cards = [...document.querySelectorAll<HTMLElement>(".cd-location-tile")];
  80  |       const first = cards[0].getBoundingClientRect();
  81  |       const selected = select(".cd-location-tile.selected");
  82  |       const selectedStyle = getComputedStyle(selected);
  83  |       grid.scrollTop = grid.scrollHeight;
  84  |       return {
  85  |         horizontalOverflow: grid.scrollWidth > grid.clientWidth,
  86  |         verticallyScrollable: grid.scrollHeight > grid.clientHeight,
  87  |         columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
  88  |         touchHeight: first.height,
  89  |         cardsInsidePanel: cards.every((card) => card.getBoundingClientRect().right <= panel.right),
  90  |         noCheckoutReservation: document.querySelectorAll(".cd-drawer").length === 0,
  91  |         switchFillsRightColumn: Math.abs(panel.height - right.height) <= 2,
  92  |         selectedOutline: selectedStyle.outlineWidth,
  93  |         gridStartsAtPanelTop: Math.abs(grid.getBoundingClientRect().top - panel.top) <= 12,
  94  |       };
  95  |     });
  96  |     expect(geometry.horizontalOverflow).toBe(false);
> 97  |     expect(geometry.verticallyScrollable).toBe(true);
      |                                           ^ Error: expect(received).toBe(expected) // Object.is equality
  98  |     expect(geometry.columns).toBe(viewport.columns);
  99  |     expect(geometry.touchHeight).toBeGreaterThanOrEqual(56);
  100 |     expect(geometry.cardsInsidePanel).toBe(true);
  101 |     expect(geometry.noCheckoutReservation).toBe(true);
  102 |     expect(geometry.switchFillsRightColumn).toBe(true);
  103 |     expect(geometry.selectedOutline).toBe("2px");
  104 |     expect(geometry.gridStartsAtPanelTop).toBe(true);
  105 |   }
  106 | 
  107 |   const thirdCard = page.locator("#cashier-location-3");
  108 |   await thirdCard.focus();
  109 |   await page.keyboard.press("Enter");
  110 |   await expect(thirdCard).toHaveAttribute("aria-selected", "true");
  111 |   await expect(thirdCard).toHaveClass(/selected/);
  112 | });
  113 | 
```