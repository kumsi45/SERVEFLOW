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
  loadRestaurantAnalyticsTimezone,
  type ManagerOperationalReport,
} from "./managerOperationalReportsService";
import { analyticsWindow, completedDaysWindow } from "../../../core/analytics/historicalAnalytics";
import { supabase } from "../../../core/database";
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
  businessType: string | null;
  timezone: string;
  generatedAt: string;
};
export type IntelligenceSeverity = "critical" | "attention" | "watch";
export type IntelligenceBusinessArea = "demand" | "menu" | "staff" | "kitchen" | "inventory" | "guest" | "finance" | "operations";
export type BusinessIntelligenceSignal = {
  id: string;
  type: "risk" | "opportunity";
  severity: IntelligenceSeverity;
  title: string;
  summary: string;
  evidence: string;
  recommendation: string;
  confidence: number | null;
  timeHorizon: "today" | "next_service" | "tomorrow";
  businessArea: IntelligenceBusinessArea;
};
export type BusinessIntelligenceView = {
  nextService: {
    supported: boolean;
    name: string;
    window: string | null;
    demand: string;
    staffing: string;
    kitchen: string;
    inventory: string;
    evidence: string;
    recommendations: string[];
  };
  risks: BusinessIntelligenceSignal[];
  opportunities: BusinessIntelligenceSignal[];
  tomorrow: {
    supported: boolean;
    message: string;
    demand: string;
    inventory: string;
    staffing: string;
    kitchen: string;
  };
};

const MIN_HISTORY_ORDERS = 20;

function hourValue(label: string) {
  const match = /(?:^|\s)(\d{1,2})(?::\d{2})?/.exec(label);
  const hour = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function displayHour(hour: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2020, 0, 1, hour));
}

function serviceName(hour: number, businessType: string | null) {
  const type = (businessType ?? "").toLowerCase();
  if (type.includes("bar") || type.includes("lounge")) return hour >= 16 ? "Evening service" : "Upcoming service";
  if (type.includes("hotel")) return hour < 11 ? "Breakfast service" : hour < 15 ? "Lunch service" : "Dinner service";
  if (type.includes("cafe") || type.includes("coffee") || type.includes("bakery")) return hour < 12 ? "Morning service" : hour < 17 ? "Midday service" : "Evening service";
  return hour < 11 ? "Morning service" : hour < 16 ? "Lunch service" : "Evening service";
}

function areaFor(value: string): IntelligenceBusinessArea {
  if (value === "Kitchen") return "kitchen";
  if (value === "Waiters") return "staff";
  if (value === "Customer Service" || value === "Dining Flow") return "guest";
  if (value === "Cashier") return "finance";
  return "operations";
}

function signalSeverity(priority: string): IntelligenceSeverity {
  return priority === "critical" ? "critical" : priority === "high" ? "attention" : "watch";
}

export function buildBusinessIntelligence(snapshot: RestaurantIntelligenceSnapshot, now = new Date()): BusinessIntelligenceView {
  const activeHours = snapshot.history.ordersPerHour.filter((row) => row.value > 0 && hourValue(row.label) != null);
  const historySupported = snapshot.history.summary.orders >= MIN_HISTORY_ORDERS && activeHours.length >= 3;
  const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: snapshot.timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const futureHours = activeHours.filter((row) => (hourValue(row.label) ?? -1) > localHour);
  const strongest = best(futureHours.length ? futureHours : activeHours, (row) => row.value);
  const strongestHour = strongest ? hourValue(strongest.label) : null;
  const averageActiveHour = activeHours.length ? activeHours.reduce((sum, row) => sum + row.value, 0) / activeHours.length : 0;
  const nextDay = Boolean(strongestHour != null && futureHours.length === 0);
  const lowInventory = snapshot.inventory.filter((item) => item.health === "critical" || item.health === "low");
  const staffAlerts = snapshot.operations.alerts.filter((alert) => alert.affectedArea === "Waiters" && (alert.priority === "critical" || alert.priority === "high"));
  const kitchenAlerts = snapshot.operations.alerts.filter((alert) => alert.affectedArea === "Kitchen" && (alert.priority === "critical" || alert.priority === "high"));

  const risks: BusinessIntelligenceSignal[] = [];
  for (const item of lowInventory.slice(0, 4)) {
    risks.push({
      id: `inventory:${item.id}`,
      type: "risk",
      severity: item.health === "critical" ? "critical" : "attention",
      title: `${item.name} supply risk`,
      summary: item.remainingHours != null ? `Current consumption indicates this item may become insufficient in about ${Math.max(1, Math.round(item.remainingHours))} hours.` : "Current stock is below its configured operating threshold.",
      evidence: `Inventory intelligence classifies this item as ${item.health}.`,
      recommendation: item.supplierReminder ? `Review replenishment for ${item.name}${item.supplierName ? ` with ${item.supplierName}` : ""}.` : `Review ${item.name} availability before the next demand window.`,
      confidence: null,
      timeHorizon: "next_service",
      businessArea: "inventory",
    });
  }
  for (const prediction of snapshot.operations.predictions.filter((item) => item.id.startsWith("pred:station:")).slice(0, 3)) {
    risks.push({
      id: prediction.id,
      type: "risk",
      severity: signalSeverity(prediction.priority),
      title: prediction.prediction,
      summary: "This recurring preparation pattern may affect the next high-demand window.",
      evidence: prediction.reason,
      recommendation: snapshot.operations.learning.find((item) => item.id.replace("learn:", "pred:") === prediction.id)?.suggestedImprovement ?? "Review station coverage before demand increases.",
      confidence: prediction.confidence,
      timeHorizon: "next_service",
      businessArea: "kitchen",
    });
  }
  for (const alert of snapshot.operations.alerts.filter((item) => item.priority === "critical" || item.priority === "high").slice(0, 4)) {
    if (risks.some((risk) => risk.title === alert.description)) continue;
    risks.push({
      id: `alert:${alert.id}`,
      type: "risk",
      severity: signalSeverity(alert.priority),
      title: alert.description,
      summary: `If this condition continues, it may disrupt upcoming ${alert.affectedArea.toLowerCase()} readiness.`,
      evidence: "An existing live operational threshold is currently exceeded.",
      recommendation: alert.suggestedAction,
      confidence: null,
      timeHorizon: "today",
      businessArea: areaFor(alert.affectedArea),
    });
  }

  const opportunities: BusinessIntelligenceSignal[] = [];
  if (historySupported && strongest && strongestHour != null && strongest.value >= averageActiveHour * 1.25) {
    opportunities.push({
      id: "opportunity:strong-service-window",
      type: "opportunity",
      severity: "watch",
      title: `${serviceName(strongestHour, snapshot.businessType)} is a recurring demand opportunity`,
      summary: "Recent completed-day history shows a consistently stronger order window that can be prepared for in advance.",
      evidence: `${strongest.label} recorded ${strongest.value} orders across the recent completed-day window, above the active-hour average of ${Math.round(averageActiveHour)}.`,
      recommendation: `Confirm service and production readiness before ${displayHour(strongestHour)}.`,
      confidence: null,
      timeHorizon: "next_service",
      businessArea: "demand",
    });
  }

  const recommendations = historySupported && strongestHour != null
    ? [
        `Review service coverage before ${displayHour(strongestHour)}.`,
        ...kitchenAlerts.slice(0, 1).map((alert) => alert.suggestedAction),
        ...lowInventory.slice(0, 2).map((item) => `Review ${item.name} availability before expected demand.`),
      ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 4)
    : [];

  return {
    nextService: {
      supported: historySupported && strongestHour != null,
      name: strongestHour == null ? "Next service" : serviceName(strongestHour, snapshot.businessType),
      window: strongestHour == null ? null : `${nextDay ? "Next operating day · " : ""}${displayHour(strongestHour)}–${displayHour((strongestHour + 1) % 24)}`,
      demand: strongest && strongest.value >= averageActiveHour * 1.25 ? "Elevated" : "Typical",
      staffing: staffAlerts.length ? "Attention" : "No current risk",
      kitchen: kitchenAlerts.length ? "Attention" : "No current risk",
      inventory: lowInventory.length ? `${lowInventory.length} risk${lowInventory.length === 1 ? "" : "s"}` : "No current risk",
      evidence: historySupported ? `Based on ${snapshot.history.summary.orders} orders from the last seven completed operating days.` : "Not enough operating history yet to predict the next service.",
      recommendations,
    },
    risks: risks.slice(0, 7),
    opportunities,
    tomorrow: {
      supported: false,
      message: "More comparable operating history is required for tomorrow's forecast.",
      demand: "Not enough comparable history",
      inventory: lowInventory.length ? "Current risks shown above; tomorrow demand is not forecast yet" : "Tomorrow demand is not forecast yet",
      staffing: "Schedules and comparable demand are not available",
      kitchen: "Tomorrow station workload is not forecast yet",
    },
  };
}
const best = <T>(rows: T[], value: (row: T) => number) =>
  rows.reduce<T | null>(
    (result, row) => (!result || value(row) > value(result) ? row : result),
    null,
  );
export async function loadRestaurantIntelligence(
  restaurantId: string,
): Promise<RestaurantIntelligenceSnapshot> {
  const now = new Date();
  const timezone = await loadRestaurantAnalyticsTimezone(restaurantId);
  const todayWindow = analyticsWindow("today", timezone, "", "", now);
  const historyWindow = completedDaysWindow(7, timezone, now);
  const [operations, today, history, inventory, profileResult] = await Promise.all([
    loadManagerAiOperations(restaurantId),
    loadManagerOperationalReport(
      restaurantId,
      todayWindow.rangeStart,
      now.toISOString(),
      timezone,
    ),
    loadManagerOperationalReport(
      restaurantId,
      historyWindow.rangeStart, historyWindow.rangeEnd, timezone,
    ),
    loadInventoryIntelligence(restaurantId),
    supabase.from("restaurants").select("profile").eq("id", restaurantId).single(),
  ]);
  if (profileResult.error) throw new Error(profileResult.error.message);
  const profile = profileResult.data?.profile && typeof profileResult.data.profile === "object" ? profileResult.data.profile as Record<string, unknown> : {};
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
      (now.getTime() - new Date(todayWindow.rangeStart).getTime()) / 86400000,
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
    businessType: typeof profile.restaurant_type === "string" ? profile.restaurant_type : null,
    timezone,
    generatedAt: now.toISOString(),
  };
}
