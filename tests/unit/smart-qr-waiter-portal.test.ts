import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/216_phase12_1_smart_qr_waiter_portal.sql");
const page = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const portal = read("src/modules/public-qr-ordering/components/SmartCustomerPortal.tsx");
const paymentProof = read("supabase/functions/submit-public-payment-proof/index.ts");

describe("Phase 12.1 Smart QR waiter portal", () => {
  it("uses the existing dining session waiter authority for the QR decision", () => {
    expect(migration).toContain("active_order.created_by_waiter_id is null");
    expect(migration).toContain("'mode','waiter'");
    expect(migration).toContain("public.is_public_qr_dining_session_open(o.id)");
  });

  it("validates tenant, table, active QR, order and browser subscription", () => {
    expect(migration).toContain("t.restaurant_id = business.id");
    expect(migration).toContain("t.qr_token = normalized_qr");
    expect(migration).toContain("smart_qr_portal_subscriptions");
    expect(migration).toContain("enable row level security");
  });

  it("renders the portal instead of the digital menu for waiter sessions", () => {
    expect(page).toContain('smartPortal?.mode === "waiter"');
    expect(page).toContain("<SmartCustomerPortal");
    expect(portal).toContain("Your waiter has already created your order.");
  });

  it("reuses owner payment configuration and permits proof only for the verified waiter bill", () => {
    expect(page).toContain("paymentRuntime?.methods ?? []");
    expect(paymentProof).toContain('portal?.mode === "waiter"');
    expect(paymentProof).toContain("portal.invoices.some");
  });

  it("supports waiter calls, realtime subscription and served-only feedback", () => {
    expect(migration).toContain("waiter_assistance_requests");
    expect(migration).toContain("realtime.send");
    expect(portal).toContain('["served","closed"].includes(orderStatus)');
    expect(migration).toContain("submit_public_order_feedback");
  });
});
