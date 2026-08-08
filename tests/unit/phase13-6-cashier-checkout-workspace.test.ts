import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const drawerMarkup = page.slice(
  page.indexOf("function CheckoutSlideOverDrawer"),
  page.indexOf("export function CashierDashboardPage"),
);
const renderedPage = page.slice(page.indexOf("return ("));

describe("Phase 13.6C complete cashier checkout slide-over drawer", () => {
  it("removes the permanent checkout workspace and keeps the drawer conditional", () => {
    expect(page).toContain("function CheckoutSlideOverDrawer");
    expect(page).not.toContain("function OrderDrawer");
    expect(page).not.toContain("CheckoutWorkspaceSkeleton");
    expect(page).not.toContain("No checkout selected");
    expect(page).not.toContain("Begin Checkout");
    expect(renderedPage).toContain('<aside className="cd-right-panel" aria-label="Service locations">');
    expect(renderedPage).toContain("!loading && drawerOrder ? (");
    expect(renderedPage).toContain("<CheckoutSlideOverDrawer");
  });

  it("uses dialog semantics, focus return, escape close, and explicit workflow actions", () => {
    expect(drawerMarkup).toContain('role="dialog"');
    expect(drawerMarkup).toContain('aria-modal="true"');
    expect(drawerMarkup).toContain('aria-labelledby="cashier-checkout-drawer-title"');
    expect(drawerMarkup).toContain('aria-label="Close checkout"');
    expect(page).toContain('event.key === "Escape" && drawerOrder');
    expect(page).toContain("checkoutOpenerRef.current?.focus()");
    expect(drawerMarkup.match(/cd-checkout-primary-action/g)).toHaveLength(1);
    expect(drawerMarkup.match(/cd-checkout-secondary-action/g)).toHaveLength(1);
    expect(drawerMarkup).toContain('className="cd-checkout-footer-actions"');
    expect(drawerMarkup).not.toContain("Close/Release Table");
    expect(drawerMarkup).toContain("Print Bill");
    expect(drawerMarkup).toContain("Print Receipt");
    expect(drawerMarkup).toContain('checkoutStatus === "completed"');
  });

  it("supports all context-aware modes with existing authoritative callbacks", () => {
    for (const label of [
      "Payment Due",
      "Bill Requested",
      "Receipt Pending",
      "Paid",
      "Completed",
      "Verify Payment",
      "Print Bill",
      "Print Receipt",
      "Close",
    ]) {
      expect(page).toContain(label);
    }
    for (const handler of [
      "handleApprove(drawerOrder)",
      "handleRejectPayment(drawerOrder)",
      "handleRequestRetry(drawerOrder)",
      "handlePrintFinalBill(drawerDiningSession)",
    ]) {
      expect(page).toContain(handler);
    }
    expect(drawerMarkup).not.toContain("supabase.rpc");
    expect(drawerMarkup).not.toContain("supabase.from");
  });

  it("keeps customer payment evidence read-only and removes cashier upload controls", () => {
    for (const label of [
      "Payment Verification",
      "Payment Evidence",
      "Reference Number",
      "Transaction ID",
      "Screenshot",
      "Uploaded",
      "Not provided",
      "View Screenshot",
      "Not Selected",
    ]) {
      expect(drawerMarkup).toContain(label);
    }
    for (const forbidden of [
      "Upload Screenshot",
      "Replace Screenshot",
      "Delete Screenshot",
      "drag",
      'type="file"',
      "onPaymentScreenshotFileChange",
    ]) {
      expect(drawerMarkup).not.toContain(forbidden);
    }
    expect(drawerMarkup).toContain('displayPaymentMethod !== "Cash"');
    expect(drawerMarkup).not.toContain("Cash selected. No reference or screenshot fields are shown");
    expect(drawerMarkup).not.toContain("cd-cash-review-note");
  });

  it("renders transaction metadata, six-item disclosure, 30+ item support, and clean source labels", () => {
    expect(page).toContain("function checkoutOrderSource");
    expect(page).toContain("function checkoutTransactionMetadata");
    expect(drawerMarkup).toContain("checkoutOrderSource(order)");
    expect(drawerMarkup).toContain("checkoutTransactionMetadata(order, checkoutStatus, workflowEntry)");
    expect(drawerMarkup).not.toContain("Order Information");
    expect(drawerMarkup).not.toContain("cd-order-information");
    expect(drawerMarkup).not.toContain("cd-order-info-items");
    expect(drawerMarkup).toContain("Order Items");
    expect(drawerMarkup).toContain("visibleItems.map");
    expect(drawerMarkup).toContain("order.items.slice(0, 6)");
    expect(drawerMarkup).toContain("Show fewer items");
    expect(drawerMarkup).toContain("hiddenItemCount");
    expect(drawerMarkup).toContain("itemsExpanded");
    expect(drawerMarkup).toContain("aria-expanded={itemsExpanded}");
    expect(drawerMarkup).not.toContain("orderSourceIcon");
    expect(drawerMarkup).not.toContain("{orderSourceIcon}");
  });

  it("does not default waiter or customer payment due orders to Cash", () => {
    expect(page).toContain('const [collectionPaymentMethod, setCollectionPaymentMethod] = useState("");');
    expect(page).toContain('setCollectionPaymentMethod(drawerOrder?.paymentMethod?.trim() || "")');
    expect(page).toContain("dueMethods.length === dueBatches.length");
    expect(page).toContain("new Set(dueMethods).size === 1");
    expect(page).toContain("paymentMethod: authoritativeMethod");
    expect(drawerMarkup).toContain("availablePaymentMethods");
    expect(drawerMarkup).toContain("onClick: displayPaymentMethod ? onApprove : undefined");
    expect(drawerMarkup).toContain("Boolean(paymentMethodIssue)");
  });

  it("renders queue-specific workflow content without editable controls outside Payment Due", () => {
    expect(drawerMarkup).toContain('checkoutStatus === "payment-due"');
    expect(drawerMarkup).toContain('checkoutStatus === "bill-requested"');
    expect(drawerMarkup).toContain('checkoutStatus === "receipt-pending"');
    expect(drawerMarkup).toContain('checkoutStatus === "completed"');
    for (const label of ["Payment Verification", "Bill Request", "Requested by", "Payment Details", "Verified By", "Transaction Details", "Receipt"]) {
      expect(drawerMarkup).toContain(label);
    }
    expect(drawerMarkup).toContain('showPaymentSelector = checkoutStatus === "payment-due"');
  });

  it("keeps the drawer open after verification when refreshed receipt action remains", () => {
    expect(page).toContain("const refreshed = await loadDashboard()");
    expect(page).toContain("receipt_pending_queue");
    expect(page).toContain("setDrawerOrder(refreshedOrder)");
    expect(page).toContain("closeCheckoutDrawerAfterAction(1000)");
    expect(page).not.toContain("setDrawerOrder(null);\n      setPaymentReference(\"\");");
  });

  it("keeps bill and receipt printing separate and closes only after a successful receipt", () => {
    expect(page).toContain("return true;");
    expect(page).toContain("return false;");
    expect(page).toContain("if (printed) closeCheckoutDrawerAfterAction(1000)");
    expect(page).toContain('title: "Bill sent to printer"');
    expect(page).toContain('title: "Bill printing failed"');
    expect(page).toContain('title: "Receipt printing failed"');
  });

  it("uses the fixed slide-over dimensions without reserving grid space", () => {
    expect(styles).toContain(".cd-checkout-slide-over");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("z-index: 620");
    expect(styles).toContain("width: clamp(520px, 42vw, 620px)");
    expect(styles).toContain("height: calc(100dvh - 72px)");
    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain(".cd-checkout-footer-actions");
    expect(styles).toContain("grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).not.toContain(".cd-workspace-empty");
    expect(styles).not.toContain(".cd-checkout-skeleton");
    expect(styles).not.toContain(".cd-checkout-payment-section");
    expect(styles).not.toContain(".cd-checkout-overlay");
    expect(styles).not.toContain(".cd-checkout-dialog");
    expect(styles).not.toContain(".cd-checkout-actions");
  });

  it("keeps screenshot preview read-only with fit, zoom, escape, and focus return", () => {
    expect(drawerMarkup).toContain('aria-label="Payment screenshot preview"');
    expect(drawerMarkup).toContain("screenshotFitMode");
    expect(drawerMarkup).toContain("Zoom out");
    expect(drawerMarkup).toContain("Zoom in");
    expect(drawerMarkup).toContain("Fit to screen");
    expect(drawerMarkup).toContain("closeScreenshotPreview");
    expect(drawerMarkup).toContain("screenshotTriggerRef.current?.focus()");
    expect(drawerMarkup).not.toContain("storage_path");
  });
});
