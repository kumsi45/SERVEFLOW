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
  skipInitialConnectRefresh?: boolean;
  enabled?: boolean;
};

/** Canonical tenant subscription with cleanup and network/tab-wake recovery. */
export function useTenantRealtime({ channelName, restaurantId, tables, refresh, client = supabase, debounceMs = 120, refreshOnConnect = true, skipInitialConnectRefresh = false, enabled = true }: TenantRealtimeOptions) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const timer = useRef<number | undefined>(undefined);
  const hasConnected = useRef(false);
  const tableSet = new Set(tables);
  const onEvent = useCallback((event: { table: string }) => {
    if (!tableSet.has(event.table)) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refreshRef.current(), debounceMs);
  }, [debounceMs, tables.join("|")]);
  void channelName;
  const state = useRestaurantEvents({ restaurantId, client, tables, onEvent, enabled });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { hasConnected.current = false; }, [restaurantId]);
  useEffect(() => {
    if (!enabled || state !== "connected" || !refreshOnConnect) return;
    if (!hasConnected.current) {
      hasConnected.current = true;
      if (skipInitialConnectRefresh) return;
    }
    void refreshRef.current();
  }, [enabled, refreshOnConnect, skipInitialConnectRefresh, state]);
  return state;
}
