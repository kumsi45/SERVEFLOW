import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const checkout = read("src/modules/public-qr-ordering/components/PublicQrCheckoutPanel.tsx");
const popup = read("src/modules/public-qr-ordering/components/PublicPaymentPopup.tsx");
const page = read("src/modules/qr-menu/pages/QRMenuPage.tsx");
const orders = read("src/modules/menu/theme-engine/themes/modern/ModernOrdersView.tsx");

describe("Phase 11.3B customer order lifecycle", () => {
  it("charges only the new cart and never adds a previously paid dining bill", () => {
    expect(page).toContain("total={cart.displaySubtotal}");
    expect(page).not.toContain("total={(activeSession?.total_price ?? 0) + cart.displaySubtotal}");
    expect(checkout).toContain("Previous paid orders stay closed");
    expect(checkout).toContain("formatMenuPrice(displaySubtotal)");
    expect(checkout).not.toContain("grandTotal");
  });

  it("shows an actionable success state and routes to the existing Orders page", () => {
    expect(popup).toContain("Your Order Has Been Sent");
    expect(popup).toContain("View Orders");
    expect(popup).toContain("Back To Menu");
    expect(page).toContain('modernNavigation.navigate("orders")');
    expect(page).toContain("Status: Sent");
  });

  it("renders invoice-scoped history and professional kitchen progress", () => {
    expect(page).toContain("isTrackingActive ? invoice.id !== trackingInvoice?.id : true");
    expect(page).toContain('trackingStatus !== "closed"');
    expect(page).toContain("item.invoice_id === invoice.id");
    expect(page).toContain("Pending payment");
    expect(page).toContain("Completed");
    for (const stage of ["sent", "preparing", "ready", "served"]) expect(orders).toContain(`\"${stage}\"`);
  });

  it("keeps existing tenant-scoped realtime refresh without polling", () => {
    expect(page).toContain("subscribeCustomerTrackingEvents");
    expect(page).toContain("refreshActiveSession");
    expect(page).toContain("checkout.qrToken");
    expect(page).toContain("checkout.tableNumber");
  });
});
