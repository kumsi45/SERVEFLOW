import { supabase } from "../../../core/database";
import type { StaffDestination, StaffRestaurant, StaffRole, StaffSession } from "../types";

type StaffRoleRow = {
  role?: StaffRole | null;
  restaurant_id?: string | null;
  active?: boolean | null;
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

function getStaffRolePriority(role: StaffRole) {
  if (role === "owner") {
    return 0;
  }

  if (role === "cashier") {
    return 1;
  }

  return 2;
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

  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

async function getStaffSessionForUser(userId: string): Promise<StaffSession | null> {
  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("role,active,restaurant_id,restaurants(id,name)")
    .eq("user_id", userId)
    .eq("active", true)
    .in("role", ["owner", "cashier", "kitchen"]);

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
  await clearSupabaseAuthSession();
}

export function getStaffDestinations(staffSession: StaffSession): StaffDestination[] {
  const destinations: StaffDestination[] = [];

  for (const restaurant of staffSession.restaurants) {
    if (restaurant.role === "owner" || restaurant.role === "cashier") {
      destinations.push({
        dashboard: "cashier",
        restaurant,
      });
    }

    if (restaurant.role === "owner" || restaurant.role === "kitchen") {
      destinations.push({
        dashboard: "kitchen",
        restaurant,
      });
    }
  }

  return destinations;
}

export function getStaffDestinationPath(destination: StaffDestination) {
  return `/${destination.dashboard}/${encodeURIComponent(destination.restaurant.id)}`;
}

export function redirectToStaffDestination(destination: StaffDestination) {
  window.location.assign(getStaffDestinationPath(destination));
}
