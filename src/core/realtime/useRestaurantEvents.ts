import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../database";
import type { RealtimeConnectionState } from "./realtimeNotifications";
import { getRestaurantEventStream, type RestaurantEvent } from "./restaurantEventService";

export function useRestaurantEvents(options: { restaurantId: string; onEvent: (event: RestaurantEvent) => void; client?: SupabaseClient; tables?: readonly string[]; enabled?: boolean }) {
  const { restaurantId, client = supabase } = options;
  const tableScope = options.tables ? [...options.tables].sort().join("|") : "default";
  const callback = useRef(options.onEvent); callback.current = options.onEvent;
  const [state, setState] = useState<RealtimeConnectionState>("connecting");
  useEffect(() => {
    if (!restaurantId || options.enabled === false) return;
    return getRestaurantEventStream(restaurantId, client, options.tables).subscribe(event => callback.current(event), setState);
  }, [client, restaurantId, tableScope, options.enabled]);
  return state;
}
