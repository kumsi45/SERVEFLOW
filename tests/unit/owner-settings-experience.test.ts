import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ownerPage = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const settings = readFileSync("src/modules/owner/components/settings/OwnerSettingsPage.tsx", "utf8");
const styles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");

describe("Owner Settings S2 business configuration", () => {
  it("keeps the existing business contract in four scannable sections", () => {
    expect(ownerPage).toContain("<OwnerSettingsPage");
    for (const field of ["Business Profile", "Branding", "Business Hours", "Regional Settings", "Business Name", "Business Type", "Phone", "Email", "Business Description", "Address", "Currency", "Time Zone"]) {
      expect(settings).toContain(field);
    }
    expect(settings).toContain('supabase.rpc("update_restaurant_configuration"');
    expect(settings).toContain('.from("menu-photos").upload');
    expect(settings).not.toContain("<details");
  });

  it("removes the hidden legacy form and its QR background work", () => {
    for (const removed of ["SettingsFormState", "od-settings-form", "get_app_url", "set_app_url", "regenerate_all_restaurant_table_qr", "settingsHealthChecks", "qrCodes", "saveApplicationUrl"]) {
      expect(ownerPage + settings).not.toContain(removed);
    }
    expect(settings).not.toContain("QRCode");
  });

  it("removes duplicate and non-functional Business controls", () => {
    for (const removed of ["Payment &amp; Billing", "Printer connections", "System health", "Language configuration", "Low Stock", "Attendance", "Daily Closing Reminder", "Future capability", "presentation-only"]) {
      expect(settings).not.toContain(removed);
    }
    expect(styles).not.toContain("#payment-billing");
    expect(styles).not.toContain(".od-health-card");
    expect(styles).not.toContain(".od-printer-grid");
  });

  it("mounts Payments on first visit and retains same-restaurant state on revisit", () => {
    expect(settings).toContain("paymentsMounted");
    expect(settings).toContain("setPaymentsMounted(true)");
    expect(settings).toContain('hidden={workspace !== "payments"}');
    expect(settings).toContain("key={restaurantId}");
    expect(settings).toContain('setPaymentsMounted(false)');
  });

  it("uses preview-led, accessible branding controls and guards tenant switches", () => {
    expect(settings).toContain("Current ${label}");
    expect(settings).toContain('className="od-visually-hidden"');
    expect(settings).toContain('aria-label={`Upload ${label}`}');
    expect(settings).toContain("activeRestaurantId.current !== targetRestaurantId");
    expect(settings).toContain("assetPath(targetRestaurantId, type)");
  });

  it("keeps persisted Business Type informational and out of the Settings write path", () => {
    expect(settings).toContain('businessType: string(config?.profile ?? {}, "restaurant_type")');
    expect(settings).toContain("Selected when your business was created.");
    expect(settings).toContain("Not configured");
    expect(settings).not.toContain('set("businessType"');
    expect(settings).not.toContain("restaurant_type: form.businessType");
    expect(settings).not.toContain("businessType: string(config?.profile ?? {}, \"restaurant_type\", \"Cafe\")");
  });

  it("renders contextual actions only for dirty sections while retaining one composite save", () => {
    expect(settings).toContain('aria-label="Business settings areas"');
    expect(settings).toContain("const dirty");
    expect(settings).toContain("const profileDirty");
    expect(settings).toContain("const brandingDirty");
    expect(settings).toContain("const hoursDirty");
    expect(settings).toContain("const regionalDirty");
    expect(settings).toContain("Unsaved changes");
    expect(settings).toContain("function DirtyActions");
    expect(settings).toContain("return dirty ? <div className=\"od-config-actions\"");
    expect(settings).not.toContain('<div className="od-config-toolbar"');
    expect(settings).toContain('type="submit" disabled={working}');
    expect(settings).toContain("function discard()");
    expect(styles).toContain(".od-config-actions");
    expect(styles).toContain(".od-config-section.is-dirty");
  });

  it("preserves responsive navigation and contextual action clearance", () => {
    expect(settings).toContain('aria-current={active ? "page" : undefined}');
    expect(styles).toContain("@media(max-width:640px)");
    expect(styles).toContain(".od-day-fieldset");
    expect(styles).toContain("@media(max-width:390px)");
    expect(styles).toContain(".od-config-header{display:none}");
    expect(styles).toContain(".od-root:has(.od-config-page)>.sf-ai-launcher");
    expect(styles).toContain(".od-config-actions .od-btn-ghost");
    expect(styles).toContain("prefers-reduced-motion:reduce");
  });
});
