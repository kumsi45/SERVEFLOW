import { supabase } from "../../../core/database";

export type AiPriority = "critical" | "high" | "medium" | "low";
export type AiArea =
  | "Kitchen"
  | "Waiters"
  | "Cashier"
  | "Restaurant"
  | "Customer Service"
  | "Dining Flow";
export type AiRecommendationType =
  "kitchen" | "waiter" | "cashier" | "restaurant" | "customer";
export type AiDecision = "applied" | "ignored" | "remind_later";

export type ManagerAiAlert = {
  id: string;
  priority: AiPriority;
  time: string;
  description: string;
  affectedArea: AiArea;
  suggestedAction: string;
};

export type ManagerAiRecommendation = {
  id: string;
  type: AiRecommendationType;
  priority: AiPriority;
  recommendation: string;
  reason: string;
  expectedBenefit: string;
  confidence: number;
};

export type ManagerAiPrediction = {
  id: string;
  priority: AiPriority;
  prediction: string;
  reason: string;
  confidence: number;
};

export type ManagerAiLearning = {
  id: string;
  learning: string;
  reason: string;
  suggestedImprovement: string;
  dateLearned: string;
};

export type ManagerAiHealth = {
  overall: number;
  trend: "improving" | "steady" | "declining";
  breakdown: Array<{
    label: string;
    score: number;
    trend: "up" | "flat" | "down";
  }>;
};

export type ManagerAiOperationsSnapshot = {
  alerts: ManagerAiAlert[];
  recommendations: ManagerAiRecommendation[];
  predictions: ManagerAiPrediction[];
  health: ManagerAiHealth;
  learning: ManagerAiLearning[];
  generatedAt: string;
};

type StationRow = {
  id: string;
  name: string;
  active: boolean;
  paused_at: string | null;
};
type StaffRow = {
  id: string;
  display_name: string | null;
  role: string;
  active: boolean;
  staff_session_active?: boolean | null;
  assigned_kitchen_station_id?: string | null;
};
type OrderRow = {
  id: string;
  table_id: string | null;
  table_number: string | null;
  status: string;
  order_source: string | null;
  customer_name: string | null;
  created_at: string;
  dining_session_opened_at?: string | null;
  bill_requested_at?: string | null;
  payment_verified_at?: string | null;
  total_price?: number | string | null;
};
type ItemRow = {
  id: string;
  order_id: string;
  kitchen_station_id: string | null;
  kitchen_status: string | null;
  quantity: number | string;
  notes?: string | null;
  created_at: string;
  appended_at?: string | null;
  kitchen_preparation_started_at?: string | null;
  kitchen_ready_marked_at?: string | null;
  kitchen_completed_at?: string | null;
};
type AssignmentRow = { table_id: string; waiter_staff_id: string };
type ComplaintRow = {
  id: string;
  order_id: string | null;
  status: string;
  severity: string;
  created_at: string;
};
type InvoiceRow = {
  order_id: string;
  payment_status: string;
  created_at: string;
  paid_at?: string | null;
};

const WAIT_MINUTES_CRITICAL = 25;
const BILL_WAIT_MINUTES = 12;
const KITCHEN_DELAY_MINUTES = 25;

function minutesSince(value: string | null | undefined, now: Date) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function priorityRank(priority: AiPriority) {
  return (
    { critical: 0, high: 1, medium: 2, low: 3 } as Record<AiPriority, number>
  )[priority];
}

function groupBy<T, K extends string>(
  rows: T[],
  key: (row: T) => K | null | undefined,
) {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    map.set(value, [...(map.get(value) ?? []), row]);
  }
  return map;
}

function isVip(order: OrderRow) {
  return (order.customer_name ?? "").toLowerCase().includes("vip");
}

function orderOpenedAt(order: OrderRow) {
  return order.dining_session_opened_at ?? order.created_at;
}

export async function loadManagerAiOperations(
  restaurantId: string,
): Promise<ManagerAiOperationsSnapshot> {
  const now = new Date();
  const historyStart = new Date(now);
  historyStart.setDate(historyStart.getDate() - 28);

  const [
    stationsResult,
    staffResult,
    openOrdersResult,
    itemsResult,
    assignmentsResult,
    complaintsResult,
    historyOrdersResult,
    historyItemsResult,
    invoicesResult,
  ] = await Promise.all([
    supabase
      .from("kitchen_stations")
      .select("id,name,active,paused_at")
      .eq("restaurant_id", restaurantId)
      .is("archived_at", null),
    supabase
      .from("restaurant_staff")
      .select(
        "id,display_name,role,active,staff_session_active,assigned_kitchen_station_id",
      )
      .eq("restaurant_id", restaurantId)
      .eq("active", true),
    supabase
      .from("orders")
      .select(
        "id,table_id,table_number,status,order_source,customer_name,created_at,dining_session_opened_at,bill_requested_at,payment_verified_at,total_price",
      )
      .eq("restaurant_id", restaurantId)
      .eq("dining_session_status", "open"),
    supabase
      .from("order_items")
      .select(
        "id,order_id,kitchen_station_id,kitchen_status,quantity,notes,created_at,appended_at,kitchen_preparation_started_at,kitchen_ready_marked_at,kitchen_completed_at",
      )
      .eq("restaurant_id", restaurantId)
      .in("kitchen_status", ["paid", "preparing", "ready", "completed"]),
    supabase
      .from("restaurant_table_waiter_assignments")
      .select("table_id,waiter_staff_id")
      .eq("restaurant_id", restaurantId)
      .eq("active", true),
    supabase
      .from("manager_customer_complaints")
      .select("id,order_id,status,severity,created_at")
      .eq("restaurant_id", restaurantId)
      .neq("status", "resolved"),
    supabase
      .from("orders")
      .select(
        "id,table_number,status,created_at,dining_session_opened_at,completed_at,updated_at,table_released_at,order_source,customer_name,total_price",
      )
      .eq("restaurant_id", restaurantId)
      .gte("created_at", historyStart.toISOString())
      .lt("created_at", now.toISOString()),
    supabase
      .from("order_items")
      .select(
        "id,order_id,kitchen_station_id,kitchen_status,created_at,appended_at,kitchen_preparation_started_at,kitchen_ready_marked_at,kitchen_completed_at",
      )
      .eq("restaurant_id", restaurantId)
      .gte("created_at", historyStart.toISOString())
      .lt("created_at", now.toISOString()),
    supabase
      .from("order_invoices")
      .select("order_id,payment_status,created_at,paid_at")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", historyStart.toISOString())
      .lt("created_at", now.toISOString()),
  ]);

  for (const result of [
    stationsResult,
    staffResult,
    openOrdersResult,
    itemsResult,
    assignmentsResult,
    complaintsResult,
    historyOrdersResult,
    historyItemsResult,
    invoicesResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const stations = (stationsResult.data ?? []) as StationRow[];
  const staff = (staffResult.data ?? []) as StaffRow[];
  const openOrders = (openOrdersResult.data ?? []) as OrderRow[];
  const items = (itemsResult.data ?? []) as ItemRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const complaints = (complaintsResult.data ?? []) as ComplaintRow[];
  const historyOrders = (historyOrdersResult.data ?? []) as Array<
    OrderRow & {
      completed_at?: string | null;
      updated_at?: string | null;
      table_released_at?: string | null;
    }
  >;
  const historyItems = (historyItemsResult.data ?? []) as ItemRow[];
  const invoices = (invoicesResult.data ?? []) as InvoiceRow[];
  const paymentDueByOrder = new Map(
    invoices
      .filter(
        (invoice) =>
          invoice.payment_status === "held" ||
          invoice.payment_status === "pending",
      )
      .map((invoice) => [invoice.order_id, invoice]),
  );

  const itemsByStation = groupBy(
    items.filter((item) => item.kitchen_status !== "completed"),
    (item) => item.kitchen_station_id,
  );
  const itemsByOrder = groupBy(items, (item) => item.order_id);
  const assignmentsByWaiter = groupBy(
    assignments,
    (assignment) => assignment.waiter_staff_id,
  );
  const assignmentsByTable = new Map(
    assignments.map((assignment) => [
      assignment.table_id,
      assignment.waiter_staff_id,
    ]),
  );
  const kitchenStaffByStation = groupBy(
    staff.filter(
      (member) => member.role === "kitchen" && member.staff_session_active,
    ),
    (member) => member.assigned_kitchen_station_id,
  );
  const waiterStaff = staff.filter((member) => member.role === "waiter");
  const activeCashiers = staff.filter(
    (member) => member.role === "cashier" && member.staff_session_active,
  ).length;

  const alerts: ManagerAiAlert[] = [];
  const recommendations: ManagerAiRecommendation[] = [];
  const predictions: ManagerAiPrediction[] = [];
  const learning: ManagerAiLearning[] = [];

  for (const station of stations) {
    const stationItems = itemsByStation.get(station.id) ?? [];
    const queue = stationItems.reduce(
      (sum, item) => sum + Number(item.quantity ?? 1),
      0,
    );
    const delayed = stationItems.filter(
      (item) =>
        minutesSince(
          item.kitchen_preparation_started_at ??
            item.appended_at ??
            item.created_at,
          now,
        ) >= KITCHEN_DELAY_MINUTES,
    ).length;
    const activeCooks = kitchenStaffByStation.get(station.id)?.length ?? 0;
    if (queue >= 10 || delayed >= 2) {
      alerts.push({
        id: `station:${station.id}:overload`,
        priority: "critical",
        time: now.toISOString(),
        description: `${station.name} Station Overloaded`,
        affectedArea: "Kitchen",
        suggestedAction:
          activeCooks === 0
            ? `Assign a cook to ${station.name}.`
            : `Move low-priority tickets away from ${station.name}.`,
      });
      recommendations.push({
        id: `rec:station:${station.id}:rebalance`,
        type: "kitchen",
        priority: "critical",
        recommendation: `Rebalance ${station.name} station tickets.`,
        reason: `${station.name} has ${queue} queued items and ${delayed} delayed ticket groups.`,
        expectedBenefit: "Reduce kitchen delay and improve ticket flow.",
        confidence: clampScore(72 + delayed * 7 + Math.min(queue, 15)),
      });
    } else if (queue >= 6) {
      alerts.push({
        id: `station:${station.id}:growing`,
        priority: "medium",
        time: now.toISOString(),
        description: `${station.name} Station Queue Growing`,
        affectedArea: "Kitchen",
        suggestedAction: `Watch ${station.name} and prepare a reassignment if delay rises.`,
      });
    }
    if (queue > 0 && activeCooks === 0) {
      recommendations.push({
        id: `rec:station:${station.id}:cook`,
        type: "kitchen",
        priority: "high",
        recommendation: `Call a cook to ${station.name}.`,
        reason: `${station.name} has active tickets but no active cook assigned.`,
        expectedBenefit: "Faster ticket acceptance and fewer overdue items.",
        confidence: 92,
      });
    }
  }

  for (const waiter of waiterStaff) {
    const tableCount = assignmentsByWaiter.get(waiter.id)?.length ?? 0;
    if (tableCount >= 8) {
      alerts.push({
        id: `waiter:${waiter.id}:overload`,
        priority: "critical",
        time: now.toISOString(),
        description: `Waiter ${waiter.display_name ?? "Unknown"} Serving Too Many Tables`,
        affectedArea: "Waiters",
        suggestedAction: "Move one or two tables to another active waiter.",
      });
      recommendations.push({
        id: `rec:waiter:${waiter.id}:balance`,
        type: "waiter",
        priority: "critical",
        recommendation: `Balance ${waiter.display_name ?? "this waiter"}'s section.`,
        reason: `${waiter.display_name ?? "This waiter"} currently serves ${tableCount} active tables. Restaurant target is about 5.`,
        expectedBenefit:
          "Faster service response and fewer missed bill requests.",
        confidence: clampScore(78 + (tableCount - 7) * 5),
      });
    }
  }

  const waitingOrders = openOrders.filter(
    (order) => minutesSince(orderOpenedAt(order), now) >= WAIT_MINUTES_CRITICAL,
  );
  const billWaitOrders = openOrders.filter((order) => {
    const invoice = paymentDueByOrder.get(order.id);
    return (
      invoice &&
      minutesSince(order.bill_requested_at ?? invoice.created_at, now) >=
        BILL_WAIT_MINUTES
    );
  });
  const vipWaiting = openOrders.filter(
    (order) => isVip(order) && minutesSince(orderOpenedAt(order), now) >= 5,
  );
  if (
    billWaitOrders.length >= 3 ||
    (billWaitOrders.length > 0 && activeCashiers === 0)
  ) {
    alerts.push({
      id: "cashier:queue",
      priority: billWaitOrders.length >= 3 ? "critical" : "high",
      time: now.toISOString(),
      description: "Payment Due Queue Increasing",
      affectedArea: "Cashier",
      suggestedAction:
        "Process payment-due bills first or open another cashier.",
    });
    recommendations.push({
      id: "rec:cashier:open-second",
      type: "cashier",
      priority: "high",
      recommendation: "Open a second cashier or prioritize payment-due bills.",
      reason: `${billWaitOrders.length} table(s) have had payment due for more than ${BILL_WAIT_MINUTES} minutes.`,
      expectedBenefit: "Shorter collection delay and faster table turnover.",
      confidence: clampScore(76 + billWaitOrders.length * 5),
    });
  }
  for (const order of waitingOrders.slice(0, 5)) {
    alerts.push({
      id: `table:${order.id}:wait`,
      priority: "high",
      time: now.toISOString(),
      description: `Table ${order.table_number ?? "-"} Waiting Too Long`,
      affectedArea: "Dining Flow",
      suggestedAction: "Check service status and assign waiter attention.",
    });
  }
  for (const order of vipWaiting.slice(0, 3)) {
    alerts.push({
      id: `vip:${order.id}`,
      priority: "critical",
      time: now.toISOString(),
      description: "VIP Guest Waiting",
      affectedArea: "Customer Service",
      suggestedAction: `Prioritize table ${order.table_number ?? "-"} service.`,
    });
    recommendations.push({
      id: `rec:vip:${order.id}`,
      type: "customer",
      priority: "critical",
      recommendation: `Prioritize VIP table ${order.table_number ?? "-"}.`,
      reason: `VIP guest has waited ${minutesSince(orderOpenedAt(order), now)} minutes.`,
      expectedBenefit: "Protect high-priority service experience.",
      confidence: 94,
    });
  }
  if (complaints.length > 0) {
    recommendations.push({
      id: "rec:complaints:resolve",
      type: "customer",
      priority: "high",
      recommendation:
        "Resolve open customer complaints before the next seating wave.",
      reason: `${complaints.length} unresolved complaint(s) are active.`,
      expectedBenefit: "Reduce service escalation risk.",
      confidence: 88,
    });
  }

  const currentHour = now.getHours();
  const nextHour = (currentHour + 1) % 24;
  const ordersByHour = groupBy(historyOrders, (order) =>
    String(new Date(order.created_at).getHours()),
  );
  const currentHistorical = ordersByHour.get(String(currentHour))?.length ?? 0;
  const nextHistorical = ordersByHour.get(String(nextHour))?.length ?? 0;
  const busiestHour = [...ordersByHour.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )[0];
  if (nextHistorical >= Math.max(6, currentHistorical * 1.25)) {
    predictions.push({
      id: "pred:rush:next-hour",
      priority: "high",
      prediction: `${nextHour < 12 ? "Lunch" : "Dinner"} rush expected in the next hour.`,
      reason: `This restaurant averaged ${nextHistorical} orders around ${String(nextHour).padStart(2, "0")}:00 over recent history.`,
      confidence: clampScore(70 + Math.min(nextHistorical, 20)),
    });
  }
  if (busiestHour) {
    learning.push({
      id: "learn:peak-hour",
      learning: `Peak operational hour is usually ${busiestHour[0].padStart(2, "0")}:00.`,
      reason: `${busiestHour[1].length} historical orders were recorded in that hour over this restaurant's recent data.`,
      suggestedImprovement:
        "Schedule waiter, cashier, and kitchen coverage before this window.",
      dateLearned: now.toISOString(),
    });
  }

  const historyItemsByStation = groupBy(
    historyItems,
    (item) => item.kitchen_station_id,
  );
  for (const station of stations) {
    const stationHistory = historyItemsByStation.get(station.id) ?? [];
    const delayedHistory = stationHistory.filter(
      (item) =>
        minutesSince(
          item.kitchen_preparation_started_at ??
            item.appended_at ??
            item.created_at,
          new Date(
            item.kitchen_completed_at ??
              item.kitchen_ready_marked_at ??
              item.created_at,
          ),
        ) >= KITCHEN_DELAY_MINUTES,
    ).length;
    if (
      stationHistory.length >= 8 &&
      delayedHistory / stationHistory.length >= 0.25
    ) {
      predictions.push({
        id: `pred:station:${station.id}`,
        priority: "medium",
        prediction: `${station.name} station likely to run behind if demand increases.`,
        reason: `${Math.round((delayedHistory / stationHistory.length) * 100)}% of recent ${station.name} items exceeded the delay threshold.`,
        confidence: 82,
      });
      learning.push({
        id: `learn:station:${station.id}`,
        learning: `${station.name} delays recur in this restaurant's recent data.`,
        reason: `${delayedHistory} of ${stationHistory.length} recent station items were delayed.`,
        suggestedImprovement: `Add coverage or rebalance tickets before ${station.name} reaches rush volume.`,
        dateLearned: now.toISOString(),
      });
    }
  }

  if (waitingOrders.length >= 3) {
    recommendations.push({
      id: "rec:restaurant:seat-service",
      type: "restaurant",
      priority: "high",
      recommendation: "Send floor support to slow tables.",
      reason: `${waitingOrders.length} active tables exceed the service wait threshold.`,
      expectedBenefit:
        "Lower average customer wait time and reduce complaints.",
      confidence: 86,
    });
  }

  const kitchenScore = clampScore(
    100 -
      items.filter(
        (item) =>
          item.kitchen_status !== "completed" &&
          minutesSince(
            item.kitchen_preparation_started_at ??
              item.appended_at ??
              item.created_at,
            now,
          ) >= KITCHEN_DELAY_MINUTES,
      ).length *
        8,
  );
  const waiterScore = clampScore(
    100 -
      waiterStaff.reduce(
        (penalty, waiter) =>
          penalty +
          Math.max(0, (assignmentsByWaiter.get(waiter.id)?.length ?? 0) - 5) *
            4,
        0,
      ),
  );
  const cashierScore = clampScore(
    100 -
      billWaitOrders.length * 10 -
      (activeCashiers === 0 && billWaitOrders.length > 0 ? 20 : 0),
  );
  const customerScore = clampScore(
    100 - complaints.length * 10 - vipWaiting.length * 8,
  );
  const diningScore = clampScore(100 - waitingOrders.length * 7);
  const overall = clampScore(
    (kitchenScore + waiterScore + cashierScore + customerScore + diningScore) /
      5,
  );

  if (recommendations.length === 0) {
    recommendations.push({
      id: "rec:steady:monitor",
      type: "restaurant",
      priority: "low",
      recommendation: "Maintain current staffing and monitor rush signals.",
      reason:
        "No critical overload, billing, complaint, or VIP wait signals are active.",
      expectedBenefit:
        "Keep operations stable without unnecessary intervention.",
      confidence: 76,
    });
  }
  if (predictions.length === 0) {
    predictions.push({
      id: "pred:steady",
      priority: "low",
      prediction: "No immediate operational spike predicted.",
      reason:
        "Recent restaurant-scoped order history does not show a near-term surge pattern.",
      confidence: 72,
    });
  }

  const sortedRecommendations = recommendations
    .sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        b.confidence - a.confidence,
    )
    .slice(0, 12);
  return {
    alerts: alerts
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .slice(0, 14),
    recommendations: sortedRecommendations,
    predictions: predictions
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .slice(0, 8),
    health: {
      overall,
      trend:
        overall >= 85 ? "improving" : overall >= 70 ? "steady" : "declining",
      breakdown: [
        {
          label: "Kitchen",
          score: kitchenScore,
          trend:
            kitchenScore >= 85 ? "up" : kitchenScore >= 70 ? "flat" : "down",
        },
        {
          label: "Waiters",
          score: waiterScore,
          trend: waiterScore >= 85 ? "up" : waiterScore >= 70 ? "flat" : "down",
        },
        {
          label: "Cashier",
          score: cashierScore,
          trend:
            cashierScore >= 85 ? "up" : cashierScore >= 70 ? "flat" : "down",
        },
        {
          label: "Customer Service",
          score: customerScore,
          trend:
            customerScore >= 85 ? "up" : customerScore >= 70 ? "flat" : "down",
        },
        {
          label: "Dining Flow",
          score: diningScore,
          trend: diningScore >= 85 ? "up" : diningScore >= 70 ? "flat" : "down",
        },
      ],
    },
    learning: learning.slice(0, 8),
    generatedAt: now.toISOString(),
  };
}

export async function logManagerAiDecision(
  restaurantId: string,
  recommendation: ManagerAiRecommendation,
  decision: AiDecision,
) {
  const reminder =
    decision === "remind_later"
      ? new Date(Date.now() + 30 * 60_000).toISOString()
      : null;
  const { error } = await supabase.rpc(
    "log_manager_ai_recommendation_decision",
    {
      target_restaurant_id: restaurantId,
      recommendation_id: recommendation.id,
      recommendation_type: recommendation.type,
      decision,
      title: recommendation.recommendation,
      reason: recommendation.reason,
      confidence: recommendation.confidence,
      reminder_at: reminder,
    },
  );
  if (error) throw new Error(error.message);
}
