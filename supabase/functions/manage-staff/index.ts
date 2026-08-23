import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canCreateStaffRole } from "./authorization.ts";
import { initialKitchenStationId, staffCreationEmailRequired } from "./creationPolicy.ts";
import {
  requireWaiterPinPepper,
  waiterPinFingerprint,
  waiterSupabasePassword,
} from "../_shared/waiterPin.ts";
import { validateStaffPassword } from "../_shared/staffAuthPolicy.ts";

type StaffRole = "manager" | "cashier" | "kitchen" | "waiter" | "reception" | "inventory" | "inventory_officer";
type StaffAction =
  | "create-staff"
  | "update-staff"
  | "deactivate-staff"
  | "reactivate-staff"
  | "suspend-staff"
  | "mark-break"
  | "end-break"
  | "assign-waiter-tables"
  | "send-announcement"
  | "send-notification"
  | "send-password-reset"
  | "set-waiter-pin"
  | "generate-temporary-password"
  | "delete-staff";

type ManageStaffPayload = {
  action: StaffAction;
  restaurantId: string;
  staffId?: string;
  fullName?: string;
  email?: string;
  username?: string;
  password?: string;
  pin?: string;
  phoneNumber?: string;
  shift?: string;
  role?: StaffRole;
  assignedKitchenStationId?: string | null;
  tableIds?: string[];
  message?: string;
};

const STAFF_ACTIONS: StaffAction[] = [
  "create-staff",
  "update-staff",
  "deactivate-staff",
  "reactivate-staff",
  "suspend-staff",
  "mark-break",
  "end-break",
  "assign-waiter-tables",
  "send-announcement",
  "send-notification",
  "send-password-reset",
  "set-waiter-pin",
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
  if (role === "manager" || role === "cashier" || role === "kitchen" || role === "waiter" || role === "reception" || role === "inventory" || role === "inventory_officer") {
    return role;
  }

  if (role === "owner" || role === "super_admin") {
    throw new Error("Managers cannot create owner or super admin accounts.");
  }

  throw new Error("Role must be manager, cashier, waiter, kitchen, reception, inventory, or inventory officer.");
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
  const pin = requireString(value, "PIN");

  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits.");
  }

  return pin;
}

function normalizeStaffPassword(value: unknown) {
  const password = requireString(value, "Password");
  const error = validateStaffPassword(password);
  if (error) throw new Error(error);
  return password;
}

async function prepareWaiterPinFingerprint(
  serviceClient: SupabaseClient,
  restaurantId: string,
  pin: string,
  excludedStaffId?: string,
) {
  const fingerprint = await waiterPinFingerprint(
    requireWaiterPinPepper(),
    restaurantId,
    pin,
  );
  let query = serviceClient
    .from("waiter_pin_credentials")
    .select("staff_id")
    .eq("restaurant_id", restaurantId)
    .eq("pin_fingerprint", fingerprint)
    .eq("active", true)
    .limit(1);
  if (excludedStaffId) query = query.neq("staff_id", excludedStaffId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if ((data ?? []).length > 0) {
    throw new Error("This PIN is already used by another active waiter in this restaurant.");
  }
  return fingerprint;
}

async function saveWaiterPinCredential(
  serviceClient: SupabaseClient,
  restaurantId: string,
  staffId: string,
  pinFingerprint: string,
) {
  const { error } = await serviceClient.from("waiter_pin_credentials").upsert({
    restaurant_id: restaurantId,
    staff_id: staffId,
    pin_fingerprint: pinFingerprint,
    active: true,
    failed_attempt_count: 0,
    locked_until: null,
    last_failed_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "restaurant_id,staff_id" });
  if (error) {
    if (error.code === "23505") {
      throw new Error("This PIN is already used by another active waiter in this restaurant.");
    }
    throw new Error(error.message);
  }
}

async function setCredentialReadiness(
  serviceClient: SupabaseClient,
  restaurantId: string,
  staffId: string,
  readiness: "legacy_credential" | "reset_required" | "password_ready" | "waiter_pin_ready",
  updatedByStaffId: string | null,
) {
  const now = new Date().toISOString();
  const { error } = await serviceClient.from("staff_credential_readiness").upsert({
    restaurant_id: restaurantId,
    staff_id: staffId,
    readiness,
    setup_requested_at: readiness === "reset_required" ? now : null,
    ready_at: readiness === "password_ready" || readiness === "waiter_pin_ready" ? now : null,
    updated_by_staff_id: updatedByStaffId,
    updated_at: now,
  }, { onConflict: "restaurant_id,staff_id" });
  if (error) throw new Error(error.message);
}

function normalizeOptionalEmail(email: unknown) {
  if (email === undefined || email === null || String(email).trim() === "") return null;
  return normalizeEmail(email);
}

function normalizeOptionalShift(shift: unknown) {
  if (shift === undefined || shift === null || String(shift).trim() === "") return null;
  const value = String(shift).trim();
  if (value.length > 40) throw new Error("Shift must be 40 characters or fewer.");
  return value;
}

function waiterAuthEmail(restaurantId: string, username: string) {
  const restaurantPart = restaurantId.replace(/-/g, "");
  return `${username}.${restaurantPart}@waiter.serveflow.local`;
}

function staffAuthEmail(restaurantId: string, username: string, role: StaffRole) {
  const restaurantPart = restaurantId.replace(/-/g, "");
  return `${username}.${restaurantPart}@${role}.serveflow.local`;
}

function employeeAuthEmail(restaurantId: string, employeeId: string, role: StaffRole) {
  const restaurantPart = restaurantId.replace(/-/g, "");
  return `${employeeId.toLowerCase()}.${restaurantPart}@${role}.serveflow.local`;
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
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || hostname.startsWith("127.")) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function getResetRedirectUrl() {
  const configuredUrl = normalizeResetBaseUrl(Deno.env.get("APP_URL"));
  return configuredUrl ? `${configuredUrl}/reset-password` : null;
}

function logInfo(requestId: string, message: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ level: "info", requestId, message, ...details }));
}

function logError(requestId: string, message: string, details: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: "error", requestId, message, ...details }));
}

class PermissionDeniedError extends Error {
  constructor() {
    super("Permission denied.");
  }
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

    // Passwords and credential material are never logged, returned, or written to staff/audit rows.
    const payload = (await request.json()) as ManageStaffPayload;
    const action = normalizeAction(payload.action);
    const restaurantId = requireUuid(payload.restaurantId, "Restaurant ID");
    logInfo(requestId, "manage-staff request started", {
      action,
      restaurantId,
      userId: userData.user.id,
    });

    let { data: actingStaff, error: ownerError } = await serviceClient
      .from("restaurant_staff")
      .select("id, restaurant_id, role, active, display_name")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "manager"])
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (ownerError) {
      logError(requestId, "owner membership lookup failed", { restaurantId, userId: userData.user.id, error: ownerError.message });
      throw new Error(ownerError.message);
    }

    if (!actingStaff) {
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
          .select("id, restaurant_id, role, active, display_name")
          .single();

        if (repairError) {
          logError(requestId, "owner membership repair failed", { restaurantId, userId: userData.user.id, error: repairError.message });
          throw new Error(repairError.message);
        }

        logInfo(requestId, "owner membership repaired", { restaurantId, userId: userData.user.id, staffId: repairedOwnerStaff.id });
        actingStaff = repairedOwnerStaff;
      }
    }

    if (!actingStaff) {
      logInfo(requestId, "manage-staff forbidden: active owner/manager membership not found", { restaurantId, userId: userData.user.id });
      return jsonResponse(403, { error: "Permission denied." });
    }

    if (actingStaff.restaurant_id !== restaurantId || !["owner", "manager"].includes(actingStaff.role) || actingStaff.active !== true) {
      logInfo(requestId, "manage-staff forbidden: membership mismatch", {
        restaurantId,
        userId: userData.user.id,
        actingStaffId: actingStaff.id,
        actingStaffRestaurantId: actingStaff.restaurant_id,
        actingStaffRole: actingStaff.role,
        actingStaffActive: actingStaff.active,
      });
      return jsonResponse(403, { error: "Permission denied." });
    }

    async function loadTargetStaff(staffId: string) {
      const { data, error } = await serviceClient
        .from("restaurant_staff")
        .select("id, restaurant_id, user_id, email, employee_id, contact_email, username, phone_number, shift_label, display_name, role, active, assigned_kitchen_station_id, staff_session_active, waiter_session_active")
        .eq("id", staffId)
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("Staff member was not found for this restaurant.");
      if (data.restaurant_id !== restaurantId || data.restaurant_id !== actingStaff.restaurant_id) {
        logInfo(requestId, "manage-staff denied: target staff restaurant mismatch", {
          requestedRestaurantId: restaurantId,
          actingStaffId: actingStaff.id,
          actingStaffRestaurantId: actingStaff.restaurant_id,
          targetStaffId: staffId,
          targetStaffRestaurantId: data.restaurant_id,
        });
        throw new PermissionDeniedError();
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
      const auditTimestamp = new Date().toISOString();
      const normalizedDetails = {
        ...details,
        manager_id: actingStaff.id,
        manager_name: typeof actingStaff.display_name === "string" ? actingStaff.display_name : null,
        target_staff_id: targetStaffId,
        target_staff_name: typeof details.target_staff_name === "string" ? details.target_staff_name : null,
        action,
        previous_values: Object.prototype.hasOwnProperty.call(details, "previous_values") ? details.previous_values : null,
        new_values: Object.prototype.hasOwnProperty.call(details, "new_values") ? details.new_values : null,
        timestamp: auditTimestamp,
      };

      const { error } = await serviceClient.from("staff_activity_log").insert({
        restaurant_id: restaurantId,
        action,
        performed_by_staff_id: actingStaff.id,
        target_staff_id: targetStaffId,
        target_staff_email: targetStaffEmail,
        details: normalizedDetails,
      });

      if (error) throw new Error(error.message);
    }

    if (action === "create-staff") {
      const fullName = normalizeDisplayName(payload.fullName);
      const role = normalizeRole(payload.role);
      if (!canCreateStaffRole(actingStaff.role as "owner" | "manager", role)) {
        return jsonResponse(403, { error: "Permission denied." });
      }
      const phoneNumber = normalizeOptionalPhone(payload.phoneNumber);
      const contactEmail = staffCreationEmailRequired(role) ? normalizeEmail(payload.email) : normalizeOptionalEmail(payload.email);
      const shift = normalizeOptionalShift(payload.shift);
      const creationCredential = role === "waiter"
        ? normalizePinPassword(payload.pin)
        : normalizeStaffPassword(payload.password);
      const waiterPinFingerprintValue = role === "waiter"
        ? await prepareWaiterPinFingerprint(serviceClient, restaurantId, creationCredential)
        : null;
      const { data: employeeId, error: employeeIdError } = await serviceClient.rpc(
        "next_restaurant_employee_id",
        { target_restaurant_id: restaurantId, target_role: role },
      );
      if (employeeIdError || typeof employeeId !== "string") {
        throw new Error(employeeIdError?.message || "Could not generate an employee ID.");
      }
      const username = employeeId.toLowerCase();
      const email = role === "waiter"
        ? employeeAuthEmail(restaurantId, employeeId, role)
        : requireString(contactEmail, "Email");
      const authenticationPassword = role === "waiter"
        ? await waiterSupabasePassword(requireWaiterPinPepper(), restaurantId, employeeId)
        : creationCredential;
      const requestedKitchenStationId = initialKitchenStationId(
        actingStaff.role as "owner" | "manager",
        role,
        payload.assignedKitchenStationId,
      );
      const assignedKitchenStationId = requestedKitchenStationId
        ? requireUuid(requestedKitchenStationId, "Kitchen station")
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

      const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
        email,
        password: authenticationPassword,
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
          employee_id: employeeId,
          contact_email: contactEmail,
          shift_label: shift,
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

      if (role === "waiter" && waiterPinFingerprintValue) {
        try {
          await saveWaiterPinCredential(
            serviceClient,
            restaurantId,
            staffData.id,
            waiterPinFingerprintValue,
          );
        } catch (credentialError) {
          await serviceClient.from("restaurant_staff").delete().eq("id", staffData.id).eq("restaurant_id", restaurantId);
          await serviceClient.from("users").delete().eq("id", authData.user.id);
          await serviceClient.auth.admin.deleteUser(authData.user.id);
          throw credentialError;
        }
      }

      try {
        await setCredentialReadiness(
          serviceClient,
          restaurantId,
          staffData.id,
          role === "waiter" ? "waiter_pin_ready" : "password_ready",
          actingStaff.id,
        );
      } catch (readinessError) {
        await serviceClient.from("waiter_pin_credentials").delete().eq("restaurant_id", restaurantId).eq("staff_id", staffData.id);
        await serviceClient.from("restaurant_staff").delete().eq("id", staffData.id).eq("restaurant_id", restaurantId);
        await serviceClient.from("users").delete().eq("id", authData.user.id);
        await serviceClient.auth.admin.deleteUser(authData.user.id);
        throw readinessError;
      }

      await audit(role === "waiter" ? "waiter_created" : "staff_created", staffData.id, email, {
        target_staff_name: fullName,
        role,
        employee_id: employeeId,
        phone_number: phoneNumber,
        previous_values: null,
        new_values: {
          active: true,
          assigned_kitchen_station_id: assignedKitchenStationId,
          contact_email: contactEmail,
          employee_id: employeeId,
          phone_number: phoneNumber,
          role,
          shift_label: shift,
        },
      });
      if (role === "kitchen" && assignedStation) {
        await audit("kitchen_staff_station_assigned", staffData.id, email, {
          target_staff_name: fullName,
          old_station: null,
          old_station_id: null,
          new_station: assignedStation.name,
          new_station_id: assignedStation.id,
          previous_values: { assigned_kitchen_station_id: null },
          new_values: { assigned_kitchen_station_id: assignedStation.id, assigned_kitchen_station: assignedStation.name },
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
        employeeId,
      });
    }

    const staffId = requireUuid(payload.staffId, "Staff ID");
    const targetStaff = await loadTargetStaff(staffId);

    if (targetStaff.id === actingStaff.id) {
      return jsonResponse(400, { error: "Staff cannot manage their own staff record from this endpoint." });
    }

    if (targetStaff.role === "owner") {
      return jsonResponse(400, { error: "Owner staff records cannot be modified from this action." });
    }

    if (targetStaff.role === "manager" && actingStaff.role !== "owner") {
      return jsonResponse(403, { error: "Permission denied." });
    }

    if (action === "update-staff") {
      const updates: Record<string, unknown> = {};
      const details: Record<string, unknown> = {};
      const previousRole = targetStaff.role as StaffRole;
      const previousValues = {
        active: targetStaff.active,
        assigned_kitchen_station_id: targetStaff.assigned_kitchen_station_id ?? null,
        display_name: targetStaff.display_name,
        phone_number: targetStaff.phone_number ?? null,
        role: targetStaff.role,
        username: targetStaff.username ?? null,
      };
      const nextRole = payload.role ? normalizeRole(payload.role) : previousRole;
      if (actingStaff.role === "manager" && payload.role && !MANAGER_CREATABLE_ROLES.includes(nextRole)) {
        return jsonResponse(403, { error: "Permission denied." });
      }
      if ((previousRole === "manager" || nextRole === "manager") && actingStaff.role !== "owner") {
        return jsonResponse(403, { error: "Permission denied." });
      }
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

      if (Object.prototype.hasOwnProperty.call(payload, "phoneNumber")) {
        const phoneNumber = normalizeOptionalPhone(payload.phoneNumber);
        updates.phone_number = phoneNumber;
        details.phone_number = phoneNumber;
      }
      if (Object.prototype.hasOwnProperty.call(payload, "shift")) {
        const shift = normalizeOptionalShift(payload.shift);
        updates.shift_label = shift;
        details.shift_label = shift;
      }
      if (nextRole !== "waiter") {
        updates.username = null;
      }

      if (payload.role && nextRole !== previousRole) {
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
        await audit(nextRole === "waiter" ? "waiter_updated" : "role_changed", staffId, targetStaff.email, {
          ...details,
          target_staff_name: typeof updates.display_name === "string" ? updates.display_name : targetStaff.display_name,
          previous_values: previousValues,
          new_values: { ...previousValues, ...updates },
        });
      } else {
        await audit(targetStaff.role === "waiter" ? "waiter_updated" : "staff_updated", staffId, targetStaff.email, {
          ...details,
          target_staff_name: typeof updates.display_name === "string" ? updates.display_name : targetStaff.display_name,
          previous_values: previousValues,
          new_values: { ...previousValues, ...updates },
        });
      }

      if (previousStationId !== nextStationId) {
        const previousStationName = typeof details.previous_station === "string" ? details.previous_station : null;
        await audit(previousStationId ? "kitchen_staff_station_changed" : "kitchen_staff_station_assigned", staffId, targetStaff.email, {
          target_staff_name: typeof updates.display_name === "string" ? updates.display_name : targetStaff.display_name,
          old_station: previousStationName,
          old_station_id: previousStationId,
          new_station: nextStation?.name ?? null,
          new_station_id: nextStationId,
          previous_values: { assigned_kitchen_station_id: previousStationId, assigned_kitchen_station: previousStationName },
          new_values: { assigned_kitchen_station_id: nextStationId, assigned_kitchen_station: nextStation?.name ?? null },
        });
      }

      return jsonResponse(200, { ok: true });
    }

    if (action === "deactivate-staff" || action === "reactivate-staff" || action === "suspend-staff") {
      const active = action === "reactivate-staff";
      let previousCredentialActive: boolean | null = null;
      if (targetStaff.role === "waiter") {
        const { data: credential, error: credentialReadError } = await serviceClient
          .from("waiter_pin_credentials")
          .select("active")
          .eq("restaurant_id", restaurantId)
          .eq("staff_id", staffId)
          .maybeSingle();
        if (credentialReadError) throw new Error(credentialReadError.message);
        previousCredentialActive = credential?.active ?? null;
        if (credential) {
          const { error: credentialUpdateError } = await serviceClient
            .from("waiter_pin_credentials")
            .update({ active, failed_attempt_count: 0, locked_until: null, last_failed_at: null, updated_at: new Date().toISOString() })
            .eq("restaurant_id", restaurantId)
            .eq("staff_id", staffId);
          if (credentialUpdateError) {
            if (credentialUpdateError.code === "23505") {
              return jsonResponse(409, { error: "This waiter PIN conflicts with another active waiter. Reset the PIN before reactivation." });
            }
            throw new Error(credentialUpdateError.message);
          }
        }
      }
      const { error } = await serviceClient
        .from("restaurant_staff")
        .update({ active, staff_session_active: false, waiter_session_active: targetStaff.role === "waiter" && active ? targetStaff.waiter_session_active : false })
        .eq("id", staffId)
        .eq("restaurant_id", restaurantId);
      if (error) {
        if (targetStaff.role === "waiter" && previousCredentialActive !== null) {
          await serviceClient.from("waiter_pin_credentials")
            .update({ active: previousCredentialActive, updated_at: new Date().toISOString() })
            .eq("restaurant_id", restaurantId)
            .eq("staff_id", staffId);
        }
        throw new Error(error.message);
      }

      const auditAction = targetStaff.role === "waiter"
        ? active ? "waiter_activated" : "waiter_deactivated"
        : action === "suspend-staff" ? "staff_suspended" : active ? "staff_reactivated" : "staff_deactivated";
      await audit(auditAction, staffId, targetStaff.email, {
        target_staff_name: targetStaff.display_name,
        username: targetStaff.username ?? null,
        previous_values: {
          active: targetStaff.active,
          staff_session_active: targetStaff.staff_session_active ?? false,
          waiter_session_active: targetStaff.waiter_session_active ?? false,
        },
        new_values: {
          active,
          staff_session_active: false,
          waiter_session_active: targetStaff.role === "waiter" && active ? targetStaff.waiter_session_active : false,
        },
      });
      return jsonResponse(200, { ok: true });
    }

    if (action === "mark-break" || action === "end-break") {
      await audit(action === "mark-break" ? "staff_break_started" : "staff_break_ended", staffId, targetStaff.email, {
        target_staff_name: targetStaff.display_name,
        username: targetStaff.username ?? null,
        role: targetStaff.role,
        previous_values: { break_status: action === "mark-break" ? "active" : "on_break" },
        new_values: { break_status: action === "mark-break" ? "on_break" : "active" },
      });
      return jsonResponse(200, { ok: true });
    }

    if (action === "send-announcement" || action === "send-notification") {
      const message = requireString(payload.message, "Message");
      await audit(action === "send-announcement" ? "staff_announcement_sent" : "staff_notification_sent", staffId, targetStaff.email, {
        target_staff_name: targetStaff.display_name,
        message,
        username: targetStaff.username ?? null,
        role: targetStaff.role,
        previous_values: null,
        new_values: { message, delivery_type: action === "send-announcement" ? "announcement" : "notification" },
      });
      return jsonResponse(200, { ok: true });
    }

    if (action === "assign-waiter-tables") {
      if (targetStaff.role !== "waiter" || targetStaff.active !== true) {
        return jsonResponse(400, { error: "Only waiters can be assigned tables." });
      }
      const tableIds = Array.isArray(payload.tableIds) ? payload.tableIds.map((id) => requireUuid(id, "Table ID")) : [];
      const { data: assignments, error: assignmentError } = await userClient.rpc("assign_waiter_tables", {
        target_restaurant_id: restaurantId,
        target_waiter_staff_id: staffId,
        target_table_ids: tableIds,
      });
      if (assignmentError) throw new Error(assignmentError.message);
      return jsonResponse(200, { ok: true, assignments: assignments ?? [] });
    }

    if (action === "send-password-reset") {
      if (targetStaff.role === "waiter") {
        return jsonResponse(400, { error: "Use Set/Reset Waiter PIN for waiter accounts." });
      }
      const email = requireString(targetStaff.email, "Target staff email");
      const redirectTo = getResetRedirectUrl();

      if (!redirectTo) {
        logError(requestId, "password reset redirect unavailable", {
          hasConfiguredAppUrl: Boolean(Deno.env.get("APP_URL")?.trim()),
        });
        return jsonResponse(400, { error: "Password reset redirect URL is not configured for this request." });
      }

      const { error } = await userClient.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) throw new Error(error.message);

      await setCredentialReadiness(serviceClient, restaurantId, staffId, "reset_required", actingStaff.id);

      await audit("password_reset_sent", staffId, email, {
        target_staff_name: targetStaff.display_name,
        redirect_to_origin: new URL(redirectTo).origin,
        previous_values: null,
        new_values: { password_reset_requested: true },
      });
      return jsonResponse(200, { ok: true });
    }

    if (action === "set-waiter-pin") {
      if (targetStaff.role !== "waiter" || targetStaff.active !== true) {
        return jsonResponse(400, { error: "Only an active Waiter can receive a waiter PIN." });
      }
      const pin = normalizePinPassword(payload.pin);
      const pinFingerprint = await prepareWaiterPinFingerprint(serviceClient, restaurantId, pin, staffId);
      const { data: previousCredential, error: previousCredentialError } = await serviceClient
        .from("waiter_pin_credentials")
        .select("pin_fingerprint,active,failed_attempt_count,locked_until,last_failed_at")
        .eq("restaurant_id", restaurantId)
        .eq("staff_id", staffId)
        .maybeSingle();
      if (previousCredentialError) throw new Error(previousCredentialError.message);

      await saveWaiterPinCredential(serviceClient, restaurantId, staffId, pinFingerprint);
      const authenticationPassword = await waiterSupabasePassword(
        requireWaiterPinPepper(),
        restaurantId,
        requireString(targetStaff.employee_id, "Employee ID"),
      );
      const { error: authUpdateError } = await serviceClient.auth.admin.updateUserById(targetStaff.user_id, {
        password: authenticationPassword,
      });
      if (authUpdateError) {
        if (previousCredential) {
          await serviceClient.from("waiter_pin_credentials").update({
            ...previousCredential,
            updated_at: new Date().toISOString(),
          }).eq("restaurant_id", restaurantId).eq("staff_id", staffId);
        } else {
          await serviceClient.from("waiter_pin_credentials").delete().eq("restaurant_id", restaurantId).eq("staff_id", staffId);
        }
        throw new Error(authUpdateError.message);
      }

      await setCredentialReadiness(serviceClient, restaurantId, staffId, "waiter_pin_ready", actingStaff.id);
      await audit("waiter_pin_reset", staffId, targetStaff.email, {
        target_staff_name: targetStaff.display_name,
        username: targetStaff.username ?? null,
        previous_values: null,
        new_values: { pin_reset: true, employee_id: targetStaff.employee_id ?? null },
      });
      return jsonResponse(200, { ok: true });
    }

    if (action === "generate-temporary-password") {
      return jsonResponse(400, {
        error: targetStaff.role === "waiter"
          ? "Use Set/Reset Waiter PIN instead."
          : "Send a password setup link instead.",
      });
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
        target_staff_name: targetStaff.display_name,
        deleted_staff_id: staffId,
        username: targetStaff.username ?? null,
        display_name: targetStaff.display_name,
        future_shift_check: futureShiftExists,
        future_assigned_tables_check: futureAssignedTablesExist,
        previous_values: {
          active: targetStaff.active,
          display_name: targetStaff.display_name,
          role: targetStaff.role,
          username: targetStaff.username ?? null,
        },
        new_values: { deleted: true },
      });

      const { error } = await serviceClient.auth.admin.deleteUser(targetStaff.user_id);
      if (error) throw new Error(error.message);

      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(400, { error: "Unsupported staff action." });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      logInfo(requestId, "manage-staff request denied", { error: error.message });
      return jsonResponse(403, { error: "Permission denied.", requestId });
    }

    logError(requestId, "manage-staff request failed", {
      error: error instanceof Error ? error.message : "Staff management request failed.",
    });
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : "Staff management request failed.",
      requestId,
    });
  }
});
