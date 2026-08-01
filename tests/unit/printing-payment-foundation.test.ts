import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/207_phase11_1_printing_payment_foundation.sql", "utf8");

const tenantTables = [
  "business_printing_settings",
  "business_printers",
  "printer_connections",
  "printer_capabilities",
  "printer_station_mappings",
  "printer_test_runs",
  "business_payment_methods",
  "business_payment_accounts",
  "business_daily_closing_config",
];

describe("Phase 11.1 printing and payment database foundation", () => {
  it("creates the normalized tenant-owned models", () => {
    for (const table of tenantTables) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain("restaurant_id uuid not null references public.restaurants(id)");
    expect(migration).toContain("printer_station_mapping_station_same_tenant");
    expect(migration).toContain("business_payment_account_method_same_tenant");
  });

  it("supports V1 values and future placeholders without implementing integrations", () => {
    for (const value of ["single_kitchen_printer", "station_printers", "kds", "kds_and_printers", "usb", "network", "bluetooth", "58mm", "80mm", "mixed", "telebirr", "cbe_birr", "mobile_banking", "bank_transfer", "credit_card"]) {
      expect(migration).toContain(value);
    }
    expect(migration).not.toMatch(/create extension|http_request|net\.http|webhook/i);
  });

  it("enforces private owner-only RLS and immutable tenant ownership", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.%I from public, anon, authenticated");
    expect(migration).toContain("public.has_staff_role(restaurant_id, array[''owner'']");
    expect(migration).toContain("Tenant ownership cannot be reassigned.");
    expect(migration).toContain("Immutable identifier cannot be changed.");
    expect(migration).not.toMatch(/grant\s+[^;]+\s+to\s+anon\b/i);
  });

  it("seeds existing and future tenants independently", () => {
    expect(migration).toContain("select id from public.restaurants");
    expect(migration).toContain("initialize_phase11_business_foundation");
    expect(migration).toContain("after insert on public.restaurants");
    expect(migration).toContain("on conflict (restaurant_id, method_code) do nothing");
  });
});
