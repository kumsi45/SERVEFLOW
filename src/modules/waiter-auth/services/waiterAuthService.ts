import { createClient } from "@supabase/supabase-js";
import type { WaiterSession, WaiterTerminalContext } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const WAITER_SESSION_KEY = "serveflow.waiter.session.v1";
const WAITER_AUTH_STORAGE_KEY = "serveflow-waiter-auth";

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

// Public waiter discovery must never inherit an owner/cashier session from the
// shared application client. Authentication happens only after identity lookup.
const waiterPublicSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
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
  username: string,
  password: string
): Promise<WaiterSession> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername || !password) {
    throw new Error("Enter your username and PIN or password.");
  }

  const { data: identityData, error: identityError } = await waiterPublicSupabase.rpc(
    "resolve_waiter_login_identity",
    {
      target_restaurant_slug: restaurantSlug,
      waiter_username: normalizedUsername,
    }
  );

  if (identityError) {
    throw new Error(identityError.message);
  }

  const identity = Array.isArray(identityData)
    ? (identityData[0] as WaiterIdentityRow | undefined)
    : null;

  if (!identity?.email) {
    throw new Error("Only active waiters for this restaurant can log in here.");
  }

  const { data: authData, error: authError } = await waiterSupabase.auth.signInWithPassword({
    email: identity.email,
    password,
  });

  if (authError || !authData.user) {
    throw new Error("Username or PIN/password is incorrect.");
  }

  if (authData.user.id !== identity.user_id) {
    await waiterSupabase.auth.signOut({ scope: "local" });
    throw new Error("This account is not assigned to this waiter terminal.");
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
    username: normalizedUsername,
    displayName: identity.display_name,
    restaurant: normalizeRestaurant(identity),
    signedInAt: new Date().toISOString(),
  };

  storeWaiterSession(session);
  return session;
}

export async function signOutWaiter() {
  const session = parseWaiterSession(sessionStorage.getItem(WAITER_SESSION_KEY));
  if (session) {
    await waiterSupabase.rpc("record_waiter_logout", {
      target_restaurant_id: session.restaurant.id,
    });
  }

  sessionStorage.removeItem(WAITER_SESSION_KEY);
  Object.keys(sessionStorage)
    .filter((key) => key.includes(WAITER_AUTH_STORAGE_KEY) || key.startsWith("sb-"))
    .forEach((key) => {
      if (key.includes(WAITER_AUTH_STORAGE_KEY)) {
        sessionStorage.removeItem(key);
      }
    });

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
