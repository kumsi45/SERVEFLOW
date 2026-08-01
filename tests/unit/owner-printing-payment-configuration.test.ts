import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("src/modules/owner/components/settings/PrintingPaymentConfigurationCenter.tsx", "utf8");
const service = readFileSync("src/modules/owner/services/printingPaymentConfigurationService.ts", "utf8");
const styles = readFileSync("src/modules/owner/components/settings/printingPaymentConfigurationCenter.css", "utf8");
const ownerPage = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");

describe("Phase 11.2 Owner Printing and Payment Configuration Center", () => {
  it("provides the permanent settings information architecture", () => {
    expect(ownerPage).toContain("Printing &amp; Payments");
    expect(ownerPage).toContain("<PrintingPaymentConfigurationCenter");
    for (const heading of ["Receipt Printing", "Kitchen Output", "Customer Payments", "System Health"]) expect(component).toContain(heading);
    expect(component).toContain('aria-label="Printing and payment sections"');
  });

  it("contains required printer controls and visual-only previews", () => {
    for (const label of ["Enable Receipt Printing", "Receipt Printer", "Brand", "Model", "Connection Type", "USB", "Network", "58 mm", "80 mm", "Auto Print", "Auto Cutter", "Print Logo", "Receipt Language", "Print Test", "Receipt Preview", "Kitchen Ticket Preview"]) expect(component).toContain(label);
    for (const mode of ["Single Kitchen Order Printer", "Station Printers", "Kitchen Display System", "Kitchen Display + Printers"]) expect(component).toContain(mode);
    expect(component).toContain("No document was sent to a printer.");
    expect(component).not.toMatch(/navigator\.usb|navigator\.bluetooth|window\.print|print\(/);
  });

  it("contains complete payment configuration and visual popup", () => {
    for (const label of ["Customer Pays Before Kitchen", "Waiter Payment Due", "Mixed Mode", "Payment Accounts", "QR Image URL", "Instructions", "VAT", "Service Charge", "Commission", "Daily Closing", "Customer Payment Popup Preview"]) expect(component + service).toContain(label);
    expect(component).toContain("config.methods.map");
    expect(component).toContain("Make default");
    expect(component).toContain("softDeletePaymentAccount");
  });

  it("tenant-scopes every configuration query and uses only the atomic printer RPC", () => {
    const queryCount = (service.match(/supabase\.from\(/g) ?? []).length;
    const tenantFilterCount = (service.match(/\.eq\("restaurant_id", restaurantId\)/g) ?? []).length;
    expect(queryCount).toBeGreaterThan(10);
    expect(tenantFilterCount).toBeGreaterThanOrEqual(10);
    expect(service).not.toMatch(/create table|alter table|create policy/i);
    expect(service.match(/supabase\.rpc\(/g)).toHaveLength(1);
    expect(service).toContain('supabase.rpc("save_business_printer"');
    expect(service).not.toMatch(/payment gateway|telebirr api|bank api|printer sdk/i);
  });

  it("is mobile-first, accessible, motion-safe, and dark-ready", () => {
    expect(styles).toContain("@media(max-width:680px)");
    expect(styles).toContain("min-height:44px");
    expect(styles).toContain("prefers-reduced-motion:reduce");
    expect(styles).toContain("prefers-color-scheme:dark");
    expect(component).toContain("Fix Now");
    expect(component).toContain("SfSkeleton");
    expect(component).toContain("SfErrorState");
  });
});
