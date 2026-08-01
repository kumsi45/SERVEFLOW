import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const styles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");

describe("Phase 10C business intelligence", () => {
  it("provides the complete Finance presentation layer", () => {
    for (const section of ["Revenue", "Expenses", "Profit", "Cash Register", "Payment Methods", "Taxes", "Refunds", "Daily Closing", "Financial Summary"]) expect(source).toContain(`"${section}"`);
    expect(source).toContain("od-finance-center");
    expect(source).toContain("od-finance-capabilities");
  });

  it("keeps every report in the centralized Reports Center", () => {
    for (const report of ["Executive Summary", "Sales", "Revenue", "Orders", "Menu Performance", "Kitchen Performance", "Staff Performance", "Inventory", "Customers", "Finance", "Payment Methods", "Taxes", "Refunds", "Profit & Loss"]) expect(source).toContain(`["${report}"`);
    expect(source).not.toContain("<IndependentModuleReport");
    expect(source).toContain("Reports Center");
  });

  it("uses the approved report periods and responsive executive layout", () => {
    for (const period of ["Today", "Yesterday", "Week", "Month", "Custom"]) expect(source).toContain(`${period.toLowerCase()}: "${period}"`);
    expect(styles).toContain(".od-reports-center .od-report-center-grid");
    expect(styles).toContain(".od-finance-center .od-financial-breakdown");
    expect(styles).toContain("@media(max-width:760px)");
  });
});
