import type { CurrencyConfig } from "../../../core/format/currency";
import { formatCurrency } from "../../../core/format/currency";
import {
  loadManagerCustomerExperience,
  type ManagerCustomerExperienceSnapshot,
} from "./managerCustomerExperienceService";
import {
  loadManagerInventoryWorkspace,
  type ManagerInventorySnapshot,
} from "./managerInventoryWorkspaceService";
import {
  loadManagerKitchenSupervision,
  type ManagerKitchenSupervisionSnapshot,
} from "./managerKitchenSupervisionService";
import {
  loadManagerMenu,
  type ManagerMenuSnapshot,
} from "./managerMenuService";
import {
  loadRestaurantIntelligence,
  type RestaurantIntelligenceSnapshot,
} from "./managerRestaurantIntelligenceService";
import {
  loadManagerStaffOperations,
  type ManagerStaffOperationsSnapshot,
} from "./managerStaffOperationsService";

export type CopilotContext =
  | "dashboard"
  | "tables"
  | "kitchen"
  | "staff"
  | "customers"
  | "reports"
  | "intelligence"
  | "recipes"
  | "menu"
  | "inventory";
export type CopilotAnswer = {
  conclusion: string;
  evidence: string[];
  impact?: string;
  recommendation?: string;
  sources: string[];
  action?: { label: string; href: string };
};
export type ManagerCopilotSnapshot = {
  intelligence: RestaurantIntelligenceSnapshot | null;
  staff: ManagerStaffOperationsSnapshot | null;
  guests: ManagerCustomerExperienceSnapshot | null;
  kitchen: ManagerKitchenSupervisionSnapshot | null;
  inventory: ManagerInventorySnapshot | null;
  menu: ManagerMenuSnapshot | null;
  unavailable: string[];
};

export async function loadManagerCopilotSnapshot(
  restaurantId: string,
): Promise<ManagerCopilotSnapshot> {
  const results = await Promise.allSettled([
    loadRestaurantIntelligence(restaurantId),
    loadManagerStaffOperations(restaurantId),
    loadManagerCustomerExperience(restaurantId),
    loadManagerKitchenSupervision(restaurantId),
    loadManagerInventoryWorkspace(restaurantId),
    loadManagerMenu(restaurantId),
  ]);
  const names = [
    "Reports and Business Intelligence",
    "Staff",
    "Guests",
    "Kitchen",
    "Inventory",
    "Menu",
  ];
  return {
    intelligence: value<RestaurantIntelligenceSnapshot>(results[0]),
    staff: value<ManagerStaffOperationsSnapshot>(results[1]),
    guests: value<ManagerCustomerExperienceSnapshot>(results[2]),
    kitchen: value<ManagerKitchenSupervisionSnapshot>(results[3]),
    inventory: value<ManagerInventorySnapshot>(results[4]),
    menu: value<ManagerMenuSnapshot>(results[5]),
    unavailable: results.flatMap((result, index) =>
      result.status === "rejected" ? [names[index]] : [],
    ),
  };
}

function value<T>(result: PromiseSettledResult<unknown>): T | null {
  return result.status === "fulfilled" ? (result.value as T) : null;
}
const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
const includesAny = (query: string, terms: string[]) =>
  terms.some((term) => query.includes(term));
const fmt = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

export function investigateManagerQuestion(
  question: string,
  snapshot: ManagerCopilotSnapshot,
  currency?: CurrencyConfig,
  context: CopilotContext = "dashboard",
): CopilotAnswer {
  let query = normalize(question);
  if (
    includesAny(query, [
      "why is this happening",
      "show the evidence",
      "what should i do",
      "explain this insight",
    ])
  ) {
    query = `${query} ${context === "intelligence" || context === "dashboard" ? "what needs attention" : context}`;
  }
  if (context === "customers" && query.includes("who needs"))
    query = `${query} guest`;
  if (
    includesAny(query, [
      "late today",
      "arrived late",
      "absent",
      "attendance",
      "clocked in",
    ])
  )
    return unsupported(
      "ServeFlow is not recording trustworthy employee schedules and explicit check-in times yet, so I cannot determine lateness or absence.",
      "Authentication or shared-device activity is not attendance evidence.",
      ["Staff"],
    );
  if (
    includesAny(query, [
      "profit",
      "margin",
      "net income",
      "bank balance",
      "owner withdrawal",
    ])
  )
    return unsupported(
      "Reliable profit is not available to this Copilot.",
      "Recorded revenue does not establish profit without complete, authorized cost data.",
      ["Reports"],
    );

  const guests = snapshot.guests;
  const kitchen = snapshot.kitchen;
  const staff = snapshot.staff;
  const inventory = snapshot.inventory;
  const report = snapshot.intelligence?.today;

  if (
    includesAny(query, [
      "what needs",
      "going wrong",
      "attention",
      "summarize today",
      "summarize today s operation",
      "biggest operational problem",
      "improve tomorrow",
    ]) &&
    !(context === "customers" && query.includes("who needs"))
  ) {
    const guestIssues = guests?.alerts ?? [];
    const delayed = kitchen?.delayedOrders ?? 0;
    const uncovered = (kitchen?.stations ?? []).filter(
      (station) => station.queueLength > 0 && station.activeStaff === 0,
    );
    const stockRisks = (inventory?.stock ?? []).filter(
      (item) => item.status !== "healthy",
    );
    const requests = (inventory?.requests ?? []).filter(
      (item) => item.status === "pending",
    );
    const evidence = [
      guestIssues.length
        ? `${guestIssues.length} guest or service issue${guestIssues.length === 1 ? "" : "s"} need attention.`
        : "No supported guest/service exception is active.",
      delayed
        ? `${delayed} kitchen order${delayed === 1 ? " is" : "s are"} delayed.`
        : "No kitchen order is beyond the supported delay threshold.",
      uncovered.length
        ? `${uncovered.length} working station${uncovered.length === 1 ? " has" : "s have"} queued work without active staff.`
        : "No staffed-coverage exception is active for a station with queued work.",
      stockRisks.length
        ? `${stockRisks.length} stock item${stockRisks.length === 1 ? " is" : "s are"} low, critical, or out.`
        : "No ledger-derived stock threshold exception is active.",
      requests.length
        ? `${requests.length} inventory request${requests.length === 1 ? " is" : "s are"} pending.`
        : "No inventory request is pending.",
    ];
    const action = guestIssues.length
      ? { label: "Review Guests", href: "/manager/customers" }
      : delayed || uncovered.length
        ? { label: "Review Kitchen", href: "/manager/kitchen" }
        : stockRisks.length || requests.length
          ? { label: "Review Inventory", href: "/manager/inventory" }
          : undefined;
    return {
      conclusion:
        guestIssues.length ||
        delayed ||
        uncovered.length ||
        stockRisks.length ||
        requests.length
          ? "There are supported operational issues to review now."
          : "No supported live exception currently requires manager intervention.",
      evidence,
      impact:
        "The list is ordered around service, production, coverage, and stock risk—not a synthetic health score.",
      recommendation: action
        ? `Open ${action.label.replace("Review ", "")} and review the underlying records before making a change.`
        : "Continue monitoring live operations.",
      sources: ["Guests", "Kitchen", "Staff", "Inventory"],
      action,
    };
  }

  if (
    includesAny(query, [
      "delayed order",
      "orders delayed",
      "waited longest",
      "longest waiting",
      "bill request",
      "payment waiting",
      "service request",
    ])
  ) {
    const sessions = [...(guests?.sessions ?? [])];
    const wantsBill = includesAny(query, ["bill", "payment"]);
    const rows = sessions
      .filter((item) =>
        wantsBill
          ? (item.billWaitingMinutes ?? 0) > 0
          : item.waitingMinutes > 0,
      )
      .sort((a, b) =>
        wantsBill
          ? (b.billWaitingMinutes ?? 0) - (a.billWaitingMinutes ?? 0)
          : b.waitingMinutes - a.waitingMinutes,
      )
      .slice(0, 5);
    if (!rows.length)
      return simple(
        wantsBill
          ? "No supported bill-assistance wait is active."
          : "No active service session has a recorded wait to report.",
        ["Guests", "Live Operations"],
      );
    return {
      conclusion: wantsBill
        ? `${rows.length} longest bill-assistance wait${rows.length === 1 ? " is" : "s are"} shown below.`
        : `${rows[0].displayNumber} has the longest recorded active-session wait.`,
      evidence: rows.map(
        (row) =>
          `${row.displayNumber}: ${wantsBill ? row.billWaitingMinutes : row.waitingMinutes} minutes · ${row.assignedWaiter ?? "no assigned staff recorded"}`,
      ),
      impact: "Long waits can become service-recovery issues.",
      recommendation:
        "Review the live session before reassigning staff or changing service responsibility.",
      sources: ["Guests", "Live Operations"],
      action: {
        label: wantsBill ? "Review Guests" : "Open Live Operations",
        href: wantsBill ? "/manager/customers" : "/manager/tables",
      },
    };
  }

  if (
    includesAny(query, [
      "kitchen request",
      "material request",
      "department request",
    ])
  ) {
    const pending = (inventory?.requests ?? []).filter(
      (item) => item.status === "pending",
    );
    return {
      conclusion: `${pending.length} kitchen or department inventory request${pending.length === 1 ? " is" : "s are"} pending.`,
      evidence: pending.length
        ? pending
            .slice(0, 6)
            .map(
              (item) =>
                `${item.itemName}: ${fmt(item.quantity)} ${item.unit} · ${item.stationName ?? "department"} · ${title(item.urgency)}`,
            )
        : ["No pending request is recorded."],
      recommendation: pending.length
        ? "Review the request and current stock in Inventory. The Copilot will not approve or fulfill it silently."
        : "No request review is needed.",
      sources: ["Kitchen", "Inventory"],
      action: { label: "Open Inventory", href: "/manager/inventory" },
    };
  }

  if (
    includesAny(query, [
      "kitchen",
      "station",
      "prep time",
      "preparation",
      "slowest",
    ])
  ) {
    const stations = [...(kitchen?.stations ?? [])].sort(
      (a, b) =>
        b.delayed - a.delayed ||
        b.queueLength - a.queueLength ||
        b.averagePreparationMinutes - a.averagePreparationMinutes,
    );
    if (!stations.length)
      return unsupported(
        "No kitchen station data is currently available.",
        "ServeFlow cannot identify a bottleneck without configured stations and ticket data.",
        ["Kitchen"],
      );
    const station = stations[0];
    return {
      conclusion:
        station.delayed || station.queueLength
          ? `${station.name} currently has the strongest production-pressure signal.`
          : "No station currently has queued or delayed production work.",
      evidence: stations
        .slice(0, 4)
        .map(
          (row) =>
            `${row.name}: ${row.queueLength} queued · ${row.delayed} delayed · ${fmt(row.averagePreparationMinutes)} min average · ${row.activeStaff} active staff`,
        ),
      impact:
        station.queueLength > 0 && station.activeStaff === 0
          ? `${station.name} has work but no active staff recorded.`
          : "Station workload is derived from current ticket and staff-assignment data.",
      recommendation:
        station.delayed || station.queueLength
          ? "Open Kitchen to inspect affected orders and coverage before changing assignments."
          : "No intervention is recommended.",
      sources: ["Kitchen"],
      action: { label: "Open Kitchen", href: "/manager/kitchen" },
    };
  }

  if (
    includesAny(query, [
      "who is available",
      "who is overloaded",
      "workload",
      "tables each waiter",
      "staff available",
      "handled the most work",
    ])
  ) {
    const members = staff?.staff ?? [];
    if (!members.length)
      return unsupported(
        "No staff records are available to summarize.",
        "Staff status must come from the current tenant's staff records.",
        ["Staff"],
      );
    const isMostWork = includesAny(query, ["most work", "handled the most"]);
    const ordered = [...members].sort((a, b) =>
      isMostWork
        ? b.activeOrders - a.activeOrders
        : b.currentWorkload - a.currentWorkload,
    );
    const available = ordered.filter(
      (member) =>
        member.online &&
        member.currentWorkload === 0 &&
        member.breakStatus !== "on_break",
    );
    const shown = query.includes("available") ? available : ordered.slice(0, 8);
    return {
      conclusion: query.includes("available")
        ? `${available.length} active staff member${available.length === 1 ? " has" : "s have"} no current recorded assignment.`
        : isMostWork
          ? `${ordered[0]?.fullName ?? "No staff member"} has the highest supported active-order count.`
          : "Current staff workload is shown from assignments and active orders; no invented capacity threshold is applied.",
      evidence: shown
        .slice(0, 8)
        .map(
          (member) =>
            `${member.fullName} · ${title(member.role)} · ${member.assignedTables.length} service locations · ${member.activeOrders} active orders${member.assignedKitchenStationName ? ` · ${member.assignedKitchenStationName}` : ""}${member.breakStatus === "on_break" ? " · on break" : ""}`,
        ),
      impact:
        "Shared-device activity is not treated as attendance or arrival time.",
      recommendation:
        "Use Live Operations for service-location assignment or Kitchen for station assignment.",
      sources: ["Staff", "Live Operations", "Kitchen"],
      action: { label: "Open Staff", href: "/manager/staff" },
    };
  }

  if (
    includesAny(query, [
      "inventory",
      "stock",
      "run out",
      "needed tomorrow",
      "purchase tomorrow",
      "pending request",
      "low item",
    ])
  ) {
    const risks = (inventory?.stock ?? []).filter(
      (item) => item.status !== "healthy",
    );
    const pending = (inventory?.requests ?? []).filter(
      (item) => item.status === "pending",
    );
    if (!inventory)
      return unsupported(
        "Inventory evidence is currently unavailable.",
        "I cannot estimate stock risk without the tenant-scoped inventory response.",
        ["Inventory"],
      );
    const evidence = [
      ...risks
        .slice(0, 5)
        .map(
          (item) =>
            `${item.name}: ${fmt(item.current)} ${item.unit} available · minimum ${fmt(item.minimum)} · ${stockLabel(item.status)}${item.affectedMenuItems.length ? ` · may affect ${item.affectedMenuItems.slice(0, 2).join(", ")}` : ""}`,
        ),
      ...pending
        .slice(0, 3)
        .map(
          (item) =>
            `${item.itemName}: ${fmt(item.quantity)} ${item.unit} requested by ${item.stationName ?? "department"} · ${title(item.urgency)}`,
        ),
    ];
    return {
      conclusion:
        risks.length || pending.length
          ? `${risks.length} stock risk${risks.length === 1 ? "" : "s"} and ${pending.length} pending request${pending.length === 1 ? "" : "s"} are recorded.`
          : "No ledger-derived stock risk or pending request is currently recorded.",
      evidence: evidence.length
        ? evidence
        : ["Current stock is above configured minimum thresholds."],
      impact:
        "Tomorrow demand is not forecast; this uses current ledger balances, configured minimums, and existing requests only.",
      recommendation:
        risks.length || pending.length
          ? "Review Inventory before the next service and confirm any replenishment decision with the underlying records."
          : "No replenishment intervention is indicated by current thresholds.",
      sources: ["Inventory", "Menu", "Recipes"],
      action: { label: "Open Inventory", href: "/manager/inventory" },
    };
  }

  if (
    includesAny(query, [
      "complaint",
      "guest",
      "customer service",
      "special request",
    ])
  ) {
    const complaints = (guests?.complaints ?? []).filter(
      (item) => item.status !== "resolved",
    );
    const requests = (guests?.alerts ?? []).filter(
      (item) => item.type === "special_request",
    );
    return {
      conclusion: `${complaints.length} unresolved complaint${complaints.length === 1 ? "" : "s"} and ${requests.length} special request${requests.length === 1 ? "" : "s"} need attention.`,
      evidence: [
        ...complaints
          .slice(0, 5)
          .map(
            (item) =>
              `${item.tableNumber ? `Service location ${item.tableNumber}` : "Guest session"}: ${item.description} · ${title(item.severity)} · ${title(item.status)}`,
          ),
        ...requests.slice(0, 3).map((item) => item.message),
      ],
      recommendation:
        complaints.length || requests.length
          ? "Open Guests to review context before acknowledging or resolving an issue."
          : "No service-recovery action is currently indicated.",
      sources: ["Guests"],
      action: { label: "Open Guests", href: "/manager/customers" },
    };
  }

  if (
    includesAny(query, [
      "revenue",
      "sales today",
      "today s sales",
      "today sales",
      "recorded sales",
      "busiest",
      "peak hour",
    ])
  ) {
    if (!report)
      return unsupported(
        "Today's operational report is unavailable.",
        "Revenue and peak activity require the authorized manager report response.",
        ["Reports"],
      );
    return {
      conclusion:
        query.includes("busiest") || query.includes("peak")
          ? report.summary.peakHour
            ? `The busiest recorded period today is ${report.summary.peakHour}.`
            : "A busiest period is not established yet today."
          : `Today's recorded revenue is ${formatCurrency(report.summary.revenue, currency)} across ${report.summary.orders} orders.`,
      evidence: [
        `Collected: ${formatCurrency(report.summary.collected, currency)}`,
        `Payment due: ${formatCurrency(report.summary.paymentDue, currency)}`,
        `Delayed orders: ${report.summary.delayedOrders}`,
        `Average preparation: ${fmt(report.summary.averagePreparationMinutes)} minutes`,
      ],
      impact: "These are recorded operational totals, not profit.",
      sources: ["Reports"],
      action: { label: "Open Reports", href: "/manager/reports" },
    };
  }

  if (
    includesAny(query, [
      "best seller",
      "best selling",
      "slow seller",
      "sold the most",
      "sold the least",
      "how many of",
      "item sales",
    ])
  )
    return unsupported(
      "Item-level sales ranking is not available in the current Manager Copilot evidence bundle.",
      "I will not infer best or slow sellers from menu availability, kitchen activity, or incomplete item data.",
      ["Reports", "Menu"],
    );

  if (
    includesAny(query, [
      "unavailable item",
      "hidden item",
      "menu item",
      "affected by stock",
    ])
  ) {
    const unavailable = (snapshot.menu?.items ?? []).filter(
      (item) => !item.available,
    );
    const affected = (inventory?.stock ?? []).filter(
      (item) => item.status !== "healthy" && item.affectedMenuItems.length,
    );
    return {
      conclusion: `${unavailable.length} menu item${unavailable.length === 1 ? " is" : "s are"} currently unavailable; ${affected.length} stock risk${affected.length === 1 ? " has" : "s have"} supported menu links.`,
      evidence: [
        ...unavailable.slice(0, 5).map((item) => `${item.name}: unavailable`),
        ...affected
          .slice(0, 5)
          .map(
            (item) =>
              `${item.name} ${stockLabel(item.status)} · may affect ${item.affectedMenuItems.join(", ")}`,
          ),
      ],
      recommendation:
        "Review the affected item and stock evidence before changing customer-menu availability.",
      sources: ["Menu", "Inventory", "Recipes"],
      action: { label: "Open Menu", href: "/manager/menu" },
    };
  }

  if (includesAny(query, ["tomorrow", "forecast", "predict"]))
    return unsupported(
      "A reliable tomorrow forecast is not available yet.",
      "ServeFlow needs enough comparable operating history and the relevant scheduling, purchasing, or demand inputs before making that prediction.",
      ["Business Intelligence"],
    );
  return unsupported(
    "I could not map that question to a supported ServeFlow investigation yet.",
    "Try asking about live attention, delayed service, kitchen stations, staff workload, complaints, inventory risk, recorded revenue, or menu availability.",
    snapshot.unavailable.length ? snapshot.unavailable : ["ServeFlow"],
  );
}

function simple(conclusion: string, sources: string[]): CopilotAnswer {
  return { conclusion, evidence: [], sources };
}
function unsupported(
  conclusion: string,
  evidence: string,
  sources: string[],
): CopilotAnswer {
  return { conclusion, evidence: [evidence], sources };
}
function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}
function stockLabel(value: "out" | "critical" | "low" | "healthy") {
  return {
    out: "out of stock",
    critical: "critical",
    low: "low",
    healthy: "healthy",
  }[value];
}
