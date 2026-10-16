import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createBrowserUuid } from "../../core/browser/createBrowserUuid";

let client: SupabaseClient | undefined;
/** Dedicated session namespace; imports do not refresh staff sessions. */
export function getPlatformAdminClient() {
  if (client) return client;
  const key = "serveflow.platform-admin.tab";
  const tab = sessionStorage.getItem(key) ?? createBrowserUuid();
  sessionStorage.setItem(key, tab);
  client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { storage: sessionStorage, storageKey: `serveflow-platform-admin:${tab}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
