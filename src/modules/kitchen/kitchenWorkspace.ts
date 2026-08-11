import type { KitchenOrder } from "./types";

export type KitchenServiceType = "dine-in" | "takeaway" | "delivery";
export type KitchenServiceFilter = "all" | KitchenServiceType;
export type KitchenStateFilter = "all" | "accepted" | "preparing" | "ready";
export type KitchenSortDirection = "oldest" | "newest";

export type KitchenWorkspaceFilters = {
  stationId: "all" | string;
  service: KitchenServiceFilter;
  state: KitchenStateFilter;
  search?: string;
};

export function getKitchenOrderStationIds(order: KitchenOrder): string[] {
  return Array.from(
    new Set(
      [
        ...order.stationProgress.map((progress) => progress.stationId),
        ...order.items.map((item) => item.kitchenStationId),
      ].filter((stationId): stationId is string => Boolean(stationId)),
    ),
  );
}

export function getKitchenOrderStationNames(order: KitchenOrder): string[] {
  return Array.from(
    new Set(
      [
        ...order.stationProgress.map((progress) => progress.stationName),
        ...order.items.map((item) => item.kitchenStationName),
      ].filter((stationName): stationName is string => Boolean(stationName)),
    ),
  );
}

export function getKitchenTicketIdentity(order: KitchenOrder): string {
  const stationIdentity =
    getKitchenOrderStationIds(order).sort().join("+") || "unassigned";
  return `${order.id}:${stationIdentity}:${order.kitchenBatchKey ?? "initial"}`;
}

export function getKitchenTicketReceivedAt(order: KitchenOrder): string {
  if (order.kitchenBatchKey && order.kitchenBatchKey !== "initial") {
    const appendedAt = order.items
      .map((item) => item.appendedAt)
      .filter((value): value is string => Boolean(value))
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort();

    if (appendedAt[0]) return appendedAt[0];
  }

  return order.createdAt;
}

export function trackNewKitchenTicketIdentities(
  orders: readonly KitchenOrder[],
  seenTicketIdentities: Set<string>,
): string[] {
  const newTicketIdentities = orders
    .map(getKitchenTicketIdentity)
    .filter((identity) => !seenTicketIdentities.has(identity));

  for (const order of orders) {
    seenTicketIdentities.add(getKitchenTicketIdentity(order));
  }

  return newTicketIdentities;
}

export function kitchenServiceType(order: KitchenOrder): KitchenServiceType {
  if (order.serviceType) return order.serviceType;
  return order.tableNumber ? "dine-in" : "takeaway";
}

export function kitchenServiceLabel(serviceType: KitchenServiceType) {
  if (serviceType === "dine-in") return "Dine-in";
  if (serviceType === "delivery") return "Delivery";
  return "Takeaway";
}

export function filterKitchenWorkspaceOrders(
  orders: KitchenOrder[],
  filters: KitchenWorkspaceFilters,
): KitchenOrder[] {
  const query = filters.search?.trim().toLowerCase() ?? "";

  return orders.filter((order) => {
      const matchesStation =
        filters.stationId === "all" ||
        getKitchenOrderStationIds(order).includes(filters.stationId);
      const matchesService =
        filters.service === "all" ||
        kitchenServiceType(order) === filters.service;
      const matchesState =
        filters.state === "all" || order.status === filters.state;
      const matchesSearch =
        !query ||
        order.id.toLowerCase().includes(query) ||
        (order.displayNumber ?? "").toLowerCase().includes(query) ||
        (order.kitchenTicketNumber ?? "").toLowerCase().includes(query) ||
        (order.customerName ?? "").toLowerCase().includes(query) ||
        (order.tableNumber ?? "").toLowerCase().includes(query) ||
        order.items.some((item) => item.name.toLowerCase().includes(query));

      return matchesStation && matchesService && matchesState && matchesSearch;
    });
}

export function getKitchenQueueEnteredAt(order: KitchenOrder): number {
  return new Date(getKitchenTicketReceivedAt(order)).getTime();
}

export function sortKitchenWorkspaceOrders(
  orders: KitchenOrder[],
  direction: KitchenSortDirection,
): KitchenOrder[] {
  const multiplier = direction === "oldest" ? 1 : -1;

  return [...orders].sort((left, right) => {
    const timestampDifference =
      getKitchenQueueEnteredAt(left) - getKitchenQueueEnteredAt(right);
    return timestampDifference * multiplier;
  });
}
