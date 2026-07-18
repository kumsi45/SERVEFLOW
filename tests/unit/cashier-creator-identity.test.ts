import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/156_cashier_invoice_creator_identity.sql"), "utf8").toLowerCase();

describe("cashier invoice creator identity", () => {
  it("stamps new cashier invoices with staff identity", () => {
    expect(sql).toContain("stamp_invoice_ownership");
    expect(sql).toContain("actor.display_name");
    expect(sql).toContain("'created_by_staff_id', actor.id");
  });

  it("repairs and safely projects historical cashier identity", () => {
    expect(sql).toContain("shift_activity_logs");
    expect(sql).toContain("audit_actor.display_name");
    expect(sql).toContain("when o.order_source='cashier' then 'cashier'");
  });
});
