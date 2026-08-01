import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const styles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");
const businessSettings = source.slice(source.indexOf('className={`od-config-center'), source.indexOf('className="od-settings-form"'));

describe("Phase 10A.2 Owner Settings experience", () => {
  it("uses one focused Business Configuration Center", () => {
    expect(source).toContain("Business Configuration Center");
    for (const section of ["Business", "Notifications"]) expect(businessSettings).toContain(section);
    expect(source).toContain("Printing &amp; Payments");
    expect(businessSettings).not.toContain("Theme Studio");
    expect(businessSettings).not.toContain("Subscription & Billing");
    expect(businessSettings).not.toContain("VAT / TIN");
    expect(businessSettings).not.toContain("Instagram");
    expect(businessSettings).not.toContain("Security");
  });

  it("routes printing and payments to one dedicated settings workspace", () => {
    expect(source).toContain("<PrintingPaymentConfigurationCenter");
    expect(source).toContain('settingsWorkspace === "printing-payments"');
    expect(styles).toContain(".od-config-center>#payment-billing,.od-config-center>#printing{display:none}");
  });

  it("provides responsive, accessible workspace navigation", () => {
    expect(source).toContain('aria-label="Business settings areas"');
    expect(source).toContain("onOpenBusiness");
    expect(styles).toContain(".od-settings-workspaces");
    expect(styles).toContain("@media(max-width:640px)");
    expect(styles).toContain("min-height:46px");
    expect(styles).toContain("prefers-reduced-motion:reduce");
  });
});
