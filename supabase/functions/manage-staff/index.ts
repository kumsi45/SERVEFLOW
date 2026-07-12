import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type StaffRole = "cashier" | "kitchen" | "waiter";
type StaffAction =
  | "create-staff"
  | "update-staff"
  | "deactivate-staff"
  | "reactivate-staff"
  | "send-password-reset"
  | "generate-temporary-password"
  | "delete-staff";

type ManageStaffPayload = {
  action: StaffAction;
  restaurantId: string;
  staffId?: string;
  fullName?: string;
  email?: string;
  username?: string;
  pinPassword?: string;
  phoneNumber?: string;
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
  "delete-staff",
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
  if (role === "cashier" || role === "kitchen" || role === "waiter") {
    return role;
  }

  throw new Error("Role must be cashier, kitchen, or waiter.");
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

function normalizeUsername(username: unknown) {
  const normalized = requireString(username, "Username").toLowerCase();

  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) {
    throw new Error("Username must be 3-32 characters using letters, numbers, dots, underscores, or hyphens.");
  }

  return normalized;
}

function normalizeOptionalPhone(phone: unknown) {
  if (phone === undefined || phone === null || String(phone).trim() === "") {
    return null;
  }

  const normalized = String(phone).trim();
  if (normalized.length > 32 || !/^[0-9+().\-\s]+$/.test(normalized)) {
    throw new Error("Phone number is invalid.");
  }

  return normalized;
}

function normalizePinPassword(value: unknown) {
  const pin = requireString(value, "PIN / password");

  if (!/^\d{4,12}$/.test(pin)) {
    throw new Error("Waiter PIN must be 4-12 digits.");
  }

  return pin;
}

function waiterAuthEmail(restaurantId: string, username: string) {
  const restaurantPart = restaurantId.replace(/-/g, "");
  return `${username}.${restaurantPart}@waiter.serveflow.local`;
}

function generateWaiterPin() {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const value = ((bytes[0] << 8) + bytes[1]) % 10000;
  return String(value).padStart(4, "0");
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

function twoDigitSuffix() {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 100).padStart(2, "0");
}

function passwordNameBase(displayName: string) {
  const firstName = displayName.trim().split(/\s+/)[0] ?? "";
  const lettersAndNumbers = firstName.replace(/[^\p{L}\p{N}]/gu, "");
  const readableBase = lettersAndNumbers || "Staff";
  const normalizedBase = readableBase.charAt(0).toUpperCase() + readableBase.slice(1);

  return Array.from(normalizedBase).length >= 4
    ? normalizedBase
    : `${normalizedBase}User`.slice(0, 4);
}

function generateTemporaryPassword(displayName: string) {
  return `${passwordNameBase(displayName)}${twoDigitSuffix()}`;
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
        .select("id, restaurant_id, user_id, email, username, phone_number, display_name, role, active, assigned_kitchen_station_id, waiter_session_active")
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
      const role = normalizeRole(payload.role);
      const username = role === "waiter" ? normalizeUsername(payload.username) : null;
      const phoneNumber = role === "waiter" ? normalizeOptionalPhone(payload.phoneNumber) : null;
      const pinPassword = role === "waiter" ? normalizePinPassword(payload.pinPassword) : null;
      const email = role === "waiter" ? waiterAuthEmail(restaurantId, username) : normalizeEmail(payload.email);
      const assignedKitchenStationId = role === "kitchen"
        ? requireUuid(payload.assignedKitchenStationId, "Kitchen station")
        : null;
      const assignedStation = assignedKitchenStationId ? await requireActiveKitchenStation(assignedKitchenStationId) : null;

      const { data: existingEmailStaff, error: existingStaffError } = await serviceClient
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

      if (existingEmailStaff) {
        return jsonResponse(409, { error: "A staff account with this email already exists for this restaurant." });
      }

      if (username) {
        const { data: existingUsernameStaff, error: existingUsernameError } = await serviceClient
          .from("restaurant_staff")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .ilike("username", username)
          .limit(1)
          .maybeSingle();

        if (existingUsernameError) {
          logError(requestId, "existing waiter username lookup failed", { restaurantId, username, error: existingUsernameError.message });
          throw new Error(existingUsernameError.message);
        }

        if (existingUsernameStaff) {
          return jsonResponse(409, { error: "This waiter username is already used in this restaurant." });
        }
      }

      const temporaryPassword = role === "waiter" ? requireString(pinPassword, "PIN / password") : generateTemporaryPassword(fullName);
      const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, serveflow_role: role, username },
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
          username,
          phone_number: phoneNumber,
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

      await audit(role === "waiter" ? "waiter_created" : "staff_created", staffData.id, email, {
        role,
        username,
        phone_number: phoneNumber,
      });
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

      if (nextRole === "waiter" && typeof payload.username === "string") {
        const username = normalizeUsername(payload.username);
        const { data: existingUsernameStaff, error: existingUsernameError } = await serviceClient
          .from("restaurant_staff")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .ilike("username", username)
          .neq("id", staffId)
          .limit(1)
          .maybeSingle();

        if (existingUsernameError) throw new Error(existingUsernameError.message);
        if (existingUsernameStaff) {
          return jsonResponse(409, { error: "This waiter username is already used in this restaurant." });
        }

        updates.username = username;
        details.username = username;
      }

      if (nextRole === "waiter") {
        const phoneNumber = normalizeOptionalPhone(payload.phoneNumber);
        updates.phone_number = phoneNumber;
        details.phone_number = phoneNumber;
      } else {
        updates.username = null;
        updates.phone_number = null;
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
        await audit(nextRole === "waiter" ? "waiter_updated" : "role_changed", staffId, targetStaff.email, details);
      } else {
        await audit(targetStaff.role === "waiter" ? "waiter_updated" : "staff_updated", staffId, targetStaff.email, details);
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
      const { error } = await serviceClient
        .from("restaurant_staff")
        .update({ active, waiter_session_active: targetStaff.role === "waiter" && active ? targetStaff.waiter_session_active : false })
        .eq("id", staffId)
        .eq("restaurant_id", restaurantId);
      if (error) throw new Error(error.message);

      const auditAction = targetStaff.role === "waiter"
        ? active ? "waiter_activated" : "waiter_deactivated"
        : active ? "staff_reactivated" : "staff_deactivated";
      await audit(auditAction, staffId, targetStaff.email, { username: targetStaff.username ?? null });
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
      const temporaryPassword = targetStaff.role === "waiter" ? generateWaiterPin() : generateTemporaryPassword(targetStaff.display_name);
      const { error } = await serviceClient.auth.admin.updateUserById(targetStaff.user_id, {
        password: temporaryPassword,
      });

      if (error) throw new Error(error.message);

      await audit(targetStaff.role === "waiter" ? "waiter_pin_reset" : "temporary_password_generated", staffId, targetStaff.email, {
        username: targetStaff.username ?? null,
      });
      return jsonResponse(200, { temporaryPassword });
    }

    if (action === "delete-staff") {
      if (targetStaff.role !== "waiter") {
        return jsonResponse(400, { error: "Only waiter accounts can be safely deleted in this phase." });
      }

      if (targetStaff.waiter_session_active) {
        return jsonResponse(409, { error: "This waiter is currently logged in. Ask them to logout before deleting." });
      }

      const futureShiftExists = false;
      const futureAssignedTablesExist = false;

      if (futureShiftExists || futureAssignedTablesExist) {
        return jsonResponse(409, { error: "This waiter has future assignments and cannot be deleted." });
      }

      await audit("waiter_deleted", staffId, targetStaff.email, {
        deleted_staff_id: staffId,
        username: targetStaff.username ?? null,
        display_name: targetStaff.display_name,
        future_shift_check: futureShiftExists,
        future_assigned_tables_check: futureAssignedTablesExist,
      });

      const { error } = await serviceClient.auth.admin.deleteUser(targetStaff.user_id);
      if (error) throw new Error(error.message);

      return jsonResponse(200, { ok: true });
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
