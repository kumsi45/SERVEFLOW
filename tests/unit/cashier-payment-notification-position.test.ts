import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/modules/cashier/pages/CashierDashboardPage.tsx"), "utf8");

describe("cashier payment notification position", () => {
  it("presents payment confirmation as a top popup", () => {
    expect(css).toMatch(/\.cd-realtime-notice\s*\{[\s\S]*?position: fixed;/);
    expect(css).toContain("top: 72px");
    expect(css).toContain("z-index: 320");
    expect(css).toContain("width: min(620px, calc(100vw - 40px))");
  });

  it("uses the current accessible toast viewport instead of the retired banner", () => {
    expect(page).toContain("<CashierToastViewport");
    expect(page).not.toContain('className="cd-realtime-notice" role="status"');
    expect(page).not.toContain("setRealtimeNotice(null)");
  });

  it("has mobile and reduced-motion handling", () => {
    expect(css).toContain("@media (max-width: 600px)");
    expect(css).toContain("width: calc(100vw - 24px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
