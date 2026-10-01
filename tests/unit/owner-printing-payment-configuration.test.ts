import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("src/modules/owner/components/settings/PrintingPaymentConfigurationCenter.tsx", "utf8");
const service = readFileSync("src/modules/owner/services/printingPaymentConfigurationService.ts", "utf8");
const styles = readFileSync("src/modules/owner/components/settings/printingPaymentConfigurationCenter.css", "utf8");

describe("Owner Settings S1 canonical payment configuration", () => {
  it("retains only currently functional payment controls", () => {
    for (const label of ["Customer Pays Before Kitchen", "Waiter Payment Due", "Payment Methods", "Payment Accounts", "VAT", "Service Charge", "Customer Payment Preview"]) {
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

  it("keeps mobile, motion and dark-mode support", () => {
    expect(styles).toContain("@media(max-width:680px)");
    expect(styles).toContain("min-height:44px");
    expect(styles).toContain("prefers-reduced-motion:reduce");
    expect(styles).toContain("prefers-color-scheme:dark");
    expect(component).toContain("SfSkeleton");
    expect(component).toContain("SfErrorState");
  });
});
