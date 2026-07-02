import { supabase } from "../../../core/database";

export type ManagedStaffRole = "owner" | "cashier" | "kitchen";

export type ManagedStaffMember = {
  id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  role: ManagedStaffRole;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export type StaffActivityAction =
  | "staff_created"
  | "staff_deactivated"
  | "staff_reactivated"
  | "password_reset_sent"
  | "temporary_password_generated"
  | "role_changed"
  | "staff_updated"
  | "kitchen_station_created"
  | "kitchen_station_updated"
  | "kitchen_station_disabled"
  | "kitchen_station_enabled"
  | "kitchen_station_deleted"
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
  email: string;
  role: Exclude<ManagedStaffRole, "owner">;
};

export type UpdateStaffInput = {
  restaurantId: string;
  staffId: string;
  fullName?: string;
  role?: Exclude<ManagedStaffRole, "owner">;
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
  const { data, error } = await supabase.functions.invoke<StaffFunctionResponse>("manage-staff", {
    body: payload,
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
    .select("id,user_id,display_name,email,role,active,created_at,last_login_at")
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
    role: input.role,
  });
}

export async function updateStaff(input: UpdateStaffInput) {
  return invokeManageStaff({
    action: "update-staff",
    restaurantId: input.restaurantId,
    staffId: input.staffId,
    fullName: input.fullName,
    role: input.role,
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
