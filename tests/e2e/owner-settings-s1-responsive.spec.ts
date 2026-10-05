import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const ownerStyles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");
const paymentStyles = readFileSync("src/modules/owner/components/settings/printingPaymentConfigurationCenter.css", "utf8");

const markup = `
  <main class="od-page od-config-page">
    <header class="od-page-header od-config-header"><div><span class="od-config-eyebrow">Owner settings</span><h1 class="od-page-title">Business Configuration Center</h1></div></header>
    <nav class="od-settings-workspaces"><button class="active"><span>B</span><div><strong>Business Settings</strong><small>Profile and hours</small></div></button><button><span>P</span><div><strong>Payments</strong><small>Checkout settings</small></div></button></nav>
    <form class="od-config-center"><div class="od-config-toolbar"><div><strong>Business essentials</strong></div><div><button class="od-btn-ghost">Discard</button><button class="od-btn-primary">Save changes</button></div></div><div class="od-config-sections"><details class="od-config-section" open><summary><span class="od-config-icon">B</span><div><strong>Business</strong><small>Identity and regional preferences</small></div><span class="od-config-chevron">⌄</span></summary><div class="od-config-content"><div class="od-settings-grid"><label>Business Name<input value="Cafe" /></label><label>Email<input value="owner@example.com" /></label><label class="wide">Address<input value="Addis Ababa" /></label></div><div class="od-day-pills">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => `<label><span>${day}</span><small>Open</small></label>`).join("")}</div></div></details></div></form>
    <section class="ppcc-shell"><section class="ppcc-section"><div class="ppcc-flow-row"><label class="ppcc-field">Order flow<select><option>Customer pays before kitchen</option></select></label></div></section><section class="ppcc-section"><div class="ppcc-method-grid"><article><strong>Cash</strong></article><article><strong>Telebirr</strong></article></div></section><section class="ppcc-section"><div class="ppcc-subhead"><h3>Payment Accounts</h3><button class="sf-button secondary">Add account</button></div></section></section>
  </main>`;

for (const width of [430, 390, 360]) {
  test(`Owner Settings S3.1 fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${ownerStyles}\n${paymentStyles}\n*{box-sizing:border-box}body{margin:0}.od-page{padding:14px}</style></head><body>${markup}</body></html>`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();
    const businessSave = await page.getByRole("button", { name: "Save changes" }).boundingBox();
    const addAccount = await page.getByRole("button", { name: "Add account" }).boundingBox();
    expect((businessSave?.x ?? 0) + (businessSave?.width ?? 0)).toBeLessThanOrEqual(width);
    expect((addAccount?.x ?? 0) + (addAccount?.width ?? 0)).toBeLessThanOrEqual(width);
  });
}
