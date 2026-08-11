import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const realtime = read("src/core/realtime/restaurantEventService.ts");
const service = read("src/modules/cashier/services/cashierCancellationService.ts");
const migration = read("supabase/migrations/231_phase_cancellation_cashier_review.sql");

describe("Phase 2 cashier cancellation requests modal", () => {
  it("opens from the existing sidebar button without replacing the dashboard", () => {
    expect(page).toContain('onClick={openCancellationRequests}');
    expect(page).toContain('className="cd-cancellation-overlay"');
    expect(page).toContain('role="dialog"');
    expect(page).toContain('aria-modal="true"');
    expect(page).toContain('<main className="cd-body">');
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("place-items: center");
  });

  it("shows the complete compact horizontal review sequence", () => {
    for (const heading of [
      "Table",
      "Requester",
      "Item(s)",
      "Reason",
      "Payment",
      "Kitchen",
      "Amount",
      "Waiting",
      "Authority / Action",
    ]) expect(page).toContain(`<th>${heading}</th>`);
    expect(styles).toContain("min-width: 1220px");
    expect(styles).toContain("height: 68px");
  });

  it("uses server-returned authority and requires confirmation for direct cancellation", () => {
    expect(page).toContain('request.authority === "cashier_direct"');
    expect(page).toContain("Cancel Directly");
    expect(page).toContain("Confirm Cancellation");
    expect(page).toContain("Keep Request");
    expect(page).toContain("Manager Approval Required");
    expect(page).toContain("Financial Approval Required");
    expect(page).toContain("Send to Manager");
    expect(service).toContain('supabase.rpc("cashier_handle_cancellation_request"');
  });

  it("uses the secure queue RPC for both the modal and realtime badge", () => {
    expect(service).toContain('supabase.rpc("get_cashier_cancellation_requests"');
    expect(page).toContain("const pendingCancellationCount = cancellationRequests.length");
    expect(page).toContain('"order_cancellation_requests"');
    expect(realtime).toContain('"order_cancellation_requests"');
  });

  it("enforces tenant, cashier, payment, kitchen, immutable requester, and race rules in SQL", () => {
    expect(migration).toContain("where restaurant_id = target_restaurant_id and user_id = auth.uid()");
    expect(migration).toContain("cashier_handle_cancellation_request");
    expect(migration).toContain("evaluate_cancellation_request");
    expect(migration).toContain("for update");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("financial_approval_required");
    expect(migration).toContain("manager_approval_required");
    expect(migration).toContain("Cancellation request origin is immutable");
    expect(migration).toContain("table_released', false");
    expect(migration).toContain("refund_created', false");
  });

  it("has a close control, internal scrolling, sticky headings, and a mobile full-screen mode", () => {
    expect(page).toContain('aria-label="Close cancellation requests"');
    expect(styles).toContain(".cd-cancellation-scroll");
    expect(styles).toContain("overflow: auto");
    expect(styles).toContain(".cd-cancellation-table th");
    expect(styles).toContain("position: sticky");
    expect(styles).toContain("@media (max-width: 720px)");
    expect(styles).toContain("width: 100vw");
    expect(styles).toContain("height: 100dvh");
  });
});
