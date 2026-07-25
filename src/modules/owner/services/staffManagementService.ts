import { supabase } from "../../../core/database";

export type ManagedStaffRole = "owner" | "manager" | "cashier" | "kitchen" | "waiter" | "inventory" | "inventory_officer";

export type ManagedStaffMember = {
  id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  username: string | null;
  employee_id: string;
  phone_number: string | null;
  role: ManagedStaffRole;
  assigned_kitchen_station_id: string | null;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
  staff_session_active: boolean | null;
  waiter_session_active: boolean | null;
};

export type StaffActivityAction =
  | "staff_created"
  | "staff_deactivated"
  | "staff_reactivated"
  | "password_reset_sent"
  | "temporary_password_generated"
  | "waiter_created"
  | "waiter_updated"
  | "waiter_activated"
  | "waiter_deactivated"
  | "waiter_pin_reset"
  | "waiter_deleted"
  | "role_changed"
  | "staff_updated"
  | "kitchen_station_created"
  | "kitchen_station_updated"
  | "kitchen_station_disabled"
  | "kitchen_station_enabled"
  | "kitchen_station_deleted"
  | "kitchen_staff_station_assigned"
  | "kitchen_staff_station_changed"
  | "menu_station_assigned"
  | "menu_station_changed";

export type StaffActivityLog = {
  id: string;
  action: StaffActivityAction;
  performed_by_staff_id: string | null;
  target_staff_id: string | null;
  target_staff_email: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type CreateStaffInput = {
  restaurantId: string;
  fullName: string;
  email?: string;
  pinPassword?: string;
  phoneNumber?: string;
  role: Exclude<ManagedStaffRole, "owner">;
  assignedKitchenStationId?: string | null;
};

export type UpdateStaffInput = {
  restaurantId: string;
  staffId: string;
  fullName?: string;
  phoneNumber?: string;
  role?: Exclude<ManagedStaffRole, "owner">;
  assignedKitchenStationId?: string | null;
};

type StaffFunctionResponse = {
  ok?: boolean;
  staffId?: string;
  temporaryPassword?: string;
  error?: string;
};

async function getFunctionErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        return body.error;
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function invokeManageStaff(payload: Record<string, unknown>) {
  // Staff creation is a privileged Owner action. Refresh first so a browser tab
  // opened before a Supabase JWT signing-key rotation never sends a stale token
  // to the Edge Function gateway.
  const { data: refreshedSession, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    throw new Error(`Your Owner session could not be refreshed. Please sign in again. ${refreshError.message}`);
  }

  const accessToken = refreshedSession.session?.access_token;
  if (!accessToken) {
    throw new Error("Your Owner session has expired. Please sign in again.");
  }

  const { data, error } = await supabase.functions.invoke<StaffFunctionResponse>("manage-staff", {
    body: payload,
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (error) {
    throw new Error((await getFunctionErrorMessage(error)) || error.message);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data ?? {};
}

export async function loadManagedStaff(restaurantId: string) {
  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("id,user_id,display_name,email,username,employee_id,phone_number,role,assigned_kitchen_station_id,active,created_at,last_login_at,staff_session_active,waiter_session_active")
    .eq("restaurant_id", restaurantId)
    .neq("role", "owner")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ManagedStaffMember[];
}

export async function loadStaffActivityLog(restaurantId: string) {
  const { data, error } = await supabase
    .from("staff_activity_log")
    .select("id,action,performed_by_staff_id,target_staff_id,target_staff_email,details,created_at")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as StaffActivityLog[];
}

export async function createStaff(input: CreateStaffInput) {
  return invokeManageStaff({
    action: "create-staff",
    restaurantId: input.restaurantId,
    fullName: input.fullName,
    email: input.email,
    pinPassword: input.pinPassword,
    phoneNumber: input.phoneNumber,
    role: input.role,
    assignedKitchenStationId: input.assignedKitchenStationId ?? null,
  });
}

export async function updateStaff(input: UpdateStaffInput) {
  return invokeManageStaff({
    action: "update-staff",
    restaurantId: input.restaurantId,
    staffId: input.staffId,
    fullName: input.fullName,
    phoneNumber: input.phoneNumber,
    role: input.role,
    assignedKitchenStationId: input.assignedKitchenStationId ?? null,
  });
}

export async function deactivateStaff(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "deactivate-staff", restaurantId, staffId });
}

export async function reactivateStaff(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "reactivate-staff", restaurantId, staffId });
}

export async function sendStaffPasswordReset(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "send-password-reset", restaurantId, staffId });
}

export async function generateStaffTemporaryPassword(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "generate-temporary-password", restaurantId, staffId });
}

export async function deleteStaff(restaurantId: string, staffId: string) {
  return invokeManageStaff({ action: "delete-staff", restaurantId, staffId });
}
