import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const managerStyles = readFileSync(resolve(process.cwd(), "src/modules/manager/styles/managerStaffOperations.css"), "utf8");
const ownerStyles = readFileSync(resolve(process.cwd(), "src/modules/owner/styles/ownerDashboard.css"), "utf8");
const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 800 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
];

const credentialFields = `
  <label><span>Full Name *</span><input value="New staff member"></label>
  <label><span>Email *</span><input type="email" value="staff@example.com"></label>
  <label><span>Password *</span><input type="password" value="StrongPass1"></label>
  <label><span>Confirm Password *</span><input type="password" value="StrongPass1"></label>`;

test("Manager privileged staff form stays contained at required widths", async ({ page }) => {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${managerStyles}*{box-sizing:border-box}html,body{margin:0}</style><main class="mso-page"><section class="mso-panel mso-create-panel"><form class="mso-create-form"><div class="mso-form-grid">${credentialFields}</div><div class="mso-form-actions"><button>Cancel</button><button class="mso-primary-action">Create Chef</button></div></form></section></main>`);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      contained: [...document.querySelectorAll<HTMLElement>("input,button")].every((node) => node.getBoundingClientRect().right <= innerWidth),
      submitHeight: document.querySelector<HTMLElement>(".mso-primary-action")!.getBoundingClientRect().height,
    }));
    expect(result.overflow).toBe(false);
    expect(result.contained).toBe(true);
    expect(result.submitHeight).toBeGreaterThanOrEqual(44);
  }
});

test("Owner privileged staff form stays contained at required widths", async ({ page }) => {
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${ownerStyles}*{box-sizing:border-box}html,body{margin:0}</style><div class="od-modal"><div class="od-modal-card"><form class="od-staff-form">${credentialFields}<div class="od-modal-actions"><button class="od-btn-ghost">Cancel</button><button class="od-btn-primary">Create Inventory Officer</button></div></form></div></div>`);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      contained: [...document.querySelectorAll<HTMLElement>("input,button")].every((node) => node.getBoundingClientRect().right <= innerWidth),
      inputsFit: [...document.querySelectorAll<HTMLElement>("input")].every((node) => node.getBoundingClientRect().width > 0),
    }));
    expect(result.overflow).toBe(false);
    expect(result.contained).toBe(true);
    expect(result.inputsFit).toBe(true);
  }
});
