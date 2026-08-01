import { supabase } from "../database";
import {
  generateKitchenTicketPayload,
  generateReceiptPayload,
  routeKitchenOutput,
  type KitchenOutputMode,
  type KitchenTicketPayload,
  type ReceiptPayload,
  type RuntimePrinter,
  type RuntimeStationMapping,
} from "./runtime";

export type StaffPrintRuntime = {
  kitchenOutputMode: KitchenOutputMode;
  printers: RuntimePrinter[];
  mappings: RuntimeStationMapping[];
};

export async function loadStaffPrintRuntime(restaurantId: string): Promise<StaffPrintRuntime> {
  const { data, error } = await supabase.rpc("get_staff_print_runtime", { target_restaurant_id: restaurantId });
  if (error) throw new Error(error.message);
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    kitchenOutputMode: String(payload.kitchen_output_mode ?? "kds") as KitchenOutputMode,
    printers: (Array.isArray(payload.printers) ? payload.printers : []).map((value) => {
      const row = value as Record<string, unknown>;
      return { id: String(row.id), purpose: String(row.purpose), enabled: Boolean(row.enabled), status: String(row.status), priority: Number(row.priority ?? 100) };
    }),
    mappings: (Array.isArray(payload.station_mappings) ? payload.station_mappings : []).map((value) => {
      const row = value as Record<string, unknown>;
      return { kitchenStationId: String(row.kitchen_station_id), printerId: String(row.printer_id), active: Boolean(row.active) };
    }),
  };
}

export async function prepareKitchenDispatch(restaurantId: string, ticket: KitchenTicketPayload) {
  const runtime = await loadStaffPrintRuntime(restaurantId);
  return {
    ticket: generateKitchenTicketPayload(ticket),
    routes: routeKitchenOutput({ mode: runtime.kitchenOutputMode, stationId: ticket.station ?? null, printers: runtime.printers, mappings: runtime.mappings }),
  };
}

export function prepareReceipt(payload: ReceiptPayload) {
  return generateReceiptPayload(payload);
}
