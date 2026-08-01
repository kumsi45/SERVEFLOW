import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const projection = read("supabase/fixes/phase12-1a1-smart-qr-invoice-projection.sql");
const portal = read("src/modules/public-qr-ordering/components/SmartCustomerPortal.tsx");

describe("Phase 12.1A.1 Smart QR invoice projection", () => {
  it("projects every stored invoice financial field without rate calculations", () => {
    for (const field of ["subtotal", "vat_amount", "service_charge_amount", "discount_amount", "grand_total"]) {
      expect(projection).toContain(`inv.${field}`);
    }
    expect(projection).not.toMatch(/vat_percentage|service_charge_percentage|vat_rate|service_charge_rate/);
  });

  it("keeps the projection tenant and active-order scoped and excludes cancelled invoices", () => {
    expect(projection).toContain("inv.restaurant_id=business.id");
    expect(projection).toContain("inv.order_id=active_order.id");
    expect(projection).toContain("<> ''cancelled''");
  });

  it("hides zero optional rows and preserves the authoritative grand total fallback", () => {
    expect(portal).toContain("state.vat_amount?<div><dt>VAT</dt>");
    expect(portal).toContain("state.service_charge_amount?<div><dt>Service charge</dt>");
    expect(portal).toContain("state.discount_amount?<div><dt>Discount</dt>");
    expect(portal).toContain("state.grand_total??state.total_price??0");
  });
});
