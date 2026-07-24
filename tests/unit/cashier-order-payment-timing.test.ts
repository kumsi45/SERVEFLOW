import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/161_waiter_order_lifecycle_engine.sql",
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
    expect(migration).toContain("restaurants.payment_policy = 'kitchen_before_payment'");
    expect(migration).not.toContain("then restaurants.mixed_waiter_payment_timing");
  });
});
