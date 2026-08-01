import { describe, expect, it } from "vitest";
import {
  generateKitchenTicketPayload,
  generateReceiptPayload,
  paymentPolicyDecision,
  routeKitchenOutput,
  runtimeHealth,
} from "../../src/core/printing-payment/runtime";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Phase 11.3 printing and payment runtime", () => {
  it("keeps waiter-payment-due orders eligible for kitchen immediately", () => {
    expect(paymentPolicyDecision("kitchen_before_payment")).toEqual({ createBeforePayment: true, releaseToKitchen: true, paymentDue: true });
    expect(paymentPolicyDecision("pay_before_kitchen")).toMatchObject({ releaseToKitchen: false, paymentDue: false });
    expect(paymentPolicyDecision("mixed")).toMatchObject({ unsupported: true, releaseToKitchen: false });
  });

  it("routes KDS plus printing and selects the highest-priority online kitchen printer", () => {
    const routes = routeKitchenOutput({
      mode: "kds_and_printers", stationId: "bar",
      printers: [
        { id: "backup", purpose: "kitchen_order", enabled: true, status: "online", priority: 2 },
        { id: "primary", purpose: "kitchen_order", enabled: true, status: "online", priority: 1 },
      ], mappings: [],
    });
    expect(routes).toEqual([{ channel: "kds", stationId: "bar" }, { channel: "printer", printerId: "primary", stationId: "bar" }]);
  });

  it("routes station tickets only through the matching active tenant mapping", () => {
    expect(routeKitchenOutput({ mode: "station_printers", stationId: "station-a", printers: [
      { id: "printer-a", purpose: "station", enabled: true, status: "online", priority: 1 },
    ], mappings: [{ kitchenStationId: "station-a", printerId: "printer-a", active: true }] })).toEqual([
      { channel: "printer", printerId: "printer-a", stationId: "station-a" },
    ]);
  });

  it("generates a kitchen ticket without financial or payment fields", () => {
    const ticket = generateKitchenTicketPayload({ orderNumber: "K-100", table: "4", customerName: "Mimi", items: [
      { name: "Sandwich", quantity: 2, modifiers: ["No onion"], station: "Kitchen" },
    ], priority: "normal", station: "Kitchen", createdAt: "2026-08-01T10:00:00Z", waiter: "Hana" });
    expect(ticket).toMatchObject({ orderNumber: "K-100", station: "Kitchen" });
    for (const forbidden of ["price", "vat", "discount", "total", "payment"]) expect(JSON.stringify(ticket).toLowerCase()).not.toContain(forbidden);
  });

  it("generates immutable receipt models for supported copy types", () => {
    const receipt = generateReceiptPayload({ copyType: "merchant", businessName: "Ummi Cafe", orderNumber: "O-1", issuedAt: "2026-08-01T10:00:00Z", lines: [], subtotal: 100, vat: 15, serviceCharge: 0, discount: 0, total: 115, paymentMethod: "Cash" });
    expect(receipt).toMatchObject({ copyType: "merchant", total: 115 });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("computes runtime readiness from configured authorities", () => {
    expect(runtimeHealth({ receiptPrinters: [{ id: "r", purpose: "receipt", enabled: true, status: "online", priority: 1 }], kitchenRoutes: [{ channel: "kds" }], enabledPaymentMethods: 1, activePaymentAccounts: 0, menuPublished: true, qrOrderingReady: true, inventoryReady: true, staffReady: true })).toMatchObject({ receiptPrinterReady: true, kitchenOutputReady: true, paymentMethodReady: true, businessAccountReady: false });
  });

  it("keeps customer and staff runtime projections tenant scoped", () => {
    const publicSql = readFileSync(resolve(process.cwd(), "supabase/migrations/209_phase11_3_runtime_configuration.sql"), "utf8");
    const staffSql = readFileSync(resolve(process.cwd(), "supabase/migrations/210_phase11_3_staff_print_runtime_projection.sql"), "utf8");
    expect(publicSql).toContain("method.enabled");
    expect(publicSql).toContain("perform public.assert_public_payment_method_enabled");
    expect(staffSql).toContain("public.has_staff_role");
    expect(staffSql).not.toContain("network_host");
    expect(staffSql).not.toContain("account_number");
  });
});
