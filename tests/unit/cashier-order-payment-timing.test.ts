import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/154_cashier_order_payment_timing_fix.sql",
  ),
  "utf8",
).toLowerCase();

describe("cashier order payment timing", () => {
  it("keeps cashier and QR orders on the payment-first path", () => {
    expect(migration).toContain("in ('public_qr', 'cashier')");
    expect(migration).toContain("then 'before_kitchen'");
  });

  it("keeps deferred policy scoped to waiter orders", () => {
    expect(migration).toContain("target_order_source, '') = 'waiter'");
    expect(migration).toContain("restaurants.payment_policy = 'hold_payment'");
    expect(migration).toContain("restaurants.mixed_waiter_payment_timing");
  });
});
