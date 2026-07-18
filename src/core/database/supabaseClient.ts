import { createClient } from "@supabase/supabase-js";
import { createBrowserUuid } from "../browser/createBrowserUuid";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing environment variable: VITE_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  throw new Error("Missing environment variable: VITE_SUPABASE_ANON_KEY");
}

const STAFF_TAB_ID_KEY = "serveflow.staff-tab-id";
function getStaffTabId() {
  let value = sessionStorage.getItem(STAFF_TAB_ID_KEY);
  if (!value) {
    value = createBrowserUuid();
    sessionStorage.setItem(STAFF_TAB_ID_KEY, value);
  }
  return value;
}

// A Supabase session is owned by one browser tab. Refresh preserves it, while
// another tab receives a different storage namespace and cannot replace it.
const staffTabId = getStaffTabId();
const isolatedStaffStorage = {
  getItem: (key: string) => sessionStorage.getItem(key),
  setItem: (key: string, value: string) => sessionStorage.setItem(key, value),
  removeItem: (key: string) => sessionStorage.removeItem(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: isolatedStaffStorage,
    storageKey: `serveflow-staff-auth:${staffTabId}`,
  },
});
