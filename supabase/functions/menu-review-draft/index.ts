import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeReviewState } from "./validation.ts";

type ReviewRequest = {
  extractionId?: unknown;
  expectedRevision?: unknown;
  reviewState?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function environment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function extractionId(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("A valid extraction draft ID is required.");
  }
  return value;
}

function revision(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("A valid expected revision is required.");
  }
  return Number(value);
}

function message(error: unknown) {
  return (
    error instanceof Error ? error.message : "The review draft could not be saved."
  ).slice(0, 1000);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse(413, { error: "The review draft is too large." });
  }

  try {
    const supabaseUrl = environment("SUPABASE_URL");
    const anonKey = environment("SUPABASE_ANON_KEY");
    const serviceRoleKey = environment("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization")?.trim();
    if (!authorization) {
      return jsonResponse(401, { error: "Authentication required." });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } =
      await userClient.auth.getUser();
    if (authError || !authData.user) {
      return jsonResponse(401, { error: "Authentication required." });
    }

    const payload = await request.json() as ReviewRequest;
    const targetId = extractionId(payload.extractionId);
    const expectedRevision = revision(payload.expectedRevision);
    const serializedState = JSON.stringify(payload.reviewState);
    if (new TextEncoder().encode(serializedState).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse(413, { error: "The review draft is too large." });
    }
    const reviewState = normalizeReviewState(payload.reviewState);

    const { data: draft, error: draftError } = await serviceClient
      .from("ai_menu_import_drafts")
      .select("id,restaurant_id,status,review_revision")
      .eq("id", targetId)
      .limit(1)
      .maybeSingle();
    if (draftError) throw new Error(draftError.message);
    if (!draft) {
      return jsonResponse(404, { error: "AI import draft was not found." });
    }
    if (draft.status !== "completed") {
      return jsonResponse(409, {
        error: "Extraction must complete before the draft can be reviewed.",
      });
    }

    const { data: owner, error: ownerError } = await serviceClient
      .from("restaurant_staff")
      .select("id")
      .eq("restaurant_id", draft.restaurant_id)
      .eq("user_id", authData.user.id)
      .eq("role", "owner")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (ownerError) throw new Error(ownerError.message);
    if (!owner) {
      return jsonResponse(403, {
        error: "Only the restaurant owner can change an AI import draft.",
      });
    }

    const now = new Date().toISOString();
    const { data: savedDraft, error: saveError } = await serviceClient
      .from("ai_menu_import_drafts")
      .update({
        review_state: reviewState,
        review_revision: expectedRevision + 1,
        review_updated_by: authData.user.id,
        review_updated_at: now,
      })
      .eq("id", targetId)
      .eq("review_revision", expectedRevision)
      .select("*")
      .maybeSingle();
    if (saveError) throw new Error(saveError.message);
    if (!savedDraft) {
      return jsonResponse(409, {
        error: "This draft changed in another session. Reload before editing.",
      });
    }
    return jsonResponse(200, { importDraft: savedDraft });
  } catch (error) {
    return jsonResponse(400, { error: message(error) });
  }
});
