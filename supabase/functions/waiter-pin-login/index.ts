import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeWaiterPin,
  requireWaiterPinPepper,
  waiterPinFingerprint,
  waiterSupabasePassword,
  waiterThrottleFingerprint,
} from "../_shared/waiterPin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const noStoreHeaders = { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" };
const INVALID_MESSAGE = "PIN not recognized. Try again.";
const THROTTLED_MESSAGE = "Too many attempts. Try again shortly.";
const RATE_WINDOW_MS = 2 * 60 * 1000;
const RATE_LIMIT = 5;
const CREDENTIAL_LOCK_MS = 30 * 1000;

type LoginPayload = { restaurantSlug?: unknown; pin?: unknown; terminalId?: unknown };
type LoginTimings = {
  restaurantMs: number;
  verifierAndThrottleMs: number;
  supabaseSignInMs: number;
  loginRecordMs: number;
  auditFinalizeMs: number;
};
type CredentialRow = {
  id: string;
  staff_id: string;
  failed_attempt_count: number;
  locked_until: string | null;
  restaurant_staff:
    | { id: string; user_id: string; email: string | null; display_name: string; employee_id: string | null; role: string; active: boolean; restaurant_id: string }
    | Array<{ id: string; user_id: string; email: string | null; display_name: string; employee_id: string | null; role: string; active: boolean; restaurant_id: string }>;
};
type AttemptReservation = { event_id: number; allowed: boolean; recent_failures: number };

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: noStoreHeaders });
}

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed." });

  const requestStartedAt = performance.now();
  const timings: LoginTimings = {
    restaurantMs: 0,
    verifierAndThrottleMs: 0,
    supabaseSignInMs: 0,
    loginRecordMs: 0,
    auditFinalizeMs: 0,
  };
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const pepper = requireWaiterPinPepper();
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Authentication service is unavailable.");

    const payload = (await request.json()) as LoginPayload;
    const restaurantSlug = typeof payload.restaurantSlug === "string" ? payload.restaurantSlug.trim().toLowerCase() : "";
    const terminalId = typeof payload.terminalId === "string" ? payload.terminalId.trim().slice(0, 128) : "";
    const pin = normalizeWaiterPin(payload.pin);
    if (!restaurantSlug || restaurantSlug.length > 120 || !terminalId) {
      return response(400, { error: INVALID_MESSAGE, code: "invalid_pin" });
    }

    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const restaurantStartedAt = performance.now();
    const { data: restaurant, error: restaurantError } = await service
      .from("restaurants")
      .select("id,slug,name,branding,currency_code,currency_symbol,locale")
      .eq("active", true)
      .eq("slug", restaurantSlug)
      .limit(1)
      .maybeSingle();
    timings.restaurantMs = Math.round(performance.now() - restaurantStartedAt);
    if (restaurantError || !restaurant) return response(401, { error: INVALID_MESSAGE, code: "invalid_pin" });

    const clientAddress = (request.headers.get("x-forwarded-for") ?? request.headers.get("cf-connecting-ip") ?? "unknown")
      .split(",")[0]
      .trim()
      .slice(0, 96);
    // Never trust a client-generated terminal ID as the brute-force boundary: it is
    // intentionally easy to rotate. The platform-provided client address is keyed
    // together with the tenant so attempts remain isolated per restaurant and source.
    const verifierStartedAt = performance.now();
    const [scopeFingerprint, pinFingerprint] = await Promise.all([
      waiterThrottleFingerprint(pepper, restaurant.id, clientAddress),
      waiterPinFingerprint(pepper, restaurant.id, pin),
    ]);
    const [reservationResult, credentialResult] = await Promise.all([
      service.rpc("reserve_waiter_pin_auth_attempt", {
        target_restaurant_id: restaurant.id,
        target_scope_fingerprint: scopeFingerprint,
        target_window_seconds: Math.round(RATE_WINDOW_MS / 1000),
        target_attempt_limit: RATE_LIMIT,
      }),
      service
        .from("waiter_pin_credentials")
        .select("id,staff_id,failed_attempt_count,locked_until,restaurant_staff!inner(id,user_id,email,display_name,employee_id,role,active,restaurant_id)")
        .eq("restaurant_id", restaurant.id)
        .eq("pin_fingerprint", pinFingerprint)
        .eq("active", true)
        .limit(2),
    ]);
    const reservation = one((reservationResult.data ?? []) as AttemptReservation[]);
    if (reservationResult.error || !reservation?.event_id) throw reservationResult.error ?? new Error("Attempt reservation failed.");
    const finalizeAttempt = (outcome: "success" | "invalid" | "conflict" | "throttled", credentialId?: string) =>
      service
        .from("waiter_pin_auth_events")
        .update({ outcome, credential_id: credentialId ?? null })
        .eq("id", reservation.event_id)
        .eq("restaurant_id", restaurant.id);
    if (!reservation.allowed) {
      return response(429, { error: THROTTLED_MESSAGE, code: "throttled", retryAfterSeconds: 30 });
    }

    const { data: credentials, error: credentialError } = credentialResult;
    timings.verifierAndThrottleMs = Math.round(performance.now() - verifierStartedAt);
    if (credentialError) throw credentialError;

    if ((credentials ?? []).length !== 1) {
      const outcome = (credentials ?? []).length > 1 ? "conflict" : "invalid";
      await finalizeAttempt(outcome);
      return response(401, { error: INVALID_MESSAGE, code: "invalid_pin" });
    }

    const credential = credentials![0] as CredentialRow;
    const staff = one(credential.restaurant_staff);
    const lockedUntil = credential.locked_until ? new Date(credential.locked_until).getTime() : 0;
    if (!staff || !staff.active || staff.role !== "waiter" || staff.restaurant_id !== restaurant.id || lockedUntil > Date.now()) {
      await finalizeAttempt(lockedUntil > Date.now() ? "throttled" : "invalid", credential.id);
      return response(lockedUntil > Date.now() ? 429 : 401, { error: lockedUntil > Date.now() ? THROTTLED_MESSAGE : INVALID_MESSAGE, code: lockedUntil > Date.now() ? "throttled" : "invalid_pin" });
    }
    if (!staff.email || !staff.user_id || !staff.employee_id) {
      await finalizeAttempt("invalid", credential.id);
      return response(401, { error: INVALID_MESSAGE, code: "invalid_pin" });
    }

    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const authPassword = await waiterSupabasePassword(pepper, restaurant.id, staff.employee_id);
    const signInStartedAt = performance.now();
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({ email: staff.email, password: authPassword });
    timings.supabaseSignInMs = Math.round(performance.now() - signInStartedAt);
    if (authError || !authData.user || !authData.session || authData.user.id !== staff.user_id) {
      const failures = credential.failed_attempt_count + 1;
      await service.from("waiter_pin_credentials").update({
        failed_attempt_count: failures,
        last_failed_at: new Date().toISOString(),
        locked_until: failures >= RATE_LIMIT ? new Date(Date.now() + CREDENTIAL_LOCK_MS).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", credential.id);
      await finalizeAttempt("invalid", credential.id);
      return response(401, { error: INVALID_MESSAGE, code: "invalid_pin" });
    }

    const loginRecordStartedAt = performance.now();
    const { error: loginError } = await authClient.rpc("record_waiter_login", { target_restaurant_id: restaurant.id });
    timings.loginRecordMs = Math.round(performance.now() - loginRecordStartedAt);
    if (loginError) {
      await authClient.auth.signOut({ scope: "local" });
      throw loginError;
    }

    const auditFinalizeStartedAt = performance.now();
    await Promise.all([
      service.from("waiter_pin_credentials").update({ failed_attempt_count: 0, last_failed_at: null, locked_until: null, updated_at: new Date().toISOString() }).eq("id", credential.id),
      finalizeAttempt("success", credential.id),
    ]);
    timings.auditFinalizeMs = Math.round(performance.now() - auditFinalizeStartedAt);

    return response(200, {
      session: {
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        expiresAt: authData.session.expires_at ?? null,
      },
      waiter: { staffId: staff.id, userId: staff.user_id, displayName: staff.display_name, employeeId: staff.employee_id },
      restaurant: {
        id: restaurant.id,
        slug: restaurant.slug,
        name: restaurant.name,
        logoUrl: restaurant.branding?.logo_url ?? null,
        currencyCode: restaurant.currency_code ?? null,
        currencySymbol: restaurant.currency_symbol ?? null,
        locale: restaurant.locale ?? null,
      },
      elapsedMs: Math.round(performance.now() - requestStartedAt),
      timings,
    });
  } catch {
    console.error("waiter-pin-login failed");
    return response(503, { error: "Connection unavailable.", code: "unavailable" });
  }
});
