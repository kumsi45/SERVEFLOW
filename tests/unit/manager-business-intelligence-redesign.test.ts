import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBusinessIntelligence, type RestaurantIntelligenceSnapshot } from "../../src/modules/manager/services/managerRestaurantIntelligenceService";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerRestaurantIntelligencePage.tsx");
const service = read("src/modules/manager/services/managerRestaurantIntelligenceService.ts");
const styles = read("src/modules/manager/styles/managerRestaurantIntelligence.css");
const layout = read("src/modules/manager/components/ManagerLayout.tsx");

function snapshot(historyOrders = 0): RestaurantIntelligenceSnapshot {
  const report = (orders: number, ordersPerHour: Array<{ label: string; value: number }> = []) => ({
    summary: { orders, revenue: 0, averageTicket: 0, averagePreparationMinutes: 0, tableTurnover: 0, delayedOrders: 0, cancelledOrders: 0, averageCustomerWaitMinutes: 0, peakHour: null, collected: 0, paymentDue: 0, pendingPayments: 0, refunds: 0, averagePaymentDelayMinutes: 0, paymentConversionRate: 0 },
    ordersPerHour,
    peakHours: [...ordersPerHour].sort((a, b) => b.value - a.value),
    rangeStart: "2026-08-01T00:00:00Z", rangeEnd: "2026-08-08T00:00:00Z", generatedAt: "2026-08-08T00:00:00Z",
    tableTurnover: [], waiterPerformance: [], kitchenEfficiency: [], stationUtilization: [], delayedOrders: [], cancelledOrders: [], customerWaitTime: [],
  });
  return {
    modules: [],
    operations: { alerts: [], recommendations: [], predictions: [], learning: [], health: { overall: 100, trend: "steady", breakdown: [] }, generatedAt: "2026-08-08T00:00:00Z" },
    today: report(0),
    history: report(historyOrders, historyOrders ? [{ label: "09:00", value: 6 }, { label: "12:00", value: 18 }, { label: "18:00", value: 8 }] : []),
    inventory: [],
    businessType: "Cafe",
    timezone: "Africa/Nairobi",
    generatedAt: "2026-08-08T00:00:00Z",
  } as RestaurantIntelligenceSnapshot;
}

describe("Manager Business Intelligence redesign", () => {
  it("renames the workspace and removes dashboard and Copilot duplication", () => {
    expect(layout).toContain('label: "Business Intelligence"');
    expect(layout).not.toContain("ml-header-context");
    expect(page).not.toContain("Forward-looking guidance for upcoming service, operational risks, and preparation.");
    for (const removed of ["Restaurant Intelligence", "Current Revenue", "Operational Health", "Future Actions", "Active Risks", "AI Operations Assistant", "Open Copilot", "mri-kpis", "mri-copilot"]) expect(page).not.toContain(removed);
  });

  it("implements the required decision hierarchy", () => {
    for (const label of ["Next Service", "Recommended Preparation", "Operational Risks", "Business Opportunities", "Tomorrow&apos;s Preparation"]) expect(page).toContain(label);
    expect(page.indexOf("Next Service")).toBeLessThan(page.indexOf("Operational Risks"));
    expect(page.indexOf("Operational Risks")).toBeLessThan(page.indexOf("Tomorrow&apos;s Preparation"));
  });

  it("fails honestly when history is insufficient", () => {
    const view = buildBusinessIntelligence(snapshot(0), new Date("2026-08-08T07:00:00Z"));
    expect(view.nextService.supported).toBe(false);
    expect(view.nextService.evidence).toContain("Not enough operating history");
    expect(view.tomorrow.supported).toBe(false);
    expect(view.tomorrow.message).toContain("comparable operating history");
    expect(view.opportunities).toEqual([]);
  });

  it("derives a business-aware next service only from adequate completed history", () => {
    const view = buildBusinessIntelligence(snapshot(32), new Date("2026-08-08T06:00:00Z"));
    expect(view.nextService.supported).toBe(true);
    expect(view.nextService.name).toBe("Midday service");
    expect(view.nextService.demand).toBe("Elevated");
    expect(view.nextService.evidence).toContain("32 orders");
    expect(view.opportunities).toHaveLength(1);
  });

  it("uses tenant-scoped existing contracts without schema or RPC additions", () => {
    expect(service).toContain('supabase.from("restaurants").select("profile").eq("id", restaurantId).single()');
    expect(service).toContain("loadManagerAiOperations(restaurantId)");
    expect(service).toContain("loadManagerOperationalReport(");
    expect(service).toContain("loadInventoryIntelligence(restaurantId)");
    expect(page).toContain("useTenantRealtime");
    expect(page).not.toContain("service_role");
  });

  it("provides max-width desktop, tablet, and mobile layouts", () => {
    expect(styles).toContain("width: min(1180px, 100%)");
    expect(styles).toContain("@media (max-width: 1000px)");
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("@media (max-width: 480px)");
    expect(styles).toContain("grid-template-columns: 1fr");
  });
});
