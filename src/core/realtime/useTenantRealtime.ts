import { useCallback, useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../database";
import { useRestaurantEvents } from "./useRestaurantEvents";

type TenantRealtimeOptions = {
  channelName: string;
  restaurantId: string;
  tables: readonly string[];
  refresh: () => void | Promise<void>;
  client?: SupabaseClient;
  debounceMs?: number;
  refreshOnConnect?: boolean;
};

/** Canonical tenant subscription with cleanup and network/tab-wake recovery. */
export function useTenantRealtime({ channelName, restaurantId, tables, refresh, client = supabase, debounceMs = 120, refreshOnConnect = true }: TenantRealtimeOptions) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const timer = useRef<number | undefined>(undefined);
  const tableSet = new Set(tables);
  const onEvent = useCallback((event: { table: string }) => {
    if (!tableSet.has(event.table)) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refreshRef.current(), debounceMs);
  }, [debounceMs, tables.join("|")]);
  void channelName;
  const state = useRestaurantEvents({ restaurantId, client, tables, onEvent });
  useEffect(() => {
    if (state === "connected" && refreshOnConnect) void refreshRef.current();
  }, [refreshOnConnect, state]);
  return state;
}
