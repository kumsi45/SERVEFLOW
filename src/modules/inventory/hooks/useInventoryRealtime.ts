import { useCallback, useEffect, useRef } from "react";
import { canAccessInventory, type InventoryAccessRole } from "../../../core/permissions/inventoryAccess";
import { useRestaurantEvents } from "../../../core/realtime/useRestaurantEvents";
import type { RealtimeConnectionState } from "../../../core/realtime/realtimeNotifications";
import {
  INVENTORY_REALTIME_TABLES,
  type InventoryRealtimeAdminTable,
  type InventoryRealtimeChange,
  type InventoryRealtimeTable,
} from "../services/inventoryRealtimeService";

export type InventoryRealtimeBatch = {
  movementItemIds: string[];
  adminChanges: Partial<Record<InventoryRealtimeAdminTable, InventoryRealtimeChange[]>>;
};

type Options = {
  restaurantId: string;
  staffRole: InventoryAccessRole;
  onBatch: (batch: InventoryRealtimeBatch) => void | Promise<void>;
  onReconcile: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  debounceMs?: number;
};

const isInventoryTable = (table: string): table is InventoryRealtimeTable =>
  (INVENTORY_REALTIME_TABLES as readonly string[]).includes(table);

/** Read-only inventory synchronization. It never writes inventory or workflow data. */
export function useInventoryRealtime({
  restaurantId,
  staffRole,
  onBatch,
  onReconcile,
  onError,
  debounceMs = 100,
}: Options): RealtimeConnectionState {
  const handlers = useRef({ onBatch, onReconcile, onError });
  handlers.current = { onBatch, onReconcile, onError };
  const movementItems = useRef(new Set<string>());
  const adminChanges = useRef(new Map<InventoryRealtimeAdminTable, Map<string, InventoryRealtimeChange>>());
  const flushTimer = useRef<number | undefined>(undefined);
  const reconcileTimer = useRef<number | undefined>(undefined);
  const connectedOnce = useRef(false);
  const authorizedRestaurantId = canAccessInventory(staffRole) ? restaurantId : "";

  const flush = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    const batch: InventoryRealtimeBatch = {
      movementItemIds: [...movementItems.current],
      adminChanges: {},
    };
    movementItems.current.clear();
    for (const [table, rows] of adminChanges.current) batch.adminChanges[table] = [...rows.values()];
    adminChanges.current.clear();
    if (!batch.movementItemIds.length && !Object.keys(batch.adminChanges).length) return;
    void Promise.resolve(handlers.current.onBatch(batch)).catch((error) => handlers.current.onError?.(error));
  }, []);

  const onEvent = useCallback((event: {
    table: string;
    operation: "INSERT" | "UPDATE" | "DELETE";
    record: Record<string, unknown>;
    previous: Record<string, unknown>;
  }) => {
    if (!isInventoryTable(event.table)) return;
    const record = event.operation === "DELETE" ? event.previous : event.record;
    const id = typeof record.id === "string" ? record.id : "";
    if (event.table === "inventory_movements") {
      if (event.operation !== "INSERT") return;
      const inventoryItemId = typeof record.inventory_item_id === "string" ? record.inventory_item_id : "";
      if (inventoryItemId) movementItems.current.add(inventoryItemId);
    } else if (id) {
      const table = event.table as InventoryRealtimeAdminTable;
      const rows = adminChanges.current.get(table) ?? new Map<string, InventoryRealtimeChange>();
      rows.set(id, { operation: event.operation, record });
      adminChanges.current.set(table, rows);
    }
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(flush, debounceMs);
  }, [debounceMs, flush]);

  const state = useRestaurantEvents({
    restaurantId: authorizedRestaurantId,
    tables: INVENTORY_REALTIME_TABLES,
    onEvent,
  });

  const scheduleReconcile = useCallback(() => {
    window.clearTimeout(reconcileTimer.current);
    reconcileTimer.current = window.setTimeout(() => {
      void Promise.resolve(handlers.current.onReconcile()).catch((error) => handlers.current.onError?.(error));
    }, 150);
  }, []);

  useEffect(() => {
    if (state !== "connected" || !authorizedRestaurantId) return;
    if (connectedOnce.current) scheduleReconcile();
    else connectedOnce.current = true;
  }, [authorizedRestaurantId, scheduleReconcile, state]);

  useEffect(() => {
    connectedOnce.current = false;
    movementItems.current.clear();
    adminChanges.current.clear();
    window.clearTimeout(flushTimer.current);
    window.clearTimeout(reconcileTimer.current);
  }, [authorizedRestaurantId]);

  useEffect(() => {
    if (!authorizedRestaurantId) return;
    const reconcileOnResume = () => {
      if (document.visibilityState === "visible" && state === "connected" && connectedOnce.current) scheduleReconcile();
    };
    document.addEventListener("visibilitychange", reconcileOnResume);
    return () => document.removeEventListener("visibilitychange", reconcileOnResume);
  }, [authorizedRestaurantId, scheduleReconcile, state]);

  useEffect(() => () => {
    window.clearTimeout(flushTimer.current);
    window.clearTimeout(reconcileTimer.current);
    movementItems.current.clear();
    adminChanges.current.clear();
  }, []);

  return state;
}
