import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const phaseStyles = styles.slice(styles.indexOf("Phase 13.6"));
const drawerMarkup = page.slice(
  page.indexOf("function OrderDrawer"),
  page.indexOf("function CheckoutReceiptPreview"),
);

describe("Phase 13.6 cashier checkout workspace", () => {
  it("uses the requested hospitality status model and status colors", () => {
    for (const status of [
      "Payment Due",
      "Bill Requested",
      "Receipt Pending",
      "Paid",
      "Completed",
    ]) {
      expect(page).toContain(status);
    }
    for (const color of ["#d97706", "#2563eb", "#9333ea", "#22a06b", "#6b7280"]) {
      expect(phaseStyles.toLowerCase()).toContain(color);
    }
    expect(drawerMarkup).toContain("Payment status: ${statusLabel}");
    expect(drawerMarkup).toContain('<i aria-hidden="true" />');
  });

  it("keeps one status-driven primary action and no more than two supported secondary actions", () => {
    expect(drawerMarkup.match(/className="cd-checkout-primary-action"/g)).toHaveLength(1);
    expect(drawerMarkup).toContain('checkoutStatus === "payment-due"');
    expect(drawerMarkup).toContain('checkoutStatus === "bill-requested"');
    expect(drawerMarkup).toContain('checkoutStatus === "completed"');
    expect(drawerMarkup).toContain(".slice(0, 2)");
    expect(phaseStyles).toContain("min-height: 52px");
  });

  it("shows a selectable method for staff orders and a recorded method for customer QR orders", () => {
    expect(drawerMarkup).toContain('order.invoiceSource === "public_qr"');
    expect(drawerMarkup).toContain('order.orderSource === "public_qr"');
    expect(drawerMarkup).toContain("isPending && !isCustomerQr");
    expect(drawerMarkup).toContain("Customer-selected method");
    expect(drawerMarkup).toContain("Select the method used for collection");
    expect(drawerMarkup).toContain("order.customerName || \"QR order\"");
  });

  it("renders the itemized bill with a dominant right-aligned total", () => {
    for (const label of ["Order Items", "Subtotal", "VAT", "Service Charge", "Discount", "Bill Summary"]) {
      expect(drawerMarkup).toContain(label);
    }
    expect(phaseStyles).toContain("font-size: 40px");
    expect(phaseStyles).toContain("font-weight: 700");
    expect(phaseStyles).toContain("text-align: right");
  });

  it("uses skeleton loading and the required centered empty state", () => {
    expect(page).toContain("CheckoutWorkspaceSkeleton");
    expect(page).toContain('aria-busy="true"');
    expect(page).toContain("No checkout selected");
    expect(page).toContain("Select a service location to begin checkout.");
    expect(page).toContain("Begin Checkout");
    expect(phaseStyles).toContain("cd-checkout-skeleton");
  });

  it("retains the existing workflow callbacks without adding a data layer", () => {
    for (const handler of [
      "handleApprove(drawerOrder)",
      "handleRejectPayment(drawerOrder)",
      "handleRequestRetry(drawerOrder)",
      "handlePrintFinalBill(drawerDiningSession)",
      "handleCloseDiningSessionFromBill(drawerDiningSession)",
    ]) {
      expect(page).toContain(handler);
    }
    expect(drawerMarkup).not.toContain("supabase.rpc");
    expect(drawerMarkup).not.toContain("supabase.from");
  });
});
