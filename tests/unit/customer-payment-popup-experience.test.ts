import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const popup = readFileSync(resolve(process.cwd(), "src/modules/public-qr-ordering/components/PublicPaymentPopup.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "src/modules/public-qr-ordering/components/publicPaymentPopup.css"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/modules/qr-menu/pages/QRMenuPage.tsx"), "utf8");
const projection = readFileSync(resolve(process.cwd(), "supabase/migrations/212_phase11_3a_customer_payment_projection.sql"), "utf8");
const securedProjection = readFileSync(resolve(process.cwd(), "supabase/migrations/213_phase11_3a_remove_public_internal_id.sql"), "utf8");
const proofFunction = readFileSync(resolve(process.cwd(), "supabase/functions/submit-public-payment-proof/index.ts"), "utf8");

describe("Phase 11.3A customer payment popup", () => {
  it("matches the V1 payment experience without QR or reference-format display", () => {
    for (const text of ["Payment Method", "Owner Name", "Account Number", "Copy Account Number", "Copy Number", "Open Telebirr", "I Have Paid", "Please pay at the cashier.", "Order Total"]) expect(popup).toContain(text);
    expect(popup).not.toContain("Download QR");
    expect(popup).not.toContain("Reference Format");
    expect(popup).not.toContain("qrImageUrl");
    expect(popup).toContain("copyPaymentValue");
    expect(popup).toContain('document.execCommand("copy")');
    expect(popup).toContain("Payment number copied to your clipboard.");
  });

  it("supports proof, empty, error, loading and duplicate-submit states", () => {
    expect(popup).toContain("Upload Payment Screenshot");
    expect(popup).toContain("Transaction Reference Number");
    expect(popup).toContain("No payment method is currently available.");
    expect(popup).toContain('role="alert"');
    expect(popup).toContain("Loading payment methods");
    expect(popup).toContain("Try Again");
    expect(popup).toContain("Payment submitted");
    expect(page).toContain("submittingRef.current");
    expect(page).toContain("submitPublicPaymentProof");
  });

  it("persists the popup and cart context across external app switching", () => {
    expect(page).toContain("serveflow.payment-popup:");
    expect(page).toContain("window.localStorage.setItem");
    expect(popup).toContain(":reference");
    expect(popup).toContain(":proof");
  });

  it("is a mobile bottom sheet and desktop centered modal", () => {
    expect(styles).toContain("place-items:center");
    expect(styles).toContain("@media(max-width:680px)");
    expect(styles).toContain("place-items:end center");
    expect(styles).toContain("env(safe-area-inset-bottom)");
  });

  it("returns only configured active V1 account details", () => {
    expect(projection).toContain("method.enabled");
    expect(projection).toContain("account.status = 'active'");
    expect(projection).toContain("account.deleted_at is null");
    expect(projection).not.toContain("'qr_image_url'");
    expect(projection).not.toContain("'reference_format'");
    expect(securedProjection).not.toContain("'restaurant_id'");
    expect(projection).not.toContain("'restaurant_id'");
  });

  it("validates tenant session before accepting safe payment evidence", () => {
    expect(proofFunction).toContain('rpc("get_public_qr_order_session"');
    expect(proofFunction).toContain('from("payment-screenshots")');
    expect(proofFunction).toContain("5 * 1024 * 1024");
    expect(proofFunction).toContain('.eq("restaurant_id", invoice.restaurant_id)');
  });
});
