import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getOccupiedOwnerTableIds,
  isCanonicalOwnerTableOccupancy,
  type OwnerTableSessionCandidate,
} from "../../src/modules/owner/services/ownerTablesReadModel";
import { sanitizePublicQrDiagnostic } from "../../src/modules/public-qr-ordering/services/publicQrContext";

const migration = readFileSync(
  "supabase/migrations/260_owner_tables_phase1_correctness_security.sql",
  "utf8",
);
const publicQrContext = readFileSync(
  "src/modules/public-qr-ordering/services/publicQrContext.ts",
  "utf8",
);
const ownerPage = readFileSync(
  "src/modules/owner/pages/OwnerDashboardPage.tsx",
  "utf8",
);

const session = (
  overrides: Partial<OwnerTableSessionCandidate> = {},
): OwnerTableSessionCandidate => ({
  restaurant_id: "restaurant-a",
  table_id: "table-a",
  status: "preparing",
  dining_session_status: "open",
  table_released_at: null,
  ...overrides,
});

describe("Owner Tables canonical occupancy", () => {
  it("marks only a same-tenant, same-table, open unreleased session occupied", () => {
    expect(
      isCanonicalOwnerTableOccupancy(session(), "restaurant-a", "table-a"),
    ).toBe(true);
    expect(
      isCanonicalOwnerTableOccupancy(
        session({ table_released_at: "2026-09-08T10:00:00Z" }),
        "restaurant-a",
        "table-a",
      ),
    ).toBe(false);
    expect(
      isCanonicalOwnerTableOccupancy(
        session({ dining_session_status: "closed" }),
        "restaurant-a",
        "table-a",
      ),
    ).toBe(false);
    expect(
      isCanonicalOwnerTableOccupancy(
        session({ status: "cancelled" }),
        "restaurant-a",
        "table-a",
      ),
    ).toBe(false);
  });

  it("does not infer occupancy from a reused number or another tenant", () => {
    const occupied = getOccupiedOwnerTableIds(
      [
        session({ table_id: "different-table" }),
        session({ restaurant_id: "restaurant-b" }),
      ],
      "restaurant-a",
    );
    expect(occupied.has("table-a")).toBe(false);
    expect(occupied.has("different-table")).toBe(true);
  });
});

describe("Owner Tables Phase 1 migration contracts", () => {
  it("protects count reduction with canonical immutable session identity", () => {
    expect(migration).toContain("sessions.table_id = tables.id");
    expect(migration).toContain("sessions.dining_session_status = 'open'");
    expect(migration).toContain("sessions.table_released_at is null");
    expect(migration).not.toContain("sessions.table_number = tables.table_number");
    expect(migration).toContain("on delete set null (table_id)");
  });

  it("removes anonymous capability enumeration without removing guarded RPCs", () => {
    expect(migration).toContain("drop policy if exists restaurant_tables_select_public_active");
    expect(migration).toContain("revoke all on public.restaurant_tables from anon");
    expect(migration).toContain("grant select on public.restaurant_tables to authenticated");
    expect(migration).toContain("get_public_qr_menu_phase260_base");
    expect(migration).toContain("table_entry - 'qr_token' - 'qr_url' - 'qr_path'");
    expect(migration).toContain("grant execute on function public.get_public_qr_menu(text) to anon, authenticated");
  });

  it("attributes stats by table id and restaurant-local day bounds", () => {
    expect(migration).toContain("orders.table_id = tables.id");
    expect(migration).toContain("timezone(restaurant_timezone, now())");
    expect(migration).toContain("orders.created_at < tomorrow_start");
    expect(migration).not.toContain("orders.table_number = tables.table_number");
  });

  it("audits sensitive actions without serializing QR capability fields", () => {
    expect(migration).toContain("'restaurant_table_qr_regenerated'");
    expect(migration).toContain("function public.regenerate_all_restaurant_table_qr");
    expect(migration).toContain("'restaurant_table_disabled'");
    expect(migration).toContain("'restaurant_table_enabled'");
    const auditDetails = migration.match(/jsonb_build_object\([\s\S]*?\)/g) ?? [];
    expect(auditDetails.join("\n")).not.toContain("qr_token");
  });

  it("redacts QR capabilities from development diagnostics", () => {
    expect(publicQrContext).toContain("sanitizePublicQrDiagnostic(context)");
    expect(publicQrContext).toContain("/token|sessionkey|session_key/i");
    expect(ownerPage).not.toContain("generatedQrUrl: url");
    expect(
      sanitizePublicQrDiagnostic({
        qrToken: "secret-token",
        sessionKey: "restaurant-1-secret-token",
        publicQrSession: {
          browserSessionToken: "browser-secret",
          tableNumber: "1",
        },
        generatedUrl: "/r/example?t=1&qr=secret-token",
      }),
    ).toEqual({
      qrToken: "[redacted]",
      sessionKey: "[redacted]",
      publicQrSession: {
        browserSessionToken: "[redacted]",
        tableNumber: "1",
      },
      generatedUrl: "[redacted]",
    });
  });
});
