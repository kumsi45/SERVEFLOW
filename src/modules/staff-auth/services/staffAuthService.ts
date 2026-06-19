import { supabase } from "../../../core/database";
import type { StaffRestaurant, StaffRole, StaffSession } from "../types";

type StaffRoleRow = {
  role?: StaffRole | null;
  restaurant_id?: string | null;
  restaurants?: { id?: string | null; name?: string | null } | { id?: string | null; name?: string | null }[] | null;
};

function isStaffRole(value: unknown): value is StaffRole {
  return value === "owner" || value === "cashier" || value === "kitchen";
}

function getRestaurant(
  restaurant: StaffRoleRow["restaurants"]
): { id?: string | null; name?: string | null } | null {
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
  };
}

function getSelectedRestaurantStorageKey(userId: string) {
  return `serveflow:cashier:selectedRestaurantId:${userId}`;
}

function getPrimaryStaffRole(restaurants: StaffRestaurant[]): StaffRole | null {
  return (
    restaurants.find((restaurant) => restaurant.role === "owner" || restaurant.role === "cashier")?.role ??
    restaurants[0]?.role ??
    null
  );
}

function isMissingAuthSessionError(error: { message?: string; name?: string }) {
  return error.name === "AuthSessionMissingError" || error.message === "Auth session missing!";
}

function clearStoredCashierRestaurantIds() {
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);

      if (key?.startsWith("serveflow:cashier:selectedRestaurantId:")) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Session storage may be unavailable in private browsing or embedded webviews.
  }
}

export function getStoredCashierRestaurantId(userId: string): string | null {
  try {
    return window.sessionStorage.getItem(getSelectedRestaurantStorageKey(userId));
  } catch {
    return null;
  }
}

export function storeCashierRestaurantId(userId: string, restaurantId: string) {
  try {
    window.sessionStorage.setItem(getSelectedRestaurantStorageKey(userId), restaurantId);
  } catch {
    // Session storage may be unavailable in private browsing or embedded webviews.
  }
}

export function clearStoredCashierRestaurantId(userId: string) {
  try {
    window.sessionStorage.removeItem(getSelectedRestaurantStorageKey(userId));
  } catch {
    // Session storage may be unavailable in private browsing or embedded webviews.
  }
}

async function clearSupabaseAuthSession() {
  const { data, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (!data.session) {
    return;
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

function redirectForStaffSession(staffSession: StaffSession) {
  const hasCashierAccess = staffSession.restaurants.some(
    (restaurant) => restaurant.role === "owner" || restaurant.role === "cashier"
  );

  return hasCashierAccess ? "/cashier" : "/kitchen";
}

async function getStaffSessionForUser(userId: string): Promise<StaffSession | null> {
  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("role,restaurant_id,restaurants(id,name)")
    .eq("user_id", userId)
    .eq("active", true)
    .in("role", ["owner", "cashier", "kitchen"]);

  if (error) {
    throw new Error(error.message);
  }

  const restaurants = ((data ?? []) as StaffRoleRow[])
    .map(normalizeStaffRestaurant)
    .filter((restaurant): restaurant is StaffRestaurant => restaurant !== null);
  const role = getPrimaryStaffRole(restaurants);

  if (!role) {
    return null;
  }

  return {
    userId,
    role,
    restaurants,
  };
}

export async function getCurrentStaffSession(): Promise<StaffSession | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    if (isMissingAuthSessionError(userError)) {
      return null;
    }

    throw new Error(userError.message);
  }

  if (!userData.user) {
    return null;
  }

  return getStaffSessionForUser(userData.user.id);
}

export async function signInStaff(email: string, password: string): Promise<StaffSession> {
  clearStoredCashierRestaurantIds();
  await clearSupabaseAuthSession();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.user) {
    await signOutStaff();
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
  clearStoredCashierRestaurantIds();
  await clearSupabaseAuthSession();
}

export function redirectToStaffDestination(staffSession: StaffSession) {
  window.location.assign(redirectForStaffSession(staffSession));
}
