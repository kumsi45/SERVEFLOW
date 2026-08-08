import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read(
  "supabase/migrations/224_cashier_payment_method_and_automatic_table_release.sql",
);
const nullableOrderMethodMigration = read(
  "supabase/migrations/225_nullable_order_payment_method.sql",
);
const settledReleaseMigration = read(
  "supabase/migrations/226_settled_service_location_auto_release.sql",
);
const cashier = read("src/modules/cashier/pages/CashierDashboardPage.tsx");

describe("cashier waiter payment and automatic service-location release", () => {
  it("creates waiter batches without fabricating a payment method", () => {
    expect(migration).toContain("submit_waiter_order_batch_phase224_base");
    expect(migration).toContain("set payment_method = null");
    expect(migration).toContain("invoices.payment_status in ('pending', 'held')");
    expect(migration).toContain("'payment_method', null");
    expect(migration).toContain("when i.payment_status in(''pending'',''held'') then public.normalize_payment_method(i.payment_method)");
    expect(nullableOrderMethodMigration).toContain("alter column payment_method drop default");
    expect(nullableOrderMethodMigration).toContain("alter column payment_method drop not null");
  });

  it("shows Not Selected and requires an enabled tenant payment method", () => {
    expect(cashier).toContain('{showPaymentSelector ? "Not Selected" : "Not recorded"}');
    expect(cashier).toContain("onClick: displayPaymentMethod && !requiresCustomerReference ? onApprove : undefined");
    expect(cashier).toContain('isDigital && orderSourceLabel !== "Waiter" && !displayReference');
    expect(cashier).toContain("No checkout payment methods are enabled for this business.");
    expect(cashier).toContain('throw new Error("Select the payment method before verifying.")');
    expect(cashier).toContain('supabase.rpc("get_cashier_checkout_payment_methods"');
    expect(cashier).toContain('method_code: "recorded_workflow_method"');
    expect(migration).toContain("Select a payment method before verifying payment.");
    expect(migration).toContain("The selected payment method is not enabled for this business.");
  });

  it("stores the cashier selection on invoices and refreshes drawer and queue state", () => {
    expect(migration).toContain("verify_dining_session_payment_phase224_base");
    expect(migration).toContain("set payment_method = normalized_method");
    expect(cashier).toContain("selected_payment_method: selectedMethod");
    expect(cashier).toContain("const refreshed = await loadDashboard()");
    expect(cashier).toContain('"orders", "order_invoices", "order_items"');
  });

  it("automatically releases only a fully settled and completed service location", () => {
    expect(migration).toContain("remaining_unpaid_count = 0");
    expect(migration).toContain("remaining_active_item_count = 0");
    expect(migration).toContain("remaining_open_order_count = 0");
    expect(migration).toContain("public.close_dining_session(");
    expect(migration).toContain("cashier_payment_verified_auto_release");
    expect(migration).toContain("'table_released'");
  });

  it("keeps the table occupied and reports another open order or active item", () => {
    expect(migration).toContain("orders.id <> target_session.id");
    expect(migration).toContain("orders.dining_session_status = 'open'");
    expect(migration).toContain("items.kitchen_status <> 'completed'");
    expect(migration).toContain("'other_open_order'");
    expect(migration).toContain("'active_items'");
    expect(cashier).toContain("other open order(s) remain");
    expect(cashier).toContain("active item(s) remain");
  });

  it("releases after the final prerequisite whether payment or service finishes last", () => {
    expect(settledReleaseMigration).toContain("try_auto_release_settled_service_location");
    expect(settledReleaseMigration).toContain("auto_release_service_location_after_item_terminal_trigger");
    expect(settledReleaseMigration).toContain("items_terminal_after_payment_auto_release");
    expect(settledReleaseMigration).toContain("cashier_payment_verified_auto_release");
    expect(settledReleaseMigration).toContain("coalesce(target_session.dining_session_status, ''open'') = ''open''");
    expect(settledReleaseMigration).toContain("not in ('completed', 'served', 'delivered')");
    expect(settledReleaseMigration).toContain("other_orders.table_released_at is null");
    expect(settledReleaseMigration).toContain("settled_service_location_backfill");
    expect(cashier).toContain("Release Table");
    expect(cashier).toContain("handleCloseDiningSessionFromBill(drawerDiningSession)");
  });

  it("keeps bill and receipt printing separate from release authority", () => {
    const printHandler = cashier.slice(
      cashier.indexOf("async function handlePrintFinalBill"),
      cashier.indexOf("async function handleCloseDiningSessionFromBill"),
    );
    expect(printHandler).toContain("print_final_dining_bill");
    expect(printHandler).toContain("mark_cashier_session_receipts_printed");
    expect(printHandler).not.toContain("close_dining_session");
    expect(printHandler).not.toContain("cashier_close_invoice_and_release_table");
  });

  it("keeps verification idempotent after invoices are already paid", () => {
    expect(migration).toContain("'idempotent', true");
    expect(migration).toContain("invoices.payment_status = 'paid'");
    expect(migration).toContain("is distinct from normalized_method");
  });
});
