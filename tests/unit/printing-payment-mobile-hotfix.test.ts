import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPrinterDraft } from "../../src/modules/owner/components/settings/PrintingPaymentConfigurationCenter";
import type { OwnerPrinter } from "../../src/modules/owner/services/printingPaymentConfigurationService";

function printer(id: string, purpose: OwnerPrinter["purpose"], isDefault: boolean): OwnerPrinter {
  return { id, restaurant_id: "tenant-a", name: id, purpose, brand: "Generic", model: null, printer_type: "thermal", paper_size: "80mm", status: "not_configured", enabled: true, is_default: isDefault, priority: 1, backup_for_purpose: null, physical_location: null };
}

describe("Phase 11.2.1 mobile modal and default printer hotfix", () => {
  it("replaces only the previous default of the same printer purpose", () => {
    const result = applyPrinterDraft([printer("old", "receipt", true), printer("kitchen", "kitchen_order", true)], printer("new", "receipt", true));
    expect(result.find((item) => item.id === "old")?.is_default).toBe(false);
    expect(result.find((item) => item.id === "new")?.is_default).toBe(true);
    expect(result.find((item) => item.id === "kitchen")?.is_default).toBe(true);
  });

  it("uses a document-body portal and a mobile safe-area bottom sheet", () => {
    const component = readFileSync(resolve(process.cwd(), "src/modules/owner/components/design-system/OwnerDesignSystem.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "src/modules/owner/components/design-system/ownerDesignSystem.css"), "utf8");
    expect(component).toContain("createPortal");
    expect(component).toContain("document.body");
    expect(css).toContain("z-index:10000");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });

  it("saves default replacement atomically and remains tenant authorized", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/211_phase11_2_1_atomic_default_printer.sql"), "utf8");
    expect(sql).toContain("public.has_staff_role");
    expect(sql).toContain("set is_default = false");
    expect(sql).toContain("insert into public.business_printers");
    expect(sql).not.toContain("alter table");
    expect(sql).not.toContain("create table");
  });
});
