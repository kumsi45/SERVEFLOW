import { createClient } from "@supabase/supabase-js";
import { createBrowserUuid } from "../../../core/browser/createBrowserUuid";
import type { WaiterSession, WaiterTerminalContext, WaiterTerminalProfile } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const WAITER_SESSION_KEY = "serveflow.waiter.session.v1";
const WAITER_PROFILES_KEY = "serveflow.waiter.terminal-profiles.v1";
const WAITER_TERMINAL_ID_KEY = "serveflow.waiter.terminal-id.v1";
const WAITER_TAB_ID_KEY = "serveflow.waiter-tab-id";
const waiterTabId = sessionStorage.getItem(WAITER_TAB_ID_KEY) ?? createBrowserUuid();
sessionStorage.setItem(WAITER_TAB_ID_KEY, waiterTabId);
const WAITER_AUTH_STORAGE_KEY = `serveflow-waiter-auth:${waiterTabId}`;
let prefetchedWaiterTables: { restaurantSlug: string; rows: unknown[] } | null = null;

if (!supabaseUrl) {
  throw new Error("Missing environment variable: VITE_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  throw new Error("Missing environment variable: VITE_SUPABASE_ANON_KEY");
}

const waiterAuthStorage = {
  getItem: (key: string) => sessionStorage.getItem(key),
  setItem: (key: string, value: string) => sessionStorage.setItem(key, value),
  removeItem: (key: string) => sessionStorage.removeItem(key),
};

export const waiterSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: waiterAuthStorage,
    storageKey: WAITER_AUTH_STORAGE_KEY,
  },
});

// Public terminal context must never inherit an owner/cashier session from the
// shared application client. Waiter identity is resolved only by the PIN endpoint.
const waiterPublicSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: "serveflow-waiter-public-auth",
  },
});

type WaiterContextRow = {
  restaurant_id: string;
  restaurant_slug: string;
  restaurant_name: string;
  logo_url: string | null;
  currency_code?: string | null;
  currency_symbol?: string | null;
  locale?: string | null;
};

type WaiterIdentityRow = WaiterContextRow & {
  staff_id: string;
  user_id: string;
  email: string | null;
  display_name: string;
};

type RestaurantStaffIdentityRow = {
  staff_id: string;
  user_id: string;
  auth_email: string | null;
  employee_id: string;
  display_name: string;
  staff_role: string;
  restaurant_id: string;
  restaurant_slug: string;
  restaurant_name: string;
  logo_url: string | null;
};

function normalizeRestaurant(row: WaiterContextRow): WaiterTerminalContext {
  return {
    id: row.restaurant_id,
    slug: row.restaurant_slug,
    name: row.restaurant_name,
    logoUrl: row.logo_url ?? null,
    currencyCode: row.currency_code ?? null,
    currencySymbol: row.currency_symbol ?? null,
    locale: row.locale ?? null,
  };
}

function storeWaiterSession(session: WaiterSession) {
  sessionStorage.setItem(WAITER_SESSION_KEY, JSON.stringify(session));
}

function getWaiterTerminalId() {
  let terminalId = localStorage.getItem(WAITER_TERMINAL_ID_KEY);
  if (!terminalId) {
    terminalId = createBrowserUuid();
    localStorage.setItem(WAITER_TERMINAL_ID_KEY, terminalId);
  }
  return terminalId;
}

function profileStorageKey(restaurantSlug: string) {
  return `${WAITER_PROFILES_KEY}:${restaurantSlug}`;
}

export function getKnownWaiterProfiles(restaurantSlug: string): WaiterTerminalProfile[] {
  try {
    const value = localStorage.getItem(profileStorageKey(restaurantSlug));
    const profiles = value ? (JSON.parse(value) as WaiterTerminalProfile[]) : [];
    return Array.isArray(profiles)
      ? profiles.filter((profile) => profile?.staffId && profile?.employeeId)
      : [];
  } catch {
    return [];
  }
}

function rememberWaiterProfile(restaurantSlug: string, profile: WaiterTerminalProfile) {
  const profiles = getKnownWaiterProfiles(restaurantSlug).filter(
    (knownProfile) => knownProfile.staffId !== profile.staffId
  );
  localStorage.setItem(
    profileStorageKey(restaurantSlug),
    JSON.stringify([profile, ...profiles].slice(0, 24))
  );
}

export async function resolveWaiterTerminalProfile(
  restaurantSlug: string,
  employeeLookup: string
): Promise<WaiterTerminalProfile> {
  const lookup = employeeLookup.trim();
  if (!lookup) {
    throw new Error("Enter your name or employee ID.");
  }

  const { data, error } = await waiterPublicSupabase.rpc("resolve_restaurant_staff_identity", {
    target_restaurant_slug: restaurantSlug,
    target_employee_identity: lookup,
    target_role: "waiter",
  });
  if (error) throw new Error(error.message);

  const identity = Array.isArray(data) ? (data[0] as RestaurantStaffIdentityRow | undefined) : undefined;
  if (!identity) {
    throw new Error("No active waiter matched that name or employee ID.");
  }

  const profile: WaiterTerminalProfile = {
    staffId: identity.staff_id,
    employeeId: identity.employee_id,
    displayName: identity.display_name,
    role: "Waiter",
    shift: null,
  };
  rememberWaiterProfile(restaurantSlug, profile);
  return profile;
}

export async function loadWaiterTerminalProfiles(restaurantSlug: string): Promise<WaiterTerminalProfile[]> {
  const { data, error } = await waiterPublicSupabase.rpc("get_restaurant_terminal_staff", {
    target_restaurant_slug: restaurantSlug,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ staff_id: string; employee_id: string; display_name: string; staff_role: string; shift_label: string | null }>)
    .filter((row) => row.staff_role === "waiter")
    .map((row) => ({ staffId: row.staff_id, employeeId: row.employee_id, displayName: row.display_name, role: "Waiter", shift: row.shift_label }));
}

function parseWaiterSession(value: string | null): WaiterSession | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<WaiterSession>;
    if (
      typeof parsed.staffId === "string" &&
      typeof parsed.userId === "string" &&
      typeof parsed.displayName === "string" &&
      typeof parsed.signedInAt === "string" &&
      parsed.restaurant &&
      typeof parsed.restaurant.id === "string" &&
      typeof parsed.restaurant.slug === "string" &&
      typeof parsed.restaurant.name === "string"
    ) {
      return parsed as WaiterSession;
    }
  } catch {
    return null;
  }

  return null;
}

export function getStoredWaiterSession(restaurantSlug: string): WaiterSession | null {
  const session = parseWaiterSession(sessionStorage.getItem(WAITER_SESSION_KEY));
  if (!session || session.restaurant.slug !== restaurantSlug) {
    return null;
  }

  return session;
}

export function getActiveWaiterSession(): WaiterSession | null {
  return parseWaiterSession(sessionStorage.getItem(WAITER_SESSION_KEY));
}

export async function loadWaiterTerminalContext(restaurantSlug: string) {
  const { data, error } = await waiterPublicSupabase.rpc("get_waiter_terminal_context", {
    target_restaurant_slug: restaurantSlug,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? (data[0] as WaiterContextRow | undefined) : null;
  if (!row) {
    throw new Error("This waiter terminal link is not active for a restaurant.");
  }

  return normalizeRestaurant(row);
}

export async function signInWaiter(
  restaurantSlug: string,
  employeeIdentity: string,
  password: string
): Promise<WaiterSession> {
  const normalizedIdentity = employeeIdentity.trim();
  if (!normalizedIdentity || !password) {
    throw new Error("Select your employee profile and enter your PIN.");
  }

  const { data: identityData, error: identityError } = await waiterPublicSupabase.rpc(
    "resolve_restaurant_staff_identity",
    {
      target_restaurant_slug: restaurantSlug,
      target_employee_identity: normalizedIdentity,
      target_role: "waiter",
    }
  );

  if (identityError) {
    throw new Error(identityError.message);
  }

  const identity = Array.isArray(identityData)
    ? (identityData[0] as RestaurantStaffIdentityRow | undefined)
    : null;

  if (!identity?.auth_email) {
    throw new Error("Only active waiters for this restaurant can log in here.");
  }

  const { data: authData, error: authError } = await waiterSupabase.auth.signInWithPassword({
    email: identity.auth_email,
    password,
  });

  if (authError || !authData.user) {
    throw new Error("Username or PIN/password is incorrect.");
  }

  if (authData.user.id !== identity.user_id) {
    await waiterSupabase.auth.signOut({ scope: "local" });
    throw new Error("This account is not assigned to this waiter terminal.");
  }

  // Re-check membership with the authenticated JWT. Identity discovery alone
  // is never accepted as authorization for a restaurant waiter session.
  const { data: membership, error: membershipError } = await waiterSupabase
    .from("restaurant_staff")
    .select("id,restaurant_id,user_id,role,active")
    .eq("id", identity.staff_id)
    .eq("restaurant_id", identity.restaurant_id)
    .eq("user_id", authData.user.id)
    .eq("role", "waiter")
    .eq("active", true)
    .maybeSingle();
  if (membershipError || !membership) {
    await waiterSupabase.auth.signOut({ scope: "local" });
    throw new Error("This waiter is not active for this restaurant.");
  }

  const { error: loginRecordError } = await waiterSupabase.rpc("record_waiter_login", {
    target_restaurant_id: identity.restaurant_id,
  });

  if (loginRecordError) {
    await waiterSupabase.auth.signOut({ scope: "local" });
    throw new Error(loginRecordError.message);
  }

  const session: WaiterSession = {
    staffId: identity.staff_id,
    userId: identity.user_id,
    username: identity.employee_id,
    displayName: identity.display_name,
    restaurant: {
      id: identity.restaurant_id,
      slug: identity.restaurant_slug,
      name: identity.restaurant_name,
      logoUrl: identity.logo_url,
    },
    signedInAt: new Date().toISOString(),
  };

  storeWaiterSession(session);
  rememberWaiterProfile(identity.restaurant_slug, {
    staffId: identity.staff_id,
    employeeId: identity.employee_id,
    displayName: identity.display_name,
    role: "Waiter",
    shift: null,
  });
  return session;
}

type PinLoginResponse = {
  session?: { accessToken?: string; refreshToken?: string; expiresAt?: number | null };
  waiter?: { staffId?: string; userId?: string; displayName?: string; employeeId?: string | null };
  restaurant?: {
    id?: string;
    slug?: string;
    name?: string;
    logoUrl?: string | null;
    currencyCode?: string | null;
    currencySymbol?: string | null;
    locale?: string | null;
  };
  error?: string;
  code?: string;
  elapsedMs?: number;
  timings?: {
    restaurantMs?: number;
    verifierAndThrottleMs?: number;
    supabaseSignInMs?: number;
    loginRecordMs?: number;
    auditFinalizeMs?: number;
  };
};

export async function signInWaiterWithPin(
  restaurantSlug: string,
  pin: string,
): Promise<{ session: WaiterSession; serverElapsedMs: number | null }> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN not recognized. Try again.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/waiter-pin-login`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      restaurantSlug,
      pin,
      terminalId: getWaiterTerminalId(),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as PinLoginResponse;
  if (!response.ok) {
    if (payload.code === "throttled") throw new Error("Too many attempts. Try again shortly.");
    if (payload.code === "pin_conflict") throw new Error("PIN cannot be used. Ask a manager.");
    if (payload.code === "unavailable") throw new Error("Connection unavailable.");
    throw new Error("PIN not recognized. Try again.");
  }

  const accessToken = payload.session?.accessToken;
  const refreshToken = payload.session?.refreshToken;
  const waiter = payload.waiter;
  const restaurant = payload.restaurant;
  if (
    !accessToken ||
    !refreshToken ||
    !waiter?.staffId ||
    !waiter.userId ||
    !waiter.displayName ||
    !restaurant?.id ||
    !restaurant.slug ||
    !restaurant.name
  ) {
    throw new Error("Connection unavailable.");
  }

  const tablesRequest = fetch(`${supabaseUrl}/rest/v1/rpc/get_waiter_dashboard_tables`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target_restaurant_slug: restaurant.slug }),
  }).then(async (tablesResponse) => {
    if (!tablesResponse.ok) return null;
    const rows = await tablesResponse.json().catch(() => null);
    return Array.isArray(rows) ? rows : null;
  }).catch(() => null);
  const { data: authData, error: authError } = await waiterSupabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (authError || authData.user?.id !== waiter.userId) {
    void tablesRequest;
    await waiterSupabase.auth.signOut({ scope: "local" });
    throw new Error("PIN not recognized. Try again.");
  }

  const prefetchedRows = await tablesRequest;
  if (prefetchedRows) {
    prefetchedWaiterTables = { restaurantSlug: restaurant.slug, rows: prefetchedRows };
  }

  const waiterSession: WaiterSession = {
    staffId: waiter.staffId,
    userId: waiter.userId,
    username: waiter.employeeId ?? undefined,
    displayName: waiter.displayName,
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
      logoUrl: restaurant.logoUrl ?? null,
      currencyCode: restaurant.currencyCode ?? null,
      currencySymbol: restaurant.currencySymbol ?? null,
      locale: restaurant.locale ?? null,
    },
    signedInAt: new Date().toISOString(),
  };
  storeWaiterSession(waiterSession);
  return {
    session: waiterSession,
    serverElapsedMs:
      typeof payload.elapsedMs === "number" ? payload.elapsedMs : null,
  };
}

export function consumePrefetchedWaiterTables(restaurantSlug: string) {
  if (prefetchedWaiterTables?.restaurantSlug !== restaurantSlug) return null;
  const rows = prefetchedWaiterTables.rows;
  prefetchedWaiterTables = null;
  return rows;
}

export function clearWaiterSensitiveClientState(restaurantSlug?: string) {
  const session = parseWaiterSession(sessionStorage.getItem(WAITER_SESSION_KEY));
  const slug = (restaurantSlug ?? session?.restaurant.slug ?? "").trim().toLowerCase();
  sessionStorage.removeItem(WAITER_SESSION_KEY);
  sessionStorage.removeItem("serveflow.waiter.restaurant-slug");
  sessionStorage.removeItem(WAITER_AUTH_STORAGE_KEY);
  prefetchedWaiterTables = null;
  if (slug) {
    localStorage.removeItem(profileStorageKey(slug));
    localStorage.removeItem(`serveflow.waiter.order-queue.v2:${slug}`);
    localStorage.removeItem(`serveflow.waiter.favorites:${slug}`);
    localStorage.removeItem(`serveflow.waiter.recents:${slug}`);
  }
  return session;
}

export async function signOutWaiter() {
  const session = parseWaiterSession(sessionStorage.getItem(WAITER_SESSION_KEY));
  clearWaiterSensitiveClientState(session?.restaurant.slug);
  if (session) {
    try {
      await waiterSupabase.rpc("record_waiter_logout", {
        target_restaurant_id: session.restaurant.id,
      });
    } catch {
      // Local waiter state is already cleared. Logout must continue even when
      // the audit/update request is temporarily unavailable.
    }
  }

  const { error } = await waiterSupabase.auth.signOut({ scope: "local" });
  if (error && error.message !== "Auth session missing!") {
    throw new Error(error.message);
  }
}

export async function switchWaiter(restaurantSlug: string, username: string, pin: string) {
  const current = getStoredWaiterSession(restaurantSlug);
  if (current) {
    const { error } = await waiterSupabase.rpc("record_waiter_logout", { target_restaurant_id: current.restaurant.id });
    if (error) throw new Error(error.message);
  }
  return signInWaiter(restaurantSlug, username, pin);
}
