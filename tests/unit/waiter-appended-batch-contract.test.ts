import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/155_waiter_appended_batch_identity_and_policy.sql",
  ),
  "utf8",
).toLowerCase();

describe("waiter appended order batch", () => {
  it("reuses the open-session base and preserves a separate invoice batch", () => {
    expect(sql).toContain("submit_waiter_order_batch_phase7a1_base");
    expect(sql).not.toContain("merge_open_session_invoice(payload)");
  });

  it("stamps the authenticated waiter identity", () => {
    expect(sql).toContain("stamp_invoice_ownership");
    expect(sql).toContain("acting_waiter.id");
    expect(sql).toContain("acting_waiter.display_name");
  });

  it("applies hold or payment-first behavior from canonical timing", () => {
    expect(sql).toContain("resolve_order_payment_timing");
    expect(sql).toContain("resolved_timing = 'after_meal'");
    expect(sql).toContain("payment_status = 'held'");
    expect(sql).toContain("payment_status = 'pending'");
  });
});
