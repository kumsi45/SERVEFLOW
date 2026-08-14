import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"), "utf8").replaceAll("\r\n", "\n");
const page = readFileSync(resolve(process.cwd(), "src/modules/cashier/pages/CashierDashboardPage.tsx"), "utf8");

describe("cashier shift action contrast", () => {
  it("keeps Open Shift text visible in every state", () => {
    expect(css).toContain(".cd-modal .cd-primary-action");
    expect(css).toContain("background: #c2410c; color: #fff");
    expect(css).toContain("background: #7c2d12; color: #fed7aa; opacity: 1");
  });

  it("keeps the Open Shift amount and notes visible on the light modal surface", () => {
    expect(page).toContain('className="cd-modal cd-open-shift-modal"');
    expect(css).toContain(".cd-open-shift-modal .cd-field input");
    expect(css).toContain("-webkit-text-fill-color: #14251d;");
    expect(css).toContain("caret-color: #087a48;");
    expect(css).toContain(".cd-open-shift-modal .cd-field input::placeholder");
    expect(css).toContain("-webkit-text-fill-color: #62756b;");
  });

  it("keeps Close Shift text visible in every state", () => {
    expect(css).toContain(".cd-shift-hero.active .cd-close-shift-btn");
    expect(css).toContain("background: #b91c1c; color: #fff");
    expect(css).toContain("background: #7f1d1d; color: #fecaca; opacity: 1");
  });

  it("keeps Close Shift fields and reconciliation totals readable", () => {
    expect(css).toContain(".cd-modal.wide .cd-field input");
    expect(css).toContain("background: #ffffff;\n  color: #14251d;");
    expect(css).toContain(".cd-modal.wide .cd-reconcile-panel");
    expect(css).toContain("background: #f3f7f5;\n  color: #14251d;");
    expect(css).toContain(".cd-modal.wide .cd-reconcile-row.total strong");
    expect(css).toContain("color: #075c34;");
  });
});
