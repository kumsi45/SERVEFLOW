import {
  loadInventoryIntelligence,
  type InventoryIntelligence,
} from "../../kitchen/services/inventoryRequestService";
import {
  loadManagerAiOperations,
  type ManagerAiOperationsSnapshot,
} from "./managerAiOperationsService";
import {
  loadManagerOperationalReport,
  type ManagerOperationalReport,
} from "./managerOperationalReportsService";
export type IntelligenceModule = {
  key: "traffic" | "staffing" | "kitchen" | "tables" | "revenue" | "inventory";
  title: string;
  question: string;
  status: string;
  summary: string;
  actions: string[];
  confidence: number | null;
  supported: boolean;
};
export type RestaurantIntelligenceSnapshot = {
  modules: IntelligenceModule[];
  operations: ManagerAiOperationsSnapshot;
  today: ManagerOperationalReport;
  history: ManagerOperationalReport;
  inventory: InventoryIntelligence[];
  generatedAt: string;
};
const best = <T>(rows: T[], value: (row: T) => number) =>
  rows.reduce<T | null>(
    (result, row) => (!result || value(row) > value(result) ? row : result),
    null,
  );
export async function loadRestaurantIntelligence(
  restaurantId: string,
): Promise<RestaurantIntelligenceSnapshot> {
  const now = new Date(),
    todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const historyEnd = new Date(todayStart),
    historyStart = new Date(todayStart);
  historyStart.setDate(historyStart.getDate() - 7);
  const [operations, today, history, inventory] = await Promise.all([
    loadManagerAiOperations(restaurantId),
    loadManagerOperationalReport(
      restaurantId,
      todayStart.toISOString(),
      now.toISOString(),
    ),
    loadManagerOperationalReport(
      restaurantId,
      historyStart.toISOString(),
      historyEnd.toISOString(),
    ),
    loadInventoryIntelligence(restaurantId),
  ]);
  const peak = best(today.ordersPerHour, (row) => row.value),
    historicalPeak = best(history.peakHours, (row) => row.value);
  const staffAlerts = operations.alerts.filter(
      (a) => a.affectedArea === "Waiters",
    ),
    kitchenAlerts = operations.alerts.filter(
      (a) => a.affectedArea === "Kitchen",
    ),
    tableAlerts = operations.alerts.filter(
      (a) =>
        a.affectedArea === "Dining Flow" ||
        a.affectedArea === "Customer Service",
    );
  const staffActions = operations.recommendations
      .filter((r) => r.type === "waiter")
      .map((r) => r.recommendation),
    kitchenActions = operations.recommendations
      .filter((r) => r.type === "kitchen")
      .map((r) => r.recommendation),
    tableActions = operations.recommendations
      .filter((r) => r.type === "customer" || r.type === "restaurant")
      .map((r) => r.recommendation);
  const elapsed = Math.max(
      0.05,
      (now.getTime() - todayStart.getTime()) / 86400000,
    ),
    historicalDaily = history.summary.revenue / 7,
    forecast = today.summary.revenue / elapsed,
    revenueSupported = today.summary.revenue > 0 || history.summary.revenue > 0;
  const depleted = inventory.filter(
    (i) => i.health === "critical" || i.health === "low",
  );
  const modules: IntelligenceModule[] = [
    {
      key: "traffic",
      title: "Customer Traffic Intelligence",
      question: "When is the next rush?",
      status: peak ? `Peak ${peak.label}` : "Insufficient traffic",
      summary: peak
        ? `Today's strongest hour is ${peak.label} with ${peak.value} orders. The recent historical peak is ${historicalPeak?.label ?? "not established"}.`
        : "More orders are required before a rush pattern is reliable.",
      actions: peak
        ? [`Review floor and kitchen coverage before ${peak.label}.`]
        : [],
      confidence: null,
      supported: Boolean(peak),
    },
    {
      key: "staffing",
      title: "Staffing Intelligence",
      question: "Is workload balanced?",
      status: staffAlerts.length
        ? `${staffAlerts.length} overload signal(s)`
        : "Balanced",
      summary:
        staffAlerts[0]?.description ??
        "No waiter currently crosses the configured overload threshold.",
      actions: staffActions,
      confidence: staffActions.length
        ? (operations.recommendations.find((r) => r.type === "waiter")
            ?.confidence ?? null)
        : null,
      supported: true,
    },
    {
      key: "kitchen",
      title: "Kitchen Intelligence",
      question: "Where will preparation slow?",
      status: kitchenAlerts.length
        ? `${kitchenAlerts.length} bottleneck(s)`
        : "Stable",
      summary:
        kitchenAlerts[0]?.description ??
        operations.predictions.find((p) =>
          p.prediction.toLowerCase().includes("station"),
        )?.prediction ??
        "No kitchen bottleneck is currently detected.",
      actions: kitchenActions,
      confidence: kitchenActions.length
        ? (operations.recommendations.find((r) => r.type === "kitchen")
            ?.confidence ?? null)
        : null,
      supported: true,
    },
    {
      key: "tables",
      title: "Table Intelligence",
      question: "Which guests need intervention?",
      status: tableAlerts.length
        ? `${tableAlerts.length} table signal(s)`
        : "No intervention",
      summary:
        tableAlerts[0]?.description ??
        "No table exceeds the current wait or VIP-attention threshold.",
      actions: tableActions,
      confidence: tableActions.length
        ? (operations.recommendations.find(
            (r) => r.type === "customer" || r.type === "restaurant",
          )?.confidence ?? null)
        : null,
      supported: true,
    },
    {
      key: "revenue",
      title: "Revenue Intelligence",
      question: "Where will sales finish today?",
      status: revenueSupported
        ? `Forecast ${Math.round(forecast)}`
        : "Not available",
      summary: revenueSupported
        ? `Today's current revenue is ${Math.round(today.summary.revenue)}. Pace-based end-of-day forecast is ${Math.round(forecast)} versus a ${Math.round(historicalDaily)} recent daily average.`
        : "Revenue totals are not available from the current manager report response.",
      actions:
        revenueSupported &&
        historicalDaily > 0 &&
        forecast < historicalDaily * 0.8
          ? [
              "Review traffic, service delays, and a targeted promotion before the next demand window.",
            ]
          : [],
      confidence: null,
      supported: revenueSupported,
    },
    {
      key: "inventory",
      title: "Inventory Intelligence",
      question: "What will run out next?",
      status: depleted.length
        ? `${depleted.length} item(s) at risk`
        : "Stock healthy",
      summary: depleted[0]
        ? `${depleted[0].name} is ${depleted[0].health}${depleted[0].remainingHours != null ? ` with about ${Math.round(depleted[0].remainingHours)} hours remaining` : "; consumption history is still developing"}.`
        : inventory.length
          ? "No catalog item is currently low or critical."
          : "No inventory catalog data is configured.",
      actions: depleted
        .map((i) =>
          i.supplierReminder
            ? `Reorder ${i.name}${i.supplierName ? ` from ${i.supplierName}` : " after configuring its supplier"}.`
            : `Monitor ${i.name}.`,
        )
        .slice(0, 4),
      confidence: null,
      supported: inventory.length > 0,
    },
  ];
  return {
    modules,
    operations,
    today,
    history,
    inventory,
    generatedAt: now.toISOString(),
  };
}
