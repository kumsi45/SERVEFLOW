import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const poStyles = readFileSync(resolve(process.cwd(), "src/modules/purchasing/styles/purchaseOrderDrafts.css"), "utf8");
const supplierStyles = readFileSync(resolve(process.cwd(), "src/modules/inventory/styles/inventorySuppliers.css"), "utf8");
const styles = `*{box-sizing:border-box}html,body{margin:0;max-width:100%;background:#f4f7f5}body{padding:8px}${poStyles}${supplierStyles}`;
const purchaseCard = (status: "draft" | "partially_received" | "completed", index: number) => `<article class="po-order-card ${status}"><header><div><strong>${index === 1 ? "A Very Long Hospitality Materials Supplier Business Name" : `Supplier ${index}`}</strong><span>PO 1234567${index}</span></div><b>${status === "draft" ? "Open" : status === "partially_received" ? "Partially Received" : "Completed"}</b></header>${status === "completed" ? '<div class="po-complete-summary"><span>Completed · Aug 23</span><strong>3 materials received</strong><span>Total 1,200.00</span></div>' : '<div class="po-active-summary"><div><span>Materials</span><strong>3</strong></div><div><span>Received value</span><strong>800.00</strong></div><div><span>Remaining value</span><strong>400.00</strong></div></div><p class="po-progress">1 of 3 materials fully received</p><p class="po-expected">Expected Aug 26</p>'}<footer>${status !== "completed" ? "<button>Receive Delivery</button>" : ""}<button class="secondary">View Order</button>${status === "draft" ? '<button class="text">Edit</button>' : ""}</footer></article>`;
const supplierCard = (index: number, full: boolean) => `<article class="ia-supplier-card"><header><strong>${index === 1 ? "A Very Long Hospitality Materials Supplier Business Name" : `Supplier ${index}`}</strong><span class="ia-supplier-status">Active</span></header><div class="ia-supplier-contact">${full ? "<span>Contact: A Contact Person With A Long Name</span><a>+251 911 093 852 extension 12345</a><span>A long supplier address that wraps safely without widening the page</span><span>Supplies 4 materials</span>" : "<a>0911093852</a>"}</div><footer><button>Edit</button></footer></article>`;
const markup = `<main><div class="po-page"><div class="po-heading po-heading-action"><button>Create Purchase Order</button></div><div class="po-tabs"><button aria-selected="true">Open<span>1</span></button><button>Partially Received<span>1</span></button><button>Completed<span>1</span></button><button>All<span>3</span></button></div><details class="po-filters"><summary>Search and filters</summary></details><section class="po-order-grid">${purchaseCard("draft", 1)}${purchaseCard("partially_received", 2)}${purchaseCard("completed", 3)}</section></div><hr><div class="ia-suppliers-page"><div class="ia-suppliers-tools"><label class="ia-suppliers-search"><span>Search suppliers</span><input placeholder="Search name, phone, or contact"></label><button>Add Supplier</button></div><section class="ia-suppliers-grid">${supplierCard(1, true)}${supplierCard(2, false)}${supplierCard(3, false)}</section></div></main>`;

async function load(page: Page, width: number, height: number, body = markup) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style>${body}`);
}

const viewports = [[360, 800], [375, 812], [390, 844], [412, 915], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1280, 800], [1366, 768], [1440, 900], [1920, 1080]];
for (const [width, height] of viewports) {
  test(`Purchasing workspaces fit ${width}x${height}`, async ({ page }) => {
    await load(page, width, height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole("button", { name: "Create Purchase Order" })).toBeVisible();
    await expect(page.getByPlaceholder("Search name, phone, or contact")).toBeVisible();
    const poCards = page.locator(".po-order-card");
    const supplierCards = page.locator(".ia-supplier-card");
    await expect(poCards).toHaveCount(3);
    await expect(supplierCards).toHaveCount(3);
    const expectedColumns = width >= 1200 ? 3 : width >= 700 ? 2 : 1;
    const poTops = await poCards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(poTops.filter((top) => top === poTops[0])).toHaveLength(expectedColumns);
    const supplierTops = await supplierCards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(supplierTops.filter((top) => top === supplierTops[0])).toHaveLength(width >= 1100 ? 3 : width >= 700 ? 2 : 1);
    for (const button of await page.locator(".po-order-card footer button, .ia-supplier-card footer button").all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
    for (const noise of ["No contact person", "Not set", "None", "Supplied Ingredients", "Delete Draft"]) await expect(page.getByText(noise, { exact: true })).toHaveCount(0);
  });
}

test("mobile purchase receipt shows progress and configured storage", async ({ page }) => {
  const dialog = `<div class="po-backdrop"><section class="po-editor po-receipt-editor" role="dialog" aria-label="Receive PO"><header class="po-editor-heading"><div><span>RECEIVE DELIVERY</span><h2>PO 12345678</h2></div><button>×</button></header><div class="po-receipt-lines"><article class="po-receipt-line"><header><strong>Coffee</strong><span>Main Store With A Long Storage Name</span></header><dl><div><dt>Ordered</dt><dd>20 kg</dd></div><div><dt>Already received</dt><dd>10 kg</dd></div><div><dt>Remaining</dt><dd>10 kg</dd></div></dl><label>Receiving now<div><input value="10"><span>kg</span></div></label></article></div><p class="po-receipt-integrity">Stock is received into each material's configured storage and recorded against this purchase order.</p><footer class="po-editor-footer"><button class="secondary">Cancel</button><button>Confirm Receipt</button></footer></section></div>`;
  await load(page, 360, 800, dialog);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await expect(page.getByRole("dialog", { name: "Receive PO" })).toBeVisible();
  await expect(page.getByText("Main Store With A Long Storage Name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm Receipt" })).toBeVisible();
  const box = await page.locator(".po-editor").boundingBox();
  expect(box?.height).toBeLessThanOrEqual(800);
});
