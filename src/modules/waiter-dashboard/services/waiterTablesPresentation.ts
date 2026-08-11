import type {
  WaiterDashboardTable,
  WaiterTableMetric,
} from "../types";

export type WaiterTableCardState = "free" | "active" | "ready" | "bill";
export type WaiterTableFilter = "all" | WaiterTableCardState;

export type WaiterTableCardModel = {
  table: WaiterDashboardTable;
  metric: WaiterTableMetric | null;
  state: WaiterTableCardState;
};

const statePriority: Record<WaiterTableCardState, number> = {
  ready: 0,
  bill: 1,
  active: 2,
  free: 3,
};

export function resolveWaiterTableState(
  table: WaiterDashboardTable,
  metric: WaiterTableMetric | null,
): WaiterTableCardState {
  if (!table.activeOrderId) return "free";
  if (metric?.lifecycleStatus === "ready_to_serve") return "ready";
  if (
    metric?.lifecycleStatus === "needs_bill" ||
    metric?.lifecycleStatus === "billing"
  ) return "bill";
  return "active";
}

export function buildWaiterTableCards(
  tables: WaiterDashboardTable[],
  metrics: Map<string, WaiterTableMetric>,
) {
  return tables
    .map((table): WaiterTableCardModel => {
      const metric = table.activeOrderId
        ? (metrics.get(table.activeOrderId) ?? null)
        : null;
      return { table, metric, state: resolveWaiterTableState(table, metric) };
    })
    .sort(
      (left, right) =>
        statePriority[left.state] - statePriority[right.state] ||
        left.table.tableNumber - right.table.tableNumber,
    );
}

export function filterWaiterTableCards(
  cards: WaiterTableCardModel[],
  filter: WaiterTableFilter,
  search: string,
) {
  const query = search.trim().toLowerCase();
  return cards.filter(({ table, state }) => {
    if (filter !== "all" && state !== filter) return false;
    if (!query) return true;
    return (
      String(table.tableNumber).includes(query) ||
      (table.tableLabel ?? "").toLowerCase().includes(query)
    );
  });
}

export function waiterTableCounts(cards: WaiterTableCardModel[]) {
  return cards.reduce(
    (counts, card) => {
      counts.all += 1;
      counts[card.state] += 1;
      return counts;
    },
    { all: 0, free: 0, active: 0, ready: 0, bill: 0 },
  );
}
