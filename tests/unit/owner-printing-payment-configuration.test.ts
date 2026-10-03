import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("src/modules/owner/components/settings/PrintingPaymentConfigurationCenter.tsx", "utf8");
const service = readFileSync("src/modules/owner/services/printingPaymentConfigurationService.ts", "utf8");
const styles = readFileSync("src/modules/owner/components/settings/printingPaymentConfigurationCenter.css", "utf8");

describe("Owner Settings S3.1 compact payment configuration", () => {
  it("retains only currently functional payment controls", () => {
    for (const label of ["Payment Flow", "Customer pays before kitchen", "Waiter payment due", "Payment Methods", "Payment Accounts", "VAT", "Service Charge", "Customer payment preview"]) {
      expect(component).toContain(label);
    }
    expect(component).toContain("config.methods.map");
    expect(component).toContain("Make default");
    expect(component).toContain("softDeletePaymentAccount");
  });

  it("defers unsupported financial and printer controls", () => {
    for (const removed of ["Mixed Mode", "Commission", "Daily Closing", "Price treatment", "Fixed Amount", "Print Test", "Printer Status", "Auto Cutter", "Receipt Language", "Kitchen Output", "System Health", "Coming Soon"]) {
      expect(component).not.toContain(removed);
    }
    for (const unusedField of ["vat_price_mode", "service_charge_mode", "service_charge_fixed_amount", "commission_enabled", "business_daily_closing_config", "business_printers", "printer_connections"]) {
      expect(service).not.toContain(unusedField);
    }
  });

  it("loads three tenant-scoped payment resources and uses owner-authorized RPCs", () => {
    expect(service.match(/supabase\.from\(/g)).toHaveLength(6);
    expect(service).toContain('supabase.rpc("set_restaurant_payment_policy"');
    expect(service).toContain('supabase.rpc("set_restaurant_financial_settings"');
    expect(service).not.toContain('.from("restaurants").update');
    expect(service).toContain('.eq("restaurant_id", restaurantId)');
  });

  it("does not refetch after save and accurately describes checkout visibility", () => {
    const saveBody = component.slice(component.indexOf("async function save()"), component.indexOf("function setDefaultMethod"));
    expect(saveBody).not.toContain("await load()");
    expect(component).toContain("Settlement details shown to customers");
    expect(component).not.toContain("Private settlement details");
  });

  it("keeps account setup method-aware without inventing a QR settlement account", () => {
    expect(component).toContain('if (code === "telebirr") return "Telebirr phone number"');
    expect(component).toContain('if (code === "cbe_birr") return "CBE Birr account number"');
    expect(component).toContain('!["cash", "credit_card", "card", "qr"].includes(code)');
    expect(component).toContain('"Recorded by staff at checkout"');
    expect(component).toContain("supportsPaymentAccount(method.method_code)");
    expect(component).not.toContain('Field label="Phone Number"');
  });

  it("uses progressive disclosure and only surfaces save controls when changed", () => {
    expect(component).toContain('const [expandedAccountId');
    expect(component).toContain('const [editingCharge');
    expect(component).toContain('const [previewOpen');
    expect(component).toContain('aria-expanded={expanded}');
    expect(component).toContain('Sample only');
    expect(component).toContain('{dirty ? <div className="ppcc-actions"');
    expect(styles).toContain(".ppcc-flow-row");
    expect(styles).toContain(".ppcc-account-summary");
    expect(styles).toContain(".ppcc-preview-toggle");
  });

  it("keeps mobile, motion and dark-mode support", () => {
    expect(styles).toContain("@media(max-width:680px)");
    expect(styles).toContain("min-height:44px");
    expect(styles).toContain("prefers-reduced-motion:reduce");
    expect(styles).toContain("prefers-color-scheme:dark");
    expect(component).toContain("SfSkeleton");
    expect(component).toContain("SfErrorState");
  });
});
