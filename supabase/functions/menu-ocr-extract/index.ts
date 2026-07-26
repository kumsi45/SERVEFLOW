import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeExtraction } from "./contracts.ts";
import { getMenuExtractionProvider } from "./providers/registry.ts";

type ExtractionRequest = {
  draftId?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
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

function requireEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function requireDraftId(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error("A valid import draft ID is required.");
  }
  return value;
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : "Menu extraction failed.";
  return message.slice(0, 1000);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const supabaseUrl = requireEnvironment("SUPABASE_URL");
    const anonKey = requireEnvironment("SUPABASE_ANON_KEY");
    const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
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
    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse(401, { error: "Authentication required." });
    }

    const payload = await request.json() as ExtractionRequest;
    const draftId = requireDraftId(payload.draftId);
    const { data: sourceDraft, error: draftError } = await serviceClient
      .from("menu_import_drafts")
      .select(
        "id,restaurant_id,file_name,object_path,mime_type,file_size,updated_at",
      )
      .eq("id", draftId)
      .limit(1)
      .maybeSingle();
    if (draftError) throw new Error(draftError.message);
    if (!sourceDraft) {
      return jsonResponse(404, { error: "Import draft was not found." });
    }

    const { data: ownerMembership, error: ownerError } = await serviceClient
      .from("restaurant_staff")
      .select("id")
      .eq("restaurant_id", sourceDraft.restaurant_id)
      .eq("user_id", userData.user.id)
      .eq("role", "owner")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (ownerError) throw new Error(ownerError.message);
    if (!ownerMembership) {
      return jsonResponse(403, { error: "Owner access is required." });
    }

    if (
      !SUPPORTED_MIME_TYPES.has(sourceDraft.mime_type) ||
      Number(sourceDraft.file_size) <= 0 ||
      Number(sourceDraft.file_size) > MAX_SOURCE_BYTES
    ) {
      return jsonResponse(400, {
        error: "The import draft has an unsupported type or size.",
      });
    }

    const provider = getMenuExtractionProvider();
    const { data: sourceBlob, error: downloadError } =
      await serviceClient.storage
        .from("menu-import-drafts")
        .download(sourceDraft.object_path);
    if (downloadError || !sourceBlob) {
      throw new Error(
        downloadError?.message || "The source file could not be downloaded.",
      );
    }
    const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());

    const processingValues = {
      restaurant_id: sourceDraft.restaurant_id,
      source_draft_id: sourceDraft.id,
      requested_by: userData.user.id,
      provider: provider.name,
      model: provider.model,
      status: "processing",
      source_updated_at: sourceDraft.updated_at,
      structured_result: null,
      error_message: null,
      started_at: new Date().toISOString(),
      completed_at: null,
    };
    const { data: processingDraft, error: processingError } =
      await serviceClient
        .from("ai_menu_import_drafts")
        .upsert(processingValues, { onConflict: "source_draft_id" })
        .select("*")
        .single();
    if (processingError || !processingDraft) {
      throw new Error(
        processingError?.message || "The extraction draft could not be started.",
      );
    }

    try {
      const extracted = await provider.extract({
        bytes: sourceBytes,
        fileName: sourceDraft.file_name,
        mimeType: sourceDraft.mime_type,
      });
      const normalized = normalizeExtraction(extracted);
      const { data: completedDraft, error: completedError } =
        await serviceClient
          .from("ai_menu_import_drafts")
          .update({
            status: "completed",
            structured_result: normalized,
            error_message: null,
            completed_at: new Date().toISOString(),
            review_state: null,
            review_revision: 0,
            review_updated_by: null,
            review_updated_at: null,
          })
          .eq("id", processingDraft.id)
          .eq("source_updated_at", sourceDraft.updated_at)
          .select("*")
          .single();
      if (completedError || !completedDraft) {
        throw new Error(
          completedError?.message || "The extraction result could not be saved.",
        );
      }
      return jsonResponse(200, { extraction: completedDraft });
    } catch (extractionError) {
      const errorMessage = safeErrorMessage(extractionError);
      const { data: failedDraft, error: failedUpdateError } =
        await serviceClient
          .from("ai_menu_import_drafts")
          .update({
            status: "failed",
            structured_result: null,
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq("id", processingDraft.id)
          .select("*")
          .single();
      if (failedUpdateError || !failedDraft) {
        throw new Error(
          failedUpdateError?.message || "The extraction failure could not be saved.",
        );
      }
      return jsonResponse(200, { extraction: failedDraft });
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    const configurationError =
      /OPENAI_API_KEY|MENU_OCR_PROVIDER|SUPABASE_/.test(message);
    return jsonResponse(configurationError ? 503 : 400, { error: message });
  }
});
