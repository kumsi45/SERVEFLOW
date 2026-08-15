import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerRecipeWorkspace.css"), "utf8");

const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}html,body{margin:0}</style></head><body class="mrw-page">
  <div class="mrw-layer"><aside class="mrw-drawer"><header><div><span>Recipe detail</span><h2>Chicken Platter</h2></div><button>×</button></header>
    <div class="mrw-editor">
      <section class="mrw-current"><div><span>Category</span><strong>Main Course</strong></div><div><span>Kitchen / station</span><strong>Grill</strong></div><div><span>Recipe status</span><strong>Active</strong></div><div><span>Last updated</span><strong>Today</strong></div></section>
      <label>Recipe name<input value="Chicken Platter"></label>
      <section class="mrw-ingredients"><header><div><span>Expected consumption per serving</span><h3>Ingredients</h3></div><button class="mrw-add-trigger">+ Add Ingredient</button></header>
        <div class="mrw-ingredient-head"><span>Ingredient</span><span>Quantity</span><span>Unit</span><span>Inventory Link</span><span>Actions</span></div>
        <div class="mrw-ingredient"><strong>Extra Long Inventory Ingredient Name</strong><span>150.000</span><span>Grams</span><em class="mrw-badge linked">Linked</em><div class="mrw-ingredient-actions"><button>Edit</button><button>Remove</button></div><small>150 grams per serving</small></div>
        <div class="mrw-ingredient-form"><header><strong>Edit ingredient</strong><button>×</button></header><label>Search Inventory<input value="Chicken"></label><div class="mrw-inventory-selected" data-selected-inventory-item-id="item-chicken"><span>Selected inventory item</span><strong>Chicken Breast</strong></div><div class="mrw-inventory-results"><button class="mrw-inventory-result" data-inventory-item-id="item-chicken"><span><strong>Chicken Breast</strong><small>Inventory ingredient</small></span><small>Available: 12 kg</small></button></div><div class="mrw-ingredient-fields"><label>Quantity<input value="150"></label><label>Unit<select><option>Grams</option></select></label></div><footer><button>Cancel</button><button>Update Ingredient</button></footer></div>
      </section>
      <section class="mrw-review"><strong>Review before saving</strong><span>Chicken Platter</span><span>20 minutes</span><span>1 ingredient</span><span>Activate</span></section>
    </div><footer><button>Cancel</button><button>Save Changes</button></footer>
  </aside></div></body></html>`;

test("recipe ingredient drawer stays usable without horizontal overflow", async ({ page }) => {
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 740 });
    await page.setContent(fixture);
    const layout = await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>(".mrw-drawer")!;
      const editor = document.querySelector<HTMLElement>(".mrw-editor")!;
      const footer = document.querySelector<HTMLElement>(".mrw-drawer>footer")!;
      const layer = document.querySelector<HTMLElement>(".mrw-layer")!;
      const ingredients = document.querySelector<HTMLElement>(".mrw-ingredients")!;
      const review = document.querySelector<HTMLElement>(".mrw-review")!;
      const actions = [...document.querySelectorAll<HTMLElement>(".mrw-ingredient-actions button")];
      const fields = document.querySelector<HTMLElement>(".mrw-ingredient-fields")!;
      const drawerRight = drawer.getBoundingClientRect().right;
      return {
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        drawerOverflow: drawer.scrollWidth > drawer.clientWidth,
        editorOverflowY: getComputedStyle(editor).overflowY,
        ingredientOverflow: getComputedStyle(ingredients).overflow,
        layerOverflowY: getComputedStyle(layer).overflowY,
        footerPosition: getComputedStyle(footer).position,
        actionMinHeight: Math.min(...actions.map((button) => button.getBoundingClientRect().height)),
        fieldColumns: getComputedStyle(fields).gridTemplateColumns.split(" ").length,
        ingredientDisplay: getComputedStyle(ingredients).display,
        ingredientHeight: ingredients.getBoundingClientRect().height,
        ingredientBeforeReview: ingredients.getBoundingClientRect().bottom <= review.getBoundingClientRect().top,
        addActionCount: [...ingredients.querySelectorAll("button")].filter((button) => button.textContent?.trim() === "+ Add Ingredient").length,
        resultVisible: Boolean(document.querySelector('[data-inventory-item-id="item-chicken"]')),
        overflowers: [...drawer.querySelectorAll<HTMLElement>("*")].filter((element) => element.getBoundingClientRect().right > drawerRight + 1).map((element) => `${element.tagName}.${element.className}:${Math.round(element.getBoundingClientRect().right - drawerRight)}`),
      };
    });
    expect(layout.pageOverflow, `${width}px page overflow`).toBe(false);
    expect(layout.drawerOverflow, `${width}px drawer overflow: ${layout.overflowers.join(", ")}`).toBe(false);
    expect(layout.ingredientDisplay).not.toBe("none");
    expect(layout.ingredientHeight, `${width}px ingredient section collapsed`).toBeGreaterThan(180);
    expect(layout.ingredientBeforeReview, `${width}px ingredient section overlaps review`).toBe(true);
    expect(layout.addActionCount).toBe(1);
    expect(layout.resultVisible).toBe(true);
    if (width <= 767) {
      expect(layout.editorOverflowY).toBe("visible");
      expect(layout.ingredientOverflow).toBe("visible");
      expect(layout.layerOverflowY).toBe("auto");
      expect(layout.footerPosition).toBe("relative");
      expect(layout.actionMinHeight).toBeGreaterThanOrEqual(42);
      expect(layout.fieldColumns).toBe(1);
    } else {
      expect(layout.editorOverflowY).toBe("auto");
    }
  }
});
