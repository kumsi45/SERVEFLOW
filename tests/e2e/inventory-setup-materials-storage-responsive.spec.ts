import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const dashboardCss = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventoryDashboard.css"), "utf8");
const setupCss = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventorySetup.css"), "utf8");
const styles = `*{box-sizing:border-box}html,body{margin:0;max-width:100%;background:#f4f7f5}body{padding:10px}${dashboardCss}${setupCss}`;

const material = (name: string, unit: string, status = "active") => `<article class="ia-material-row ${status}"><div><strong>${name}</strong><span>Hospitality supplies with a long category name</span></div><span class="category">Hospitality supplies with a long category name</span><span class="unit">${unit}</span><span class="ia-setup-status ${status}">${status === "active" ? "Active" : "Archived"}</span><div class="ia-setup-actions"><button>Edit</button><details><summary>More</summary><div><button>${status === "active" ? "Archive" : "Restore"}</button></div></details></div></article>`;
const storage = (name: string, description: string, count: number, status = "active") => `<article class="ia-storage-card ${status}"><header><strong>${name}</strong>${status !== "active" ? '<span class="ia-setup-status archived">Archived</span>' : ""}</header>${description ? `<p>${description}</p>` : ""}${count ? `<span>${count} materials</span>` : ""}<footer><button>Edit</button><details><summary>More</summary><div><button>Archive</button></div></details></footer></article>`;

const fixture = `<main><div class="ia-setup-page ia-materials-page"><div class="ia-setup-tools"><label><span>Search materials</span><input placeholder="Search materials"></label><details><summary>Filters</summary><div><label>Category<select><option>All categories</option></select></label><label>Status<select><option>Active</option></select></label></div></details><button>Add Material</button></div><section class="ia-material-list" aria-label="Materials"><div class="ia-material-row header"><span>Material</span><span>Category</span><span>Unit</span><span>Status</span><span>Action</span></div>${material("Coffee", "kg")}${material("Very Long Housekeeping Cleaning Chemical Material Name That Must Wrap", "litres")}${material("Tissue", "box", "archived")}</section></div><hr><div class="ia-setup-page ia-storage-page"><div class="ia-setup-primary-action"><button>Add Storage</button></div><section class="ia-storage-grid" aria-label="Storage locations">${storage("Main Store", "Primary dry-goods storage.", 7)}${storage("Very Long Housekeeping and Guest Supplies Storage Location", "", 0)}${storage("Freezer", "", 2)}${storage("Old Bar Store", "", 0, "archived")}</section></div></main>`;

async function load(page: Page, width: number, height: number, body = fixture) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style>${body}`);
}

const viewports = [[360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1180, 820], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]];
for (const [width, height] of viewports) {
  test(`Materials and Storage fit ${width}x${height}`, async ({ page }) => {
    await load(page, width, height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByPlaceholder("Search materials")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Storage" })).toBeVisible();
    await expect(page.getByText("Very Long Housekeeping Cleaning Chemical Material Name That Must Wrap")).toBeVisible();
    const rows = page.locator(".ia-material-row:not(.header)");
    await expect(rows).toHaveCount(3);
    await expect(page.locator(".ia-material-row.header")).toBeVisible({ visible: width >= 700 });
    const storageCards = page.locator(".ia-storage-card");
    const tops = await storageCards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(tops.filter((top) => top === tops[0])).toHaveLength(width >= 1180 ? 4 : width >= 700 ? 3 : 1);
    for (const button of await page.locator(".ia-setup-page button:visible, .ia-setup-page summary:visible").all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(40);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
    await expect(page.getByText("No description", { exact: true })).toHaveCount(0);
    await expect(page.getByText("0 materials", { exact: true })).toHaveCount(0);
  });
}

for (const [width, height] of [[360, 800], [430, 932], [768, 1024], [1024, 768]]) {
  test(`Material and Storage forms fit ${width}x${height}`, async ({ page }) => {
    const forms = `<div class="ia-modal-backdrop"><section class="ia-modal" role="dialog" aria-label="Add Material"><header><h2>Add Material</h2><button>Close</button></header><form class="ia-form ia-material-form"><label>Material name *<input></label><label>Category<select><option>Food material</option></select></label><label>Unit<select><option>kg</option></select></label><label>Default storage<select><option>Main Store With A Long Name</option></select><span class="ia-form-help">Used as this material's configured storage location.</span></label><label>Minimum stock<input type="number"></label><label>Maximum stock<input type="number"></label><details class="ia-advanced-options ia-material-additional wide"><summary>Additional configuration</summary><div><label>Purchase price<input></label><label>Preferred supplier<select><option>Select supplier (optional)</option></select></label><label>Description<textarea></textarea></label><label>Barcode<input></label></div></details><footer><button>Save Material</button></footer></form></section></div>`;
    await load(page, width, height, forms);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const dialog = page.getByRole("dialog", { name: "Add Material" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(width);
    await expect(page.getByText("Default storage")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Material" })).toBeVisible();

    const storageForm = `<div class="ia-modal-backdrop"><section class="ia-modal" role="dialog" aria-label="Add Storage"><header><h2>Add Storage</h2><button>Close</button></header><form class="ia-form ia-storage-form"><label>Storage name<input value="Very Long Guest Supplies and Housekeeping Storage Name"></label><label class="wide">Description<textarea></textarea></label><footer><button>Save Storage</button></footer></form></section></div>`;
    await load(page, width, height, storageForm);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole("dialog", { name: "Add Storage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Storage" })).toBeVisible();
  });
}
