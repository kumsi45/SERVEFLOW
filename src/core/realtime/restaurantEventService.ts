import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../database";
import { realtimeStateFromStatus, type RealtimeConnectionState } from "./realtimeNotifications";

export const RESTAURANT_REALTIME_TABLES = [
  "orders", "order_items", "order_invoices", "restaurant_tables",
  "restaurant_staff", "cashier_shifts", "cash_reconciliations", "shift_activity_logs",
  "cashier_shift_expenses", "cashier_cash_handovers",
  "kitchen_order_station_progress", "restaurant_table_waiter_assignments",
  "kitchen_inventory_requests", "inventory_items", "manager_customer_complaints",
  "menu_items", "kitchen_stations", "restaurants",
  "staff_activity_log", "manager_ai_recommendation_decisions",
  "waiter_assistance_requests", "receipt_generation_events",
  "order_cancellation_requests",
  "inventory_movements", "inventory_categories", "inventory_suppliers",
  "inventory_storage_locations", "inventory_units",
] as const;

const INVENTORY_TABLES = new Set<string>([
  "inventory_items", "inventory_movements", "inventory_categories",
  "inventory_suppliers", "inventory_storage_locations", "inventory_units",
]);
const DEFAULT_RESTAURANT_REALTIME_TABLES = RESTAURANT_REALTIME_TABLES
  .filter(table => !INVENTORY_TABLES.has(table));

function normalizeTables(tables: readonly string[]) {
  return [...new Set(tables)].sort();
}

function scopeHash(scope: string) {
  let hash = 5381;
  for (let index = 0; index < scope.length; index += 1) hash = ((hash << 5) + hash) ^ scope.charCodeAt(index);
  return (hash >>> 0).toString(36);
}

export type RestaurantEventType =
  | "ORDER_CREATED" | "ORDER_UPDATED" | "ORDER_ACCEPTED" | "ORDER_PREPARING"
  | "ORDER_READY" | "ORDER_SERVED" | "ORDER_CLOSED" | "PAYMENT_PENDING"
  | "PAYMENT_HELD" | "PAYMENT_PAID" | "PAYMENT_REFUNDED" | "TABLE_OPENED"
  | "TABLE_CLOSED" | "TABLE_UPDATED" | "WAITER_CALL" | "INVENTORY_LOW" | "INVENTORY_OUT" | "SYSTEM_ALERT";

export type RestaurantEvent = {
  id: string;
  restaurantId: string;
  type: RestaurantEventType;
  table: string;
  occurredAt: string;
  record: Record<string, unknown>;
  previous: Record<string, unknown>;
  operation: "INSERT" | "UPDATE" | "DELETE";
};

type Listener = (event: RestaurantEvent) => void;
type StateListener = (state: RealtimeConnectionState) => void;

function text(value: unknown) { return typeof value === "string" ? value.toLowerCase() : ""; }
function mapType(table: string, event: string, row: Record<string, unknown>): RestaurantEventType {
  if (table === "orders") {
    if (event === "INSERT") return "ORDER_CREATED";
    const status = text(row.operational_status ?? row.status);
    return status === "accepted" ? "ORDER_ACCEPTED" : status === "preparing" ? "ORDER_PREPARING"
      : status === "ready" ? "ORDER_READY" : status === "served" ? "ORDER_SERVED"
      : status === "closed" ? "ORDER_CLOSED" : "ORDER_UPDATED";
  }
  if (table === "order_invoices") {
    const status = text(row.payment_status ?? row.status);
    return status === "paid" ? "PAYMENT_PAID" : status === "held" ? "PAYMENT_HELD"
      : status === "refunded" ? "PAYMENT_REFUNDED" : "PAYMENT_PENDING";
  }
  if (table === "restaurant_tables") {
    if (event === "UPDATE" && table === "restaurant_tables") return "TABLE_UPDATED";
    return ["closed", "available", "idle"].includes(text(row.status)) ? "TABLE_CLOSED" : "TABLE_OPENED";
  }
  if (table === "kitchen_inventory_requests" || table === "inventory_items") {
    const quantity = Number(row.current_quantity ?? row.quantity ?? 1);
    return quantity <= 0 ? "INVENTORY_OUT" : "INVENTORY_LOW";
  }
  if (table === "notifications" && text(row.type).includes("waiter")) return "WAITER_CALL";
  return "SYSTEM_ALERT";
}

function canonicalEvent(table: string, payload: RealtimePostgresChangesPayload<Record<string, unknown>>, restaurantId: string): RestaurantEvent | null {
  const record = (payload.new ?? {}) as Record<string, unknown>;
  const previous = (payload.old ?? {}) as Record<string, unknown>;
  const rowTenant = table === "restaurants" ? record.id ?? previous.id : record.restaurant_id ?? previous.restaurant_id;
  if (rowTenant !== restaurantId) return null; // defense in depth beyond the server filter/RLS
  const rowId = String(record.id ?? previous.id ?? "unknown");
  const stamp = String(record.updated_at ?? record.created_at ?? new Date().toISOString());
  return { id: `${table}:${payload.eventType}:${rowId}:${stamp}`, restaurantId, type: mapType(table, payload.eventType, record), table, occurredAt: stamp, record, previous, operation: payload.eventType };
}

class RestaurantEventStream {
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private state: RealtimeConnectionState = "connecting";
  private recoveryTimer: number | undefined;
  private disposed = false;

  constructor(
    private client: SupabaseClient,
    readonly restaurantId: string,
    private tables: readonly string[],
    private streamKey: string,
  ) { this.connect(); }

  private connect() {
    if (this.disposed || this.channel) return;
    const scope = this.tables.join(",");
    let channel = this.client.channel(`restaurant-events:${this.restaurantId}:${scopeHash(scope)}`);
    for (const table of this.tables) {
      const filter = table === "restaurants" ? `id=eq.${this.restaurantId}` : `restaurant_id=eq.${this.restaurantId}`;
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter }, payload => {
        const event = canonicalEvent(table, payload as RealtimePostgresChangesPayload<Record<string, unknown>>, this.restaurantId);
        if (event) this.listeners.forEach(listener => listener(event));
      });
    }
    this.channel = channel;
    channel.subscribe(status => {
      this.state = realtimeStateFromStatus(status);
      this.stateListeners.forEach(listener => listener(this.state));
    });
    window.addEventListener("online", this.recover);
    document.addEventListener("visibilitychange", this.recoverOnWake);
  }

  private recover = () => {
    window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = window.setTimeout(() => {
      if (!this.channel || this.state === "connected") return;
      const old = this.channel; this.channel = null;
      void this.client.removeChannel(old).finally(() => this.connect());
    }, 250);
  };
  private recoverOnWake = () => { if (document.visibilityState === "visible") this.recover(); };

  subscribe(listener: Listener, stateListener?: StateListener) {
    this.listeners.add(listener);
    if (stateListener) { this.stateListeners.add(stateListener); stateListener(this.state); }
    return () => {
      this.listeners.delete(listener);
      if (stateListener) this.stateListeners.delete(stateListener);
      if (!this.listeners.size && !this.stateListeners.size) this.dispose();
    };
  }

  private dispose() {
    this.disposed = true;
    window.clearTimeout(this.recoveryTimer);
    window.removeEventListener("online", this.recover);
    document.removeEventListener("visibilitychange", this.recoverOnWake);
    if (this.channel) void this.client.removeChannel(this.channel);
    streams.get(this.client)?.delete(this.streamKey);
  }
}

const streams = new WeakMap<SupabaseClient, Map<string, RestaurantEventStream>>();
export function getRestaurantEventStream(
  restaurantId: string,
  client: SupabaseClient = supabase,
  tables: readonly string[] = DEFAULT_RESTAURANT_REALTIME_TABLES,
) {
  let clientStreams = streams.get(client);
  if (!clientStreams) { clientStreams = new Map(); streams.set(client, clientStreams); }
  const normalizedTables = normalizeTables(tables);
  const streamKey = `${restaurantId}|${normalizedTables.join(",")}`;
  let stream = clientStreams.get(streamKey);
  if (!stream) {
    stream = new RestaurantEventStream(client, restaurantId, normalizedTables, streamKey);
    clientStreams.set(streamKey, stream);
  }
  return stream;
}

/** Customer-safe realtime transport. Anonymous QR users cannot SELECT order
 * tables under RLS, so database triggers broadcast only to their secret browser token. */
export function subscribeCustomerTrackingEvents(
  restaurantId: string,
  browserSessionToken: string,
  listener: (record: Record<string, unknown>) => void,
  stateListener?: StateListener,
  client: SupabaseClient = supabase,
) {
  if (!browserSessionToken.trim()) {
    stateListener?.("reconnecting");
    return () => undefined;
  }

  let channel: RealtimeChannel | null = null;
  let disposed = false;
  let reconnectTimer: number | undefined;

  const connect = () => {
    if (disposed || channel) return;
    const next = client.channel(`customer-order:${browserSessionToken}`, { config: { private: false } });
    next.on("broadcast", { event: "order_changed" }, message => {
      const body = (message.payload ?? {}) as Record<string, unknown>;
      const record = (body.new ?? body.record ?? {}) as Record<string, unknown>;
      const previous = (body.old ?? {}) as Record<string, unknown>;
      if ((record.restaurant_id ?? previous.restaurant_id) === restaurantId) listener(record);
    });
    channel = next;
    next.subscribe(status => {
      const state = realtimeStateFromStatus(status);
      stateListener?.(state);
      if (state !== "reconnecting" || disposed) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        const failed = channel;
        channel = null;
        if (failed) void client.removeChannel(failed).finally(connect);
        else connect();
      }, 500);
    });
  };
  const recover = () => {
    if (disposed || !navigator.onLine) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      if (channel) void client.removeChannel(channel).finally(() => { channel = null; connect(); });
      else connect();
    }, 150);
  };
  const recoverOnWake = () => { if (document.visibilityState === "visible") recover(); };

  connect();
  window.addEventListener("online", recover);
  document.addEventListener("visibilitychange", recoverOnWake);
  return () => {
    disposed = true;
    window.clearTimeout(reconnectTimer);
    window.removeEventListener("online", recover);
    document.removeEventListener("visibilitychange", recoverOnWake);
    if (channel) void client.removeChannel(channel);
  };
}

type CompatiblePayload = { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown>; old: Record<string, unknown> };
type CompatibleHandler = (payload: CompatiblePayload) => void | Promise<void>;

/** Fluent compatibility consumer for incremental legacy handlers. It multiplexes the central stream and never creates a channel. */
export function createRestaurantEventConsumer(restaurantId: string, client: SupabaseClient = supabase) {
  const handlers = new Map<string, Set<CompatibleHandler>>();
  let unsubscribe: (() => void) | undefined;
  const consumer = {
    onTable(config: { table: string; event?: "*" | "INSERT" | "UPDATE" | "DELETE"; schema?: string; filter?: string }, handler: CompatibleHandler) {
      const tableHandlers = handlers.get(config.table) ?? new Set<CompatibleHandler>();
      const filtered: CompatibleHandler = payload => {
        if (!config.event || config.event === "*" || config.event === payload.eventType) return handler(payload);
      };
      tableHandlers.add(filtered); handlers.set(config.table, tableHandlers);
      return consumer;
    },
    subscribe(stateListener?: StateListener) {
      unsubscribe = getRestaurantEventStream(restaurantId, client, [...handlers.keys()]).subscribe(event => {
        const payload = { eventType: event.operation, new: event.record, old: event.previous };
        handlers.get(event.table)?.forEach(handler => void handler(payload));
      }, stateListener);
      return consumer;
    },
    unsubscribe() { unsubscribe?.(); unsubscribe = undefined; },
  };
  return consumer;
}
