import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ownerPage = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const settings = readFileSync("src/modules/owner/components/settings/OwnerSettingsPage.tsx", "utf8");
const styles = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");

describe("Owner Settings S1 consolidated architecture", () => {
  it("keeps functional business configuration in one active workspace", () => {
    expect(ownerPage).toContain("<OwnerSettingsPage");
    for (const field of ["Business Name", "Business Type", "Phone", "Email", "Business Description", "Address", "Business hours", "Currency", "Time Zone"]) {
      expect(settings).toContain(field);
    }
    expect(settings).toContain('supabase.rpc("update_restaurant_configuration"');
    expect(settings).toContain('.from("menu-photos").upload');
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

  it("preserves responsive and accessible navigation", () => {
    expect(settings).toContain('aria-label="Business settings areas"');
    expect(styles).toContain("@media(max-width:640px)");
    expect(styles).toContain("min-height:46px");
    expect(styles).toContain("prefers-reduced-motion:reduce");
  });
});
