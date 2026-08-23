import { supabase } from "../../../core/database";
import {
  loadInventoryRequests,
  type InventoryRequest,
} from "../../kitchen/services/inventoryRequestService";

export type InventoryKitchenQueueRequest = InventoryRequest & {
  currentQuantity: number | null;
  reorderLevel: number | null;
};

export function partitionInventoryKitchenRequests(requests: InventoryKitchenQueueRequest[]) {
  return {
    awaitingInventory: requests.filter((request) => request.status === "accepted"),
    awaitingKitchen: requests.filter((request) => request.status === "issued"),
    history: requests.filter((request) => (
      request.status === "delivered"
      || request.status === "unable_to_fulfill"
      || request.status === "rejected"
    )),
  };
}

type QueueRow = {
  request_id: string;
  restaurant_id: string;
  inventory_item_id: string;
  item_name: string;
  requested_quantity: number | string;
  unit: string;
  station_id: string | null;
  station_name: string | null;
  requested_by_staff_id: string;
  requested_by_name: string;
  requested_at: string;
  priority: InventoryRequest["urgency"];
  reason: string | null;
  approved_by_staff_id: string;
  approved_by_name: string;
  approved_at: string;
  request_status: "accepted";
  current_quantity: number | string;
  reorder_level: number | string;
};

const mapQueueRow = (row: QueueRow): InventoryKitchenQueueRequest => ({
  id: row.request_id,
  restaurantId: row.restaurant_id,
  inventoryItemId: row.inventory_item_id,
  stationId: row.station_id,
  itemName: row.item_name,
  quantity: Number(row.requested_quantity),
  unit: row.unit,
  urgency: row.priority,
  comment: row.reason,
  status: "accepted",
  rejectionReason: null,
  requestedAt: row.requested_at,
  reviewedAt: row.approved_at,
  acceptedAt: row.approved_at,
  rejectedAt: null,
  issuedAt: null,
  issuedQuantity: null,
  deliveredAt: null,
  confirmedAt: null,
  unableToFulfillAt: null,
  unableToFulfillReason: null,
  stationName: row.station_name,
  requesterName: row.requested_by_name,
  reviewerName: row.approved_by_name,
  fulfillerName: null,
  issuerName: null,
  confirmerName: null,
  unableToFulfillByName: null,
  currentQuantity: Number(row.current_quantity),
  reorderLevel: Number(row.reorder_level),
});

export async function loadInventoryKitchenRequests(
  restaurantId: string,
  staffRole: "owner" | "manager" | "inventory_officer",
): Promise<InventoryKitchenQueueRequest[]> {
  const historyPromise = loadInventoryRequests(restaurantId);
  const queuePromise = staffRole === "manager"
    ? Promise.resolve([] as InventoryKitchenQueueRequest[])
    : supabase.rpc("get_inventory_kitchen_request_queue", {
      target_restaurant_id: restaurantId,
    }).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return ((data ?? []) as QueueRow[]).map(mapQueueRow);
    });

  const [history, queue] = await Promise.all([historyPromise, queuePromise]);
  const queueById = new Map(queue.map((request) => [request.id, request]));
  return history.map((request) => queueById.get(request.id) ?? {
    ...request,
    currentQuantity: null,
    reorderLevel: null,
  });
}

export async function issueInventoryKitchenRequest(restaurantId: string, requestId: string) {
  const { data, error } = await supabase.rpc("issue_kitchen_inventory_request", {
    target_restaurant_id: restaurantId,
    target_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function markInventoryKitchenRequestUnable(
  restaurantId: string,
  requestId: string,
  reason: string,
) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("Unable to fulfill reason is required.");
  const { error } = await supabase.rpc("mark_kitchen_inventory_request_unable_to_fulfill", {
    target_restaurant_id: restaurantId,
    target_request_id: requestId,
    target_reason: normalizedReason,
  });
  if (error) throw new Error(error.message);
}
