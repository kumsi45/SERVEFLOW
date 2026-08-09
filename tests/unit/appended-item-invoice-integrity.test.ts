import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/227_appended_item_invoice_integrity.sql",
  "utf8",
);

describe("appended item invoice integrity", () => {
  it("starts a new invoice when the latest invoice is no longer mutable", () => {
    expect(migration).toContain("latest_invoice.status <> 'pending'");
    expect(migration).toContain("latest_invoice.payment_status");
    expect(migration).toContain("not in ('pending', 'held')");
  });

  it("fails atomically instead of inserting with a missing invoice", () => {
    expect(migration).toContain("if current_invoice.id is null then");
    expect(migration).toContain(
      "A mutable invoice could not be created for the appended items.",
    );
  });

  it("rejects future invoice-less appended rows at the table boundary", () => {
    expect(migration).toContain("enforce_appended_item_invoice_integrity");
    expect(migration).toContain(
      "new.appended_at is not null and new.invoice_id is null",
    );
    expect(migration).toContain(
      "before insert or update of invoice_id, appended_at on public.order_items",
    );
  });
});
