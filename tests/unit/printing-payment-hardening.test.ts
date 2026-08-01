import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const foundation = readFileSync("supabase/migrations/207_phase11_1_printing_payment_foundation.sql", "utf8");
const hardening = readFileSync("supabase/migrations/208_phase11_1a_printing_payment_database_hardening.sql", "utf8");
const combined = `${foundation}\n${hardening}`;

describe("Phase 11.1A printing and payment database hardening", () => {
  it("uses one printer-purpose authority with failover metadata", () => {
    expect(hardening).toContain("rename column printer_role to purpose");
    expect(hardening).not.toContain("add column if not exists purpose");
    for (const field of ["brand", "model", "is_default", "priority", "backup_for_purpose", "physical_location"]) {
      expect(hardening).toContain(`add column if not exists ${field}`);
    }
    for (const purpose of ["receipt", "kitchen_order", "station", "backup", "future", "kds"]) expect(hardening).toContain(`'${purpose}'`);
    expect(hardening).toContain("business_printers_one_default_purpose_idx");
    expect(hardening).toContain("business_printers_failover_priority_idx");
  });

  it("adds immutable QR references, instructions, one default method, and cash limits", () => {
    expect(hardening).toContain("qr_image_url text");
    expect(hardening).toContain("instructions text");
    expect(hardening).toContain("position('?' in qr_image_url) = 0");
    expect(hardening).toContain("business_payment_methods_one_default_idx");
    expect(hardening).toContain("cash_change_limit numeric(12,2)");
    expect(hardening).toContain("method_code = 'cash'");
    expect(hardening).not.toContain("cash_accepted boolean");
  });

  it("adds a tenant-private template foundation without rendering", () => {
    expect(hardening).toContain("create table if not exists public.printer_templates");
    for (const type of ["receipt", "kitchen_ticket", "station_ticket"]) expect(hardening).toContain(`'${type}'`);
    expect(hardening).toContain("placeholder_schema jsonb");
    expect(hardening).toContain("branding_options jsonb");
    expect(hardening).toContain("printer_templates_owner_all");
    expect(hardening).toContain("protect_printer_templates_tenant");
    expect(hardening).not.toMatch(/render_template|printer sdk|cloud print/i);
  });

  it("preserves canonical financial authorities and private RLS", () => {
    expect(hardening).not.toContain("create table if not exists public.business_financial_settings");
    expect(combined.match(/add column if not exists vat_price_mode/g)?.length).toBe(1);
    expect(combined.match(/add column if not exists service_charge_mode/g)?.length).toBe(1);
    expect(hardening).toContain("enable row level security");
    expect(hardening).toContain("revoke all on public.printer_templates from public, anon, authenticated");
    expect(hardening).not.toMatch(/grant\s+[^;]+\s+to\s+anon\b/i);
  });
});
