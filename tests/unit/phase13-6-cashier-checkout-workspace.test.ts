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

describe("Phase 13.6B cashier checkout slide-over drawer", () => {
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

  it("uses dialog semantics, focus return, escape close, and one footer secondary action", () => {
    expect(drawerMarkup).toContain('role="dialog"');
    expect(drawerMarkup).toContain('aria-modal="true"');
    expect(drawerMarkup).toContain('aria-labelledby="cashier-checkout-drawer-title"');
    expect(drawerMarkup).toContain('aria-label="Close checkout"');
    expect(page).toContain('event.key === "Escape" && drawerOrder');
    expect(page).toContain("checkoutOpenerRef.current?.focus()");
    expect(drawerMarkup).toContain("secondaryActionLabel");
    expect(drawerMarkup.match(/cd-checkout-primary-action/g)).toHaveLength(1);
    expect(drawerMarkup.match(/className="cd-checkout-secondary-action"/g)).toHaveLength(1);
    expect(drawerMarkup).not.toContain("cd-checkout-secondary-actions");
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
      "View Receipt",
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
      "Payment Evidence",
      "Reference Number",
      "Screenshot",
      "Uploaded",
      "Not provided",
      "View Screenshot",
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
    expect(drawerMarkup).toContain('collectionPaymentMethod !== "Cash"');
    expect(drawerMarkup).toContain("Cash selected. No reference or screenshot fields are shown");
  });

  it("uses the fixed slide-over dimensions without reserving grid space", () => {
    expect(styles).toContain(".cd-checkout-slide-over");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("width: clamp(500px, 42vw, 680px)");
    expect(styles).toContain("height: calc(100dvh - 72px)");
    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).not.toContain(".cd-workspace-empty");
    expect(styles).not.toContain(".cd-checkout-skeleton");
    expect(styles).not.toContain(".cd-checkout-payment-section");
  });

  it("keeps screenshot preview read-only with fit, zoom, escape, and focus return", () => {
    expect(drawerMarkup).toContain('aria-label="Payment screenshot preview"');
    expect(drawerMarkup).toContain("screenshotFitMode");
    expect(drawerMarkup).toContain("Zoom");
    expect(drawerMarkup).toContain("Fit to screen");
    expect(drawerMarkup).toContain("closeScreenshotPreview");
    expect(drawerMarkup).toContain("screenshotTriggerRef.current?.focus()");
    expect(drawerMarkup).not.toContain("storage_path");
  });
});
