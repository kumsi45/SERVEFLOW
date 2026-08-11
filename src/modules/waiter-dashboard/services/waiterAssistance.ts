import type { WaiterAssistanceRequest } from "../types";

export const WAITER_ASSISTANCE_STALE_MS = 30 * 60 * 1000;

export function activeWaiterAssistanceRequests(
  requests: readonly WaiterAssistanceRequest[],
  assignedTableIds: ReadonlySet<string>,
  now = Date.now(),
) {
  const cutoff = now - WAITER_ASSISTANCE_STALE_MS;
  return requests.filter(
    (request) =>
      (request.status === "pending" || request.status === "acknowledged") &&
      assignedTableIds.has(request.tableId) &&
      Number.isFinite(Date.parse(request.requestedAt)) &&
      Date.parse(request.requestedAt) >= cutoff,
  );
}
