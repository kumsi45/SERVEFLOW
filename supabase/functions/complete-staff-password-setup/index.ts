import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PRIVILEGED_ROLES = ["owner", "manager", "cashier", "kitchen", "inventory", "inventory_officer"] as const;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function requireEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function normalizePassword(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new Error("Create a password with at least 8 characters.");
  }
  return value;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed." });

  try {
    const authorization = request.headers.get("Authorization")?.trim();
    if (!authorization) return response(401, { error: "Authentication required." });

    const supabaseUrl = requireEnvironment("SUPABASE_URL");
    const anonKey = requireEnvironment("SUPABASE_ANON_KEY");
    const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return response(401, { error: "Authentication required." });

    const payload = await request.json() as { password?: unknown };
    const password = normalizePassword(payload.password);
    const { data: memberships, error: membershipError } = await service
      .from("restaurant_staff")
      .select("id,restaurant_id,role,active")
      .eq("user_id", userData.user.id)
      .eq("active", true)
      .in("role", [...PRIVILEGED_ROLES]);
    if (membershipError) throw membershipError;
    if (!memberships?.length) return response(403, { error: "No active staff account is eligible for password setup." });

    const { error: passwordError } = await service.auth.admin.updateUserById(userData.user.id, { password });
    if (passwordError) throw passwordError;

    const readyAt = new Date().toISOString();
    const { error: readinessError } = await service.from("staff_credential_readiness").upsert(
      memberships.map((membership) => ({
        restaurant_id: membership.restaurant_id,
        staff_id: membership.id,
        readiness: "password_ready",
        ready_at: readyAt,
        updated_by_staff_id: membership.id,
        updated_at: readyAt,
      })),
      { onConflict: "restaurant_id,staff_id" },
    );
    if (readinessError) throw readinessError;

    return response(200, { ok: true });
  } catch (error) {
    // Passwords and request bodies must never be logged.
    console.error("complete-staff-password-setup failed", error instanceof Error ? error.message : "unknown error");
    const safeMessage = error instanceof Error && error.message === "Create a password with at least 8 characters."
      ? error.message
      : "Password setup could not be completed. Request a new setup link and try again.";
    return response(400, { error: safeMessage });
  }
});
