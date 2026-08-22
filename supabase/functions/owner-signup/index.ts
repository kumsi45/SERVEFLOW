import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateStaffPassword } from "../_shared/staffAuthPolicy.ts";

type OwnerSignupPayload = {
  ownerName?: string;
  email?: string;
  password?: string;
  restaurantName?: string;
  restaurantSlug?: string;
  tableCount?: number | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function normalizeEmail(value: unknown) {
  const email = requireString(value, "Email").toLowerCase();

  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new Error("A valid email address is required.");
  }

  return email;
}

function normalizePassword(value: unknown) {
  const password = requireString(value, "Password");

  const error = validateStaffPassword(password);
  if (error) throw new Error(error);

  return password;
}

function normalizeName(value: unknown, label: string, maxLength: number) {
  const name = requireString(value, label);

  if (name.length < 2 || name.length > maxLength) {
    throw new Error(`${label} must be between 2 and ${maxLength} characters.`);
  }

  return name;
}

function normalizeSlug(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const slug = value.trim().toLowerCase();
  if (!slug) {
    return null;
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    throw new Error("Restaurant slug is invalid.");
  }

  return slug;
}

function normalizeTableCount(value: unknown) {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 500) {
    throw new Error("Table count must be a whole number from 1 to 500.");
  }

  return value;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const supabaseUrl = requireString(Deno.env.get("SUPABASE_URL"), "SUPABASE_URL");
    const serviceRoleKey = requireString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "SUPABASE_SERVICE_ROLE_KEY");
    const payload = (await request.json()) as OwnerSignupPayload;

    const ownerName = normalizeName(payload.ownerName, "Owner name", 80);
    const email = normalizeEmail(payload.email);
    const password = normalizePassword(payload.password);
    const restaurantName = normalizeName(payload.restaurantName, "Restaurant name", 100);
    const restaurantSlug = normalizeSlug(payload.restaurantSlug);
    const tableCount = normalizeTableCount(payload.tableCount);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        signup_kind: "owner",
        display_name: ownerName,
        restaurant_name: restaurantName,
        restaurant_slug: restaurantSlug,
        table_count: tableCount,
      },
    });

    if (error || !data.user) {
      const message = error?.message || "Account could not be created.";
      const status = /already|registered|exists/i.test(message) ? 409 : 400;
      return jsonResponse(status, { error: message });
    }

    return jsonResponse(200, {
      ok: true,
      userId: data.user.id,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : "Owner signup failed.",
    });
  }
});
