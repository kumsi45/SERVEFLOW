import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  resolve(process.cwd(), "src/modules/cashier/styles/cashierDashboard.css"),
  "utf8",
);
const page = readFileSync(
  resolve(process.cwd(), "src/modules/cashier/pages/CashierDashboardPage.tsx"),
  "utf8",
);

describe("Phase 13.1 cashier hospitality POS sidebar", () => {
  it("is isolated to the desktop left sidebar", () => {
    expect(styles).toContain("Phase 13.1 — professional hospitality POS left sidebar");
    expect(styles).toContain("@media (min-width: 1024px)");
    expect(styles).toContain("grid-template-columns: 270px minmax(0, 1fr) 30%");
    expect(styles).toContain(".cd-pos-nav {");
  });

  it("starts with Primary Actions and does not reserve space for duplicate branding", () => {
    expect(styles).not.toContain("Cashier Terminal");
    expect(styles).not.toContain(".cd-pos-nav::before");
    expect(styles).toContain('content: "Primary Actions"');
    expect(styles).toContain("padding: 24px");
    expect(styles).toContain("gap: 8px");
  });

  it("makes New Order the dominant action without changing its handler", () => {
    expect(styles).toContain("min-height: 56px");
    expect(styles).toContain("border-radius: 16px");
    expect(styles).toContain("transform: scale(.98)");
    expect(styles).toContain("transition: background-color 120ms ease");
    expect(page).toContain('onClick={() => setPosEntryOpen(true)}');
  });

  it("keeps cancellation secondary and exposes a pending badge treatment", () => {
    expect(styles).toContain('.cd-nav-badge::after');
    expect(styles).toContain('content: " Pending"');
    expect(styles).toContain("background: #fff0dc");
    expect(page).toContain("Cancellation Requests");
  });

  it("styles recent activity as a compact, scrollable status timeline", () => {
    expect(styles).toContain("scrollbar-width: thin");
    expect(styles).toContain('content: "Today\'s Activity"');
    expect(styles).toContain("font-size: 14px");
    expect(styles).toContain("font-size: 12px");
    expect(styles).toContain(".cd-activity-dot.payment_verified");
    expect(styles).toContain(".cd-activity-dot.payment_submitted");
    expect(styles).toContain(".cd-activity-dot.receipt_printed");
    expect(page).toContain(".slice(0, 5)");
  });

  it("preserves keyboard focus and reduced-motion support", () => {
    expect(styles).toContain(".cd-pos-nav-primary > button:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
