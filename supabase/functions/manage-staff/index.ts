import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type StaffRole = "cashier" | "kitchen";
type StaffAction =
  | "create-staff"
  | "update-staff"
  | "deactivate-staff"
  | "reactivate-staff"
  | "send-password-reset"
  | "generate-temporary-password";

type ManageStaffPayload = {
  action: StaffAction;
  restaurantId: string;
  staffId?: string;
  fullName?: string;
  email?: string;
  role?: StaffRole;
  assignedKitchenStationId?: string | null;
};

const STAFF_ACTIONS: StaffAction[] = [
  "create-staff",
  "update-staff",
  "deactivate-staff",
  "reactivate-staff",
  "send-password-reset",
  "generate-temporary-password",
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 80;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function requireUuid(value: unknown, label: string) {
  const id = requireString(value, label);

  if (!UUID_PATTERN.test(id)) {
    throw new Error(`${label} is invalid.`);
  }

  return id;
}

function normalizeAction(action: unknown): StaffAction {
  if (typeof action === "string" && STAFF_ACTIONS.includes(action as StaffAction)) {
    return action as StaffAction;
  }

  throw new Error("Unsupported staff action.");
}

function normalizeRole(role: unknown): StaffRole {
  if (role === "cashier" || role === "kitchen") {
    return role;
  }

  throw new Error("Role must be cashier or kitchen.");
}

function normalizeEmail(email: unknown) {
  const normalized = requireString(email, "Email").toLowerCase();

  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 254) {
    throw new Error("A valid email address is required.");
  }

  return normalized;
}

function normalizeDisplayName(name: unknown) {
  const normalized = requireString(name, "Full name");

  if (normalized.length < 2 || normalized.length > MAX_NAME_LENGTH) {
    throw new Error(`Full name must be between 2 and ${MAX_NAME_LENGTH} characters.`);
  }

  return normalized;
}

function normalizeResetBaseUrl(value: string | null) {
  const rawUrl = value?.trim();

  if (!rawUrl || rawUrl.toLowerCase() === "null") {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function getResetRedirectUrl(request: Request) {
  const origin = request.headers.get("Origin");
  const originUrl = normalizeResetBaseUrl(origin);
  const configuredUrl = normalizeResetBaseUrl(Deno.env.get("APP_URL"));
  const baseUrl = configuredUrl ?? originUrl;

  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}/reset-password`;
}

function generateTemporaryPassword() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 18);
  return `Sf-${token}9!`;
}

function logInfo(requestId: string, message: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ level: "info", requestId, message, ...details }));
}

function logError(requestId: string, message: string, details: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: "error", requestId, message, ...details }));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const requestId = crypto.randomUUID();

  try {
    const supabaseUrl = requireString(Deno.env.get("SUPABASE_URL"), "SUPABASE_URL");
    const anonKey = requireString(Deno.env.get("SUPABASE_ANON_KEY"), "SUPABASE_ANON_KEY");
    const serviceRoleKey = requireString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "SUPABASE_SERVICE_ROLE_KEY");
    const authorization = requireString(request.headers.get("Authorization"), "Authorization header");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      logInfo(requestId, "manage-staff rejected unauthenticated request", { reason: userError?.message ?? "missing user" });
      return jsonResponse(401, { error: "Authentication required." });
    }

    const payload = (await request.json()) as ManageStaffPayload;
    const action = normalizeAction(payload.action);
    const restaurantId = requireUuid(payload.restaurantId, "Restaurant ID");
    logInfo(requestId, "manage-staff request started", {
      action,
      restaurantId,
      userId: userData.user.id,
    });

    let { data: ownerStaff, error: ownerError } = await serviceClient
      .from("restaurant_staff")
      .select("id, restaurant_id, role, active")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userData.user.id)
      .eq("role", "owner")
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (ownerError) {
      logError(requestId, "owner membership lookup failed", { restaurantId, userId: userData.user.id, error: ownerError.message });
      throw new Error(ownerError.message);
    }

    if (!ownerStaff) {
      logInfo(requestId, "owner membership missing; checking legacy owner user row", { restaurantId, userId: userData.user.id });
      const { data: ownerUser, error: ownerUserError } = await serviceClient
        .from("users")
        .select("id, restaurant_id, role")
        .eq("id", userData.user.id)
        .eq("restaurant_id", restaurantId)
        .in("role", ["admin", "owner"])
        .limit(1)
        .maybeSingle();

      if (ownerUserError) {
        logError(requestId, "legacy owner user lookup failed", { restaurantId, userId: userData.user.id, error: ownerUserError.message });
        throw new Error(ownerUserError.message);
      }

      if (ownerUser) {
        const displayName =
          typeof userData.user.user_metadata?.display_name === "string" && userData.user.user_metadata.display_name.trim()
            ? userData.user.user_metadata.display_name.trim()
            : userData.user.email?.split("@")[0] || "Owner";

        const { data: repairedOwnerStaff, error: repairError } = await serviceClient
          .from("restaurant_staff")
          .upsert(
            {
              restaurant_id: restaurantId,
              user_id: userData.user.id,
              role: "owner",
              display_name: displayName,
              email: userData.user.email ? userData.user.email.toLowerCase() : null,
              active: true,
            },
            { onConflict: "restaurant_id,user_id" }
          )
          .select("id, restaurant_id, role, active")
          .single();

        if (repairError) {
          logError(requestId, "owner membership repair failed", { restaurantId, userId: userData.user.id, error: repairError.message });
          throw new Error(repairError.message);
        }

        logInfo(requestId, "owner membership repaired", { restaurantId, userId: userData.user.id, staffId: repairedOwnerStaff.id });
        ownerStaff = repairedOwnerStaff;
      }
    }

    if (!ownerStaff) {
      logInfo(requestId, "manage-staff forbidden: active owner membership not found", { restaurantId, userId: userData.user.id });
      return jsonResponse(403, { error: "Only active restaurant owners can manage staff." });
    }

    if (ownerStaff.restaurant_id !== restaurantId || ownerStaff.role !== "owner" || ownerStaff.active !== true) {
      logInfo(requestId, "manage-staff forbidden: owner membership mismatch", {
        restaurantId,
        userId: userData.user.id,
        ownerStaffId: ownerStaff.id,
        ownerStaffRestaurantId: ownerStaff.restaurant_id,
        ownerStaffRole: ownerStaff.role,
        ownerStaffActive: ownerStaff.active,
      });
      return jsonResponse(403, { error: "Owner membership does not match the requested restaurant." });
    }

    async function loadTargetStaff(staffId: string) {
      const { data, error } = await serviceClient
        .from("restaurant_staff")
        .select("id, restaurant_id, user_id, email, display_name, role, active, assigned_kitchen_station_id")
        .eq("restaurant_id", restaurantId)
        .eq("id", staffId)
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("Staff member was not found for this restaurant.");
      if (data.restaurant_id !== restaurantId) {
        throw new Error("Staff member does not belong to this restaurant.");
      }
      return data;
    }

    async function requireActiveKitchenStation(stationId: string) {
      const { data, error } = await serviceClient
        .from("kitchen_stations")
        .select("id, name, restaurant_id, active, archived_at")
        .eq("restaurant_id", restaurantId)
        .eq("id", stationId)
        .eq("active", true)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("Choose an active kitchen station for kitchen staff.");
      return data;
    }

    async function stationName(stationId: string | null | undefined) {
      if (!stationId) return null;
      const { data, error } = await serviceClient
        .from("kitchen_stations")
        .select("name")
        .eq("restaurant_id", restaurantId)
        .eq("id", stationId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return typeof data?.name === "string" ? data.name : null;
    }

    async function audit(
      action: string,
      targetStaffId: string | null,
      targetStaffEmail: string | null,
      details: Record<string, unknown> = {}
    ) {
      const { error } = await serviceClient.from("staff_activity_log").insert({
        restaurant_id: restaurantId,
        action,
        performed_by_staff_id: ownerStaff.id,
        target_staff_id: targetStaffId,
        target_staff_email: targetStaffEmail,
        details,
      });

      if (error) throw new Error(error.message);
    }

    if (action === "create-staff") {
      const fullName = normalizeDisplayName(payload.fullName);
      const email = normalizeEmail(payload.email);
      const role = normalizeRole(payload.role);
      const assignedKitchenStationId = role === "kitchen"
        ? requireUuid(payload.assignedKitchenStationId, "Kitchen station")
        : null;
      const assignedStation = assignedKitchenStationId ? await requireActiveKitchenStation(assignedKitchenStationId) : null;

      const { data: existingStaff, error: existingStaffError } = await serviceClient
        .from("restaurant_staff")
        .select("id, active")
        .eq("restaurant_id", restaurantId)
        .eq("email", email)
        .limit(1)
        .maybeSingle();

      if (existingStaffError) {
        logError(requestId, "existing staff email lookup failed", { restaurantId, error: existingStaffError.message });
        throw new Error(existingStaffError.message);
      }

      if (existingStaff) {
        return jsonResponse(409, { error: "A staff account with this email already exists for this restaurant." });
      }

      const temporaryPassword = generateTemporaryPassword();
      const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, serveflow_role: role },
      });

      if (authError || !authData.user) {
        logError(requestId, "auth staff user creation failed", {
          restaurantId,
          role,
          error: authError?.message || "missing auth user",
        });
        if (authError?.message && /already|registered|exists/i.test(authError.message)) {
          return jsonResponse(409, { error: "This email is already registered. Use a different staff email address." });
        }
        throw new Error(authError?.message || "Could not create auth user.");
      }

      const { error: userInsertError } = await serviceClient.from("users").upsert({
        id: authData.user.id,
        restaurant_id: restaurantId,
        role,
      });

      if (userInsertError) {
        logError(requestId, "public user row upsert failed; rolling back auth user", {
          restaurantId,
          staffUserId: authData.user.id,
          error: userInsertError.message,
        });
        await serviceClient.auth.admin.deleteUser(authData.user.id);
        throw new Error(userInsertError.message);
      }

      const { data: staffData, error: staffInsertError } = await serviceClient
        .from("restaurant_staff")
        .insert({
          restaurant_id: restaurantId,
          user_id: authData.user.id,
          role,
          display_name: fullName,
          email,
          assigned_kitchen_station_id: assignedKitchenStationId,
          active: true,
        })
        .select("id")
        .single();

      if (staffInsertError || !staffData) {
        logError(requestId, "restaurant staff row insert failed; rolling back auth user", {
          restaurantId,
          staffUserId: authData.user.id,
          role,
          error: staffInsertError?.message || "missing staff data",
        });
        await serviceClient.auth.admin.deleteUser(authData.user.id);
        throw new Error(staffInsertError?.message || "Could not create staff record.");
      }

      await audit("staff_created", staffData.id, email, { role });
      if (role === "kitchen" && assignedStation) {
        await audit("kitchen_staff_station_assigned", staffData.id, email, {
          staff_name: fullName,
          old_station: null,
          old_station_id: null,
          new_station: assignedStation.name,
          new_station_id: assignedStation.id,
        });
      }
      logInfo(requestId, "staff account created", {
        restaurantId,
        staffId: staffData.id,
        staffUserId: authData.user.id,
        role,
      });

      return jsonResponse(200, {
        staffId: staffData.id,
        temporaryPassword,
      });
    }

    const staffId = requireUuid(payload.staffId, "Staff ID");
    const targetStaff = await loadTargetStaff(staffId);

    if (targetStaff.id === ownerStaff.id) {
      return jsonResponse(400, { error: "Owners cannot manage their own staff record from this endpoint." });
    }

    if (targetStaff.role === "owner") {
      return jsonResponse(400, { error: "Owner staff records cannot be modified from this action." });
    }

    if (action === "update-staff") {
      const updates: Record<string, unknown> = {};
      const details: Record<string, unknown> = {};
      const previousRole = targetStaff.role as StaffRole;
      const nextRole = payload.role ? normalizeRole(payload.role) : previousRole;
      const previousStationId = typeof targetStaff.assigned_kitchen_station_id === "string" ? targetStaff.assigned_kitchen_station_id : null;
      let nextStationId: string | null = previousStationId;
      let nextStation: { id: string; name: string } | null = null;

      if (typeof payload.fullName === "string" && payload.fullName.trim()) {
        const displayName = normalizeDisplayName(payload.fullName);
        updates.display_name = displayName;
        details.display_name = displayName;
      }

      if (payload.role) {
        updates.role = nextRole;
        details.previous_role = targetStaff.role;
        details.next_role = nextRole;
      }

      if (nextRole === "kitchen") {
        nextStationId = requireUuid(payload.assignedKitchenStationId, "Kitchen station");
        nextStation = await requireActiveKitchenStation(nextStationId);
        updates.assigned_kitchen_station_id = nextStationId;
      } else {
        nextStationId = null;
        updates.assigned_kitchen_station_id = null;
      }

      if (previousStationId !== nextStationId) {
        const previousStationName = await stationName(previousStationId);
        details.previous_station = previousStationName;
        details.previous_station_id = previousStationId;
        details.next_station = nextStation?.name ?? null;
        details.next_station_id = nextStationId;
      }

      if (Object.keys(updates).length === 0) {
        throw new Error("No staff updates were provided.");
      }

      const { error } = await serviceClient.from("restaurant_staff").update(updates).eq("id", staffId).eq("restaurant_id", restaurantId);
      if (error) throw new Error(error.message);

      if (updates.role && targetStaff.user_id) {
        const { error: userRoleError } = await serviceClient
          .from("users")
          .update({ role: updates.role })
          .eq("id", targetStaff.user_id)
          .eq("restaurant_id", restaurantId);
        if (userRoleError) throw new Error(userRoleError.message);
        await audit("role_changed", staffId, targetStaff.email, details);
      } else {
        await audit("staff_updated", staffId, targetStaff.email, details);
      }

      if (previousStationId !== nextStationId) {
        const previousStationName = typeof details.previous_station === "string" ? details.previous_station : null;
        await audit(previousStationId ? "kitchen_staff_station_changed" : "kitchen_staff_station_assigned", staffId, targetStaff.email, {
          staff_name: typeof updates.display_name === "string" ? updates.display_name : targetStaff.display_name,
          old_station: previousStationName,
          old_station_id: previousStationId,
          new_station: nextStation?.name ?? null,
          new_station_id: nextStationId,
        });
      }

      return jsonResponse(200, { ok: true });
    }

    if (action === "deactivate-staff" || action === "reactivate-staff") {
      const active = action === "reactivate-staff";
      const { error } = await serviceClient.from("restaurant_staff").update({ active }).eq("id", staffId).eq("restaurant_id", restaurantId);
      if (error) throw new Error(error.message);

      await audit(active ? "staff_reactivated" : "staff_deactivated", staffId, targetStaff.email, {});
      return jsonResponse(200, { ok: true });
    }

    if (action === "send-password-reset") {
      const email = requireString(targetStaff.email, "Target staff email");
      const redirectTo = getResetRedirectUrl(request);

      if (!redirectTo) {
        logError(requestId, "password reset redirect unavailable", {
          origin: request.headers.get("Origin"),
          hasConfiguredAppUrl: Boolean(Deno.env.get("APP_URL")?.trim()),
        });
        return jsonResponse(400, { error: "Password reset redirect URL is not configured for this request." });
      }

      const { error } = await userClient.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) throw new Error(error.message);

      await audit("password_reset_sent", staffId, email, { redirect_to_origin: new URL(redirectTo).origin });
      return jsonResponse(200, { ok: true });
    }

    if (action === "generate-temporary-password") {
      const temporaryPassword = generateTemporaryPassword();
      const { error } = await serviceClient.auth.admin.updateUserById(targetStaff.user_id, {
        password: temporaryPassword,
      });

      if (error) throw new Error(error.message);

      await audit("temporary_password_generated", staffId, targetStaff.email, {});
      return jsonResponse(200, { temporaryPassword });
    }

    return jsonResponse(400, { error: "Unsupported staff action." });
  } catch (error) {
    logError(requestId, "manage-staff request failed", {
      error: error instanceof Error ? error.message : "Staff management request failed.",
    });
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : "Staff management request failed.",
      requestId,
    });
  }
});
