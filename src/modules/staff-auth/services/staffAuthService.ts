import { supabase } from "../../../core/database";
import type { StaffDestination, StaffRestaurant, StaffRole, StaffSession } from "../types";

type StaffRoleRow = {
  role?: StaffRole | null;
  restaurant_id?: string | null;
  active?: boolean | null;
  restaurants?: { id?: string | null; name?: string | null; currency_code?: string | null; currency_symbol?: string | null; locale?: string | null } | { id?: string | null; name?: string | null; currency_code?: string | null; currency_symbol?: string | null; locale?: string | null }[] | null;
};

function isStaffRole(value: unknown): value is StaffRole {
  return value === "owner" || value === "manager" || value === "cashier" || value === "kitchen" || value === "inventory";
}

function getRestaurant(
  restaurant: StaffRoleRow["restaurants"]
): { id?: string | null; name?: string | null; currency_code?: string | null; currency_symbol?: string | null; locale?: string | null } | null {
  if (Array.isArray(restaurant)) {
    return restaurant[0] ?? null;
  }

  return restaurant ?? null;
}

function normalizeStaffRestaurant(row: StaffRoleRow): StaffRestaurant | null {
  const restaurant = getRestaurant(row.restaurants);

  if (!isStaffRole(row.role) || !row.restaurant_id || !restaurant?.name) {
    return null;
  }

  return {
    id: row.restaurant_id,
    name: restaurant.name,
    role: row.role,
    currencyCode: restaurant.currency_code ?? null,
    currencySymbol: restaurant.currency_symbol ?? null,
    locale: restaurant.locale ?? null,
  };
}

function getStaffRolePriority(role: StaffRole) {
  if (role === "owner") {
    return 0;
  }

  if (role === "manager") {
    return 1;
  }

  if (role === "cashier") {
    return 2;
  }

  return 3;
}

function sortStaffRestaurants(restaurants: StaffRestaurant[]) {
  return [...restaurants].sort((left, right) => {
    const roleDifference = getStaffRolePriority(left.role) - getStaffRolePriority(right.role);

    if (roleDifference !== 0) {
      return roleDifference;
    }

    const nameDifference = left.name.localeCompare(right.name);

    if (nameDifference !== 0) {
      return nameDifference;
    }

    return left.id.localeCompare(right.id);
  });
}

function isMissingAuthSessionError(error: { message?: string; name?: string }) {
  return error.name === "AuthSessionMissingError" || error.message === "Auth session missing!";
}

async function clearSupabaseAuthSession() {
  const { data, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (!data.session) {
    return;
  }

  // Only sign out if there is an active session. This clears any stale session
  // before a new sign-in so the new credentials take effect cleanly.
  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) {
    throw new Error(error.message);
  }
}

async function getStaffSessionForUser(userId: string): Promise<StaffSession | null> {
  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("role,active,restaurant_id,restaurants(id,name,currency_code,currency_symbol,locale)")
    .eq("user_id", userId)
    .eq("active", true)
    .in("role", ["owner", "manager", "cashier", "kitchen", "inventory"]);

  if (error) {
    throw new Error(error.message);
  }

  const restaurants = sortStaffRestaurants(
    ((data ?? []) as StaffRoleRow[])
      .map(normalizeStaffRestaurant)
      .filter((restaurant): restaurant is StaffRestaurant => restaurant !== null)
  );

  if (restaurants.length === 0) {
    return null;
  }

  const loginUpdates = await Promise.all(
    restaurants.map((restaurant) =>
      supabase.rpc("record_staff_login", { target_restaurant_id: restaurant.id })
    )
  );

  const loginUpdateError = loginUpdates.find((result) => result.error)?.error;
  if (loginUpdateError) {
    throw new Error(loginUpdateError.message);
  }

  return {
    userId,
    restaurants,
  };
}

export async function getCurrentStaffSession(): Promise<StaffSession | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    if (isMissingAuthSessionError(sessionError)) {
      return null;
    }
    throw new Error(sessionError.message);
  }

  if (!sessionData.session?.user) {
    return null;
  }

  return getStaffSessionForUser(sessionData.session.user.id);
}

export async function signInStaff(email: string, password: string): Promise<StaffSession> {
  // Do NOT sign out before signing in — calling signOut() fires SIGNED_OUT
  // to all onAuthStateChange listeners including active dashboard tabs,
  // causing them to log out. signInWithPassword replaces the session directly.
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.user) {
    throw new Error("Staff sign in did not return an authenticated user.");
  }

  const staffSession = await getStaffSessionForUser(data.user.id);

  if (!staffSession) {
    await signOutStaff();
    throw new Error("No active staff role was found for this account.");
  }

  return staffSession;
}

export async function signOutStaff() {
  const session = await getCurrentStaffSession().catch(() => null);
  if (session) {
    await Promise.all(session.restaurants.map((restaurant) => supabase.rpc("record_staff_logout", { target_restaurant_id: restaurant.id })));
  }
  // scope: "local" signs out only this tab — other open dashboards stay alive
  // until they naturally detect the session is gone via their own auth check.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    throw new Error(error.message);
  }
}

export function getStaffDestinations(staffSession: StaffSession): StaffDestination[] {
  const destinations: StaffDestination[] = [];

  for (const restaurant of staffSession.restaurants) {
    if (restaurant.role === "owner") {
      destinations.push({
        dashboard: "owner",
        restaurant,
      });
      continue;
    }

    if (restaurant.role === "manager") {
      destinations.push({
        dashboard: "manager",
        restaurant,
      });
      continue;
    }

    if (restaurant.role === "cashier") {
      destinations.push({
        dashboard: "cashier",
        restaurant,
      });
    }

    if (restaurant.role === "kitchen") {
      destinations.push({
        dashboard: "kitchen",
        restaurant,
      });
    }
    if (restaurant.role === "inventory") destinations.push({ dashboard: "inventory", restaurant });
  }

  return destinations;
}

export function getStaffDestinationPath(destination: StaffDestination) {
  return `/${destination.dashboard}/dashboard`;
}

export function redirectToStaffDestination(destination: StaffDestination) {
  window.sessionStorage.setItem(`serveflow.active-restaurant:${destination.dashboard}`, destination.restaurant.id);
  window.location.assign(getStaffDestinationPath(destination));
}
