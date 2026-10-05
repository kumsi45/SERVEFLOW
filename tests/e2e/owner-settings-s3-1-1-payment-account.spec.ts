import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const designSystem = readFileSync("src/modules/owner/components/design-system/ownerDesignSystem.css", "utf8");
const paymentStyles = readFileSync("src/modules/owner/components/settings/printingPaymentConfigurationCenter.css", "utf8");

function fixture() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${designSystem}\n${paymentStyles}\n*{box-sizing:border-box}body{margin:0;padding:14px;background:#f5f8f6}.ppcc-section{max-width:720px;margin:auto}.account-dialog[hidden]{display:none}</style></head><body><section class="ppcc-section"><div class="ppcc-subhead"><div><h3>Payment Accounts</h3></div><button class="sf-button secondary" id="add">Add account</button></div></section><div class="sf-overlay account-dialog" hidden><button class="sf-overlay-dismiss" id="dismiss"></button><section class="sf-dialog" role="dialog" aria-modal="true" aria-label="Add payment account"><header><h2>Add payment account</h2></header><div class="ppcc-account-form"><label class="ppcc-field"><span>Payment Method</span><select id="method"><option value="">Select payment method</option><option value="telebirr">Telebirr</option><option value="cbe_birr">CBE Birr</option><option value="mobile_banking">Mobile Banking</option><option value="bank_transfer">Bank Transfer</option></select></label><p class="ppcc-account-method-hint" id="hint">Select a payment method to enter settlement details.</p><label class="ppcc-field" id="identifier" hidden><span id="identifier-label"></span><input></label><div class="ppcc-dialog-actions"><button class="sf-button secondary" id="cancel">Cancel</button><button class="sf-button" id="save">Save account</button></div></div></section></div><script>const dialog=document.querySelector('.account-dialog'), method=document.querySelector('#method'), identifier=document.querySelector('#identifier'), label=document.querySelector('#identifier-label'), hint=document.querySelector('#hint');document.querySelector('#add').onclick=()=>{dialog.hidden=false};document.querySelector('#cancel').onclick=document.querySelector('#dismiss').onclick=()=>{dialog.hidden=true;method.value='';identifier.hidden=true;hint.hidden=false};method.onchange=()=>{const phone=method.value==='telebirr';identifier.hidden=!method.value;hint.hidden=!!method.value;label.textContent=phone?'Telebirr phone number':method.value==='cbe_birr'?'CBE Birr account number':'Account number'};</script></body></html>`;
}

for (const width of [430, 390, 360]) {
  test(`S3.1.1 Add account editor is usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(fixture());
    await page.getByRole("button", { name: "Add account" }).click();
    const dialog = page.getByRole("dialog", { name: "Add payment account" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("option", { name: "Cash" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Credit Card" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "QR" })).toHaveCount(0);
    await page.locator("#method").selectOption("telebirr");
    await expect(page.getByText("Telebirr phone number")).toBeVisible();
    await expect(page.getByText("Account Number", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save account" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
}

test("S3.1.1 Add account editor is visible on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(fixture());
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByRole("dialog", { name: "Add payment account" })).toBeVisible();
});
