import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const styles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");
const visibleSettings = source.slice(source.indexOf('className="od-config-center"'), source.indexOf('className="od-settings-form"'));

describe("Phase 10A.2 Owner Settings experience", () => {
  it("uses one focused Business Configuration Center", () => {
    expect(source).toContain("Business Configuration Center");
    for (const section of ["Business", "Payment &amp; Billing", "Printing", "Notifications"]) expect(visibleSettings).toContain(section);
    expect(visibleSettings).not.toContain("Theme Studio");
    expect(visibleSettings).not.toContain("Subscription & Billing");
    expect(visibleSettings).not.toContain("VAT / TIN");
    expect(visibleSettings).not.toContain("Instagram");
    expect(visibleSettings).not.toContain("Security");
  });

  it("provides the required payment and printer interface", () => {
    for (const label of ["Customer Pays Before Kitchen", "Waiter Places Order", "Mixed Mode", "Cash", "Telebirr", "CBE Birr", "Bank Transfer", "Credit Card", "Business payment accounts", "Service charge", "Commission", "Daily closing"]) expect(visibleSettings).toContain(label);
    for (const label of ["Receipt Printer", "Kitchen Printer", "Station Printers", "Printer mapping", "KDS", "Bluetooth — Future", "Run printer test"]) expect(visibleSettings).toContain(label);
  });

  it("provides actionable system health and responsive settings cards", () => {
    for (const label of ["System health", "QR Menu Published", "Payment Methods Configured", "Inventory Ready", "Business Profile Complete"]) expect(source).toContain(label);
    expect(visibleSettings).toContain('href={`#${target}`}');
    expect(styles).toContain(".od-config-section");
    expect(styles).toContain("@media(max-width:640px)");
    expect(styles).toContain("min-height:46px");
    expect(styles).toContain("prefers-reduced-motion:reduce");
  });
});
