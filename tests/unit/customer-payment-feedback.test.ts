import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const popup = read("src/modules/public-qr-ordering/components/PublicPaymentPopup.tsx");
const page = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const proof = read("supabase/functions/submit-public-payment-proof/index.ts");
const feedbackMigration = read("supabase/migrations/067_public_order_feedback.sql");
const servedFeedbackFix = read("supabase/migrations/215_phase11_3d_feedback_served_lifecycle_fix.sql");
const reports = read("src/modules/owner/pages/OwnerDashboardPage.tsx");

describe("Phase 11.3C payment confirmation and feedback", () => {
  it("submits confirmation even when optional evidence is empty", () => {
    expect(page).toContain('order.invoice_id && order.payment_method !== "Cash"');
    expect(popup).toContain("A transaction reference is preferred");
    expect(popup).toContain("Upload Payment Screenshot");
    expect(popup).toContain("Cancel");
  });

  it("records a submitted timestamp and verification state idempotently", () => {
    expect(proof).toContain('payment_recorded_at: submittedAt');
    expect(proof).toContain('payment_status: "held"');
    expect(proof).toContain('verificationStatus: "submitted"');
    expect(proof).toContain("alreadySubmitted");
    expect(proof).toContain('.eq("restaurant_id", invoice.restaurant_id)');
  });

  it("preserves bank-app return state", () => {
    expect(page).toContain("serveflow.payment-popup:");
    expect(popup).toContain(`${"${persistenceKey}"}:reference`);
    expect(popup).toContain(`${"${persistenceKey}"}:proof`);
    expect(page).toContain("usePublicQrCart");
  });

  it("allows one served-order review and exposes tenant-scoped owner reporting", () => {
    expect(feedbackMigration).toContain("orders.status::text = 'completed'");
    expect(feedbackMigration).toContain("unique (restaurant_id, order_id)");
    expect(feedbackMigration).toContain("on conflict (restaurant_id, order_id) do nothing");
    expect(servedFeedbackFix).toContain("orders.operational_status in ('served', 'closed')");
    expect(servedFeedbackFix).toContain("orders.browser_session_token = normalized_browser_token");
    expect(page).toContain("sessionKey: checkout.browserSessionToken");
    expect(page).toContain("Rate Your Experience");
    expect(page).toContain("Submit Feedback");
    expect(page).toContain("Skip");
    expect(page).toContain('["completed", "served", "closed"].includes(activeSession.status)');
    expect(page).toContain('modernNavigation.navigate("orders")');
    expect(page).toContain("feedbackPrompt={servedFeedbackOrder ? (");
    expect(reports).toContain("Customer Feedback");
    expect(reports).toContain("Highest Rated Item");
    expect(reports).toContain("Lowest Rated Item");
    expect(reports).toContain("Most Reviewed Item");
    expect(reports).toContain('.eq("restaurant_id", restaurantId)');
  });
});
