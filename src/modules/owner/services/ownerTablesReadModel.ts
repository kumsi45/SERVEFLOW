export type OwnerTableSessionCandidate = {
  restaurant_id: string;
  table_id: string | null;
  status: string;
  dining_session_status: string | null;
  table_released_at: string | null;
};

export function isCanonicalOwnerTableOccupancy(
  order: OwnerTableSessionCandidate,
  restaurantId: string,
  tableId: string,
) {
  return (
    order.restaurant_id === restaurantId &&
    order.table_id === tableId &&
    order.dining_session_status === "open" &&
    order.table_released_at === null &&
    order.status !== "cancelled"
  );
}

export function getOccupiedOwnerTableIds(
  orders: OwnerTableSessionCandidate[],
  restaurantId: string,
) {
  return new Set(
    orders
      .filter(
        (order) =>
          order.restaurant_id === restaurantId &&
          order.table_id !== null &&
          order.dining_session_status === "open" &&
          order.table_released_at === null &&
          order.status !== "cancelled",
      )
      .map((order) => order.table_id as string),
  );
}
