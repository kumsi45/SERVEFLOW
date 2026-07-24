import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("production source contracts", () => {
  it("keeps all application realtime channels inside RestaurantEventService", () => {
    const output = execFileSync("rg", ["-l", "\\.channel\\(|postgres_changes", "src"], { cwd: root, encoding: "utf8" });
    expect(output.trim().replaceAll("\\", "/")).toBe("src/core/realtime/restaurantEventService.ts");
  });
  it("keeps kitchen independent from payment and invoices", () => {
    const source = read("src/modules/kitchen/services/kitchenOrderService.ts") + read("src/modules/kitchen/pages/KitchenDashboardPage.tsx");
    expect(source).not.toMatch(/payment_status|order_invoices|invoice_status/);
  });
  it("keeps Phase 7A.3 kitchen RPCs canonical and exact-batch", () => {
    const sql = read("supabase/migrations/150_phase7a3_canonical_lifecycle_finalization.sql");
    expect(sql).toContain("orders.operational_status in ('accepted', 'preparing', 'ready')");
    expect(sql).toContain("orders.dining_session_status = 'open'");
    expect(sql).toContain("orders.table_released_at is null");
    expect(sql).not.toContain("date_trunc('day', now())");
    expect(sql).toContain("order_invoices.payment_status = 'paid'");
    expect(sql).toContain("orders.order_source <> 'public_qr'");
    expect(sql).toContain("invoices.payment_status = 'paid'");
    expect(sql).toContain("target_order.order_source <> 'public_qr'");
    expect(sql).toContain("coalesce(target_batch_key, 'initial')");
    expect(sql).toContain("batches.kitchen_batch_key = 'initial'");
    expect(sql).toContain("array['accepted']");
    expect(sql).toContain("raise exception 'Wrong station.'");
    expect(sql).toContain("raise exception 'Batch already preparing.'");
    expect(sql).toContain("raise exception 'Batch already ready.'");
    expect(sql).toContain("raise exception 'Batch completed.'");
    expect(sql).toContain("orders.operational_status in ('served', 'closed')");
    expect(sql).toContain("orders.dining_session_status <> 'open'");
    expect(sql).toContain("set kitchen_status = 'held'");
    expect(sql).toContain("set kitchen_status = 'completed'");
    expect(sql).not.toContain("No pending items were found for this station.");
    const queueStart = sql.indexOf("drop function if exists public.get_station_kitchen_orders");
    const queueAndActions = sql.slice(queueStart);
    expect(queueAndActions).not.toMatch(/orders\.status|orders\.status::text|target_order\.status|order_invoices\.status = 'verified'|verified_at is not null|kitchen_status = 'paid'|kitchen_status in \('paid'/i);
  });
  it("keeps QR permanently pay-before while waiter orders follow tenant policy", () => {
    const policySql = read("supabase/migrations/161_waiter_order_lifecycle_engine.sql");
    const qrRule = policySql.indexOf("when coalesce(target_order_source, '') in ('public_qr', 'cashier')");
    const restaurantRules = policySql.indexOf("restaurants.payment_policy = 'kitchen_before_payment'");
    expect(qrRule).toBeGreaterThan(-1);
    expect(restaurantRules).toBeGreaterThan(qrRule);
    expect(policySql).toContain("invoices.invoice_source = 'waiter'");
    expect(policySql).toContain("set kitchen_status = 'held'");
  });
  it("keeps station status independent in the canonical kitchen UI payload", () => {
    const sql = read("supabase/migrations/151_phase7a4_canonical_kitchen_ui_contract.sql");
    expect(sql).toContain("'operational_status', orders.operational_status");
    expect(sql).toContain("'status', queue_row.status");
    expect(sql).toContain("- 'payment_method' - 'payment_verified_at'");

    const service = read("src/modules/kitchen/services/kitchenOrderService.ts");
    expect(service).toContain("isKitchenOrderStatus(row.status)");
    expect(service).not.toContain("canonicalOperationalStatus(row.operational_status)");
  });
  it("writes complete order audit pairs for every kitchen transition", () => {
    const sql = read("supabase/migrations/152_phase7a4_kitchen_transition_audit_pairs.sql");
    for (const prefix of ["preparation_started", "ready_marked", "completed"]) {
      expect(sql).toContain(`${prefix}_at = case`);
      expect(sql).toContain(`${prefix}_by = case`);
      expect(sql).toContain(`coalesce(${prefix}_by, acting_staff_id)`);
    }
  });
  it("keeps runtime kitchen state named accepted outside payment lifecycle", () => {
    const runtimeSources = [
      "src/modules/manager/services/managerKitchenSupervisionService.ts",
      "src/modules/manager/services/managerDashboardService.ts",
      "src/modules/manager/services/managerStaffOperationsService.ts",
      "src/modules/manager/services/managerAiOperationsService.ts",
      "src/modules/waiter-dashboard/services/waiterDashboardService.ts",
      "src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx",
    ].map(read).join("\n");
    expect(runtimeSources).toContain("accepted");
    expect(runtimeSources).not.toMatch(/kitchen_status['"], \["paid"|kitchenStatus === "paid"|statuses\.includes\("paid"\)|itemStatus\) => itemStatus === "paid"|value\) => value === "paid"/);
  });
  it("filters every realtime subscription by restaurant", () => {
    const files = ["OwnerDashboardPage.tsx", "CashierDashboardPage.tsx", "KitchenDashboardPage.tsx"];
    for (const file of files) {
      const module = file.startsWith("Owner") ? "owner" : file.startsWith("Cashier") ? "cashier" : "kitchen";
      const source = read(`src/modules/${module}/pages/${file}`);
      const subscriptions = source.match(/"postgres_changes"[\s\S]{0,180}?}/g) ?? [];
      if (subscriptions.length) {
        expect(subscriptions.every((value) => value.includes("filter:"))).toBe(true);
        expect(source).toContain("restaurant_id=eq.");
      } else {
        expect(source).toMatch(/getRestaurantEventStream|createRestaurantEventConsumer|useTenantRealtime|useRestaurantEvents/);
      }
    }
  });
  it("defines canonical historical timestamps", () => {
    const sql = read("supabase/migrations/139_canonical_historical_analytics.sql");
    expect(sql).toContain("i.paid_at>=range_start");
    expect(sql).toContain("o.created_at>=range_start");
    expect(sql).toContain("x.kitchen_completed_at>=range_start");
    expect(sql).toContain("o.dining_session_closed_at>=range_start");
    expect(sql).not.toMatch(/verified_at\s*>?=\s*range_start/);
  });
  it("uses one tenant realtime recovery implementation across manager surfaces", () => {
    const managerPages = ["ManagerDashboardPage.tsx", "ManagerOperationsCenterPage.tsx", "ManagerStaffOperationsPage.tsx", "ManagerRestaurantIntelligencePage.tsx", "ManagerOperationalReportsPage.tsx", "ManagerCustomerExperiencePage.tsx", "ManagerKitchenSupervisionPage.tsx", "ManagerAiOperationsPage.tsx"];
    for (const page of managerPages) {
      const source = read(`src/modules/manager/pages/${page}`);
      expect(source).toContain("useTenantRealtime");
      expect(source).not.toContain(".channel(");
    }
    const shared = read("src/core/realtime/useTenantRealtime.ts");
    const eventService = read("src/core/realtime/restaurantEventService.ts");
    expect(shared).toContain("useRestaurantEvents");
    expect(eventService).toContain("restaurant_id=eq.");
    expect(eventService).toContain("rowTenant !== restaurantId");
    expect(eventService).toContain('addEventListener("online"');
    expect(eventService).toContain('addEventListener("visibilitychange"');
    expect(eventService).toContain("removeChannel");
  });
  it("keeps feedback photos private and tenant-readable", () => {
    const sql = read("supabase/migrations/142_phase5_feedback_storage_tenant_isolation.sql");
    expect(sql).toContain("set public = false");
    expect(sql).toContain("has_staff_role");
    expect(sql).toContain("public_order_feedback_photo_tenant_path");
  });
});
