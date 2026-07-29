import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeAiMenuResult,
  type RawAiMenuResult,
} from "./contracts.ts";
import { getAiMenuProvider } from "./providers/registry.ts";

type ImportMode = "ai" | "library" | "starter" | "manual";
type AiMenuImportRequest = {
  mode?: unknown;
  draftId?: unknown;
  restaurantId?: unknown;
  restaurantType?: unknown;
  templateKey?: unknown;
  menu?: unknown;
};

type ServiceClient = ReturnType<typeof createClient>;

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
const USER_FAILURE_MESSAGE = "We couldn't create your digital menu.";
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

function requireUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`A valid ${label} is required.`);
  }
  return value;
}

function cleanText(value: unknown, maximum = 160) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function importMode(value: unknown): ImportMode {
  return value === "library" || value === "starter" || value === "manual" ? value : "ai";
}

function diagnostic(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ scope: "menu-ai-import", event, ...details }));
}

function diagnosticFailure(event: string, error: unknown, details: Record<string, unknown> = {}) {
  const reason = error instanceof Error ? error.message : "Unknown failure";
  console.error(JSON.stringify({
    scope: "menu-ai-import",
    event,
    reason: reason.slice(0, 500),
    ...details,
  }));
}

async function requireOwner(
  service: ServiceClient,
  restaurantId: string,
  userId: string,
) {
  const { data, error } = await service
    .from("restaurant_staff")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("user_id", userId)
    .eq("role", "owner")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Owner access is required.");
}

function confidence<T>(value: T | null, score: number) {
  return { value, confidence: value === null ? 0 : score };
}

function language(value: string | null) {
  return confidence(value ? "unknown" as const : "unknown" as const, value ? 0.2 : 0);
}

function starterTemplateResult(template: Record<string, unknown>): RawAiMenuResult {
  const categories = Array.isArray(template.restaurant_starter_template_categories)
    ? template.restaurant_starter_template_categories as Array<Record<string, unknown>>
    : [];
  const categoryRows = categories
    .map((category) => ({ ...category, cleanName: cleanText(category.name, 120) }))
    .filter((category) => category.cleanName)
    .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));
  return {
    restaurantName: confidence(null, 0),
    restaurantNameLanguage: language(null),
    categories: categoryRows.map((category) => ({
      name: confidence(category.cleanName, 1),
      detectedLanguage: language(category.cleanName),
    })),
    items: categoryRows.flatMap((category) => {
      const rows = Array.isArray(category.restaurant_starter_template_items)
        ? category.restaurant_starter_template_items as Array<Record<string, unknown>>
        : [];
      return rows
        .map((item) => ({
          ...item,
          cleanName: cleanText(item.name, 160),
          cleanDescription: cleanText(item.description, 160),
        }))
        .filter((item) => item.cleanName)
        .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0))
        .map((item) => {
          const rawPrice = typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0
            ? item.price
            : null;
          return {
            category: confidence(category.cleanName, 1),
            categoryLanguage: language(category.cleanName),
            name: confidence(item.cleanName, 1),
            nameLanguage: language(item.cleanName),
            description: confidence(item.cleanDescription || null, item.cleanDescription ? 1 : 0),
            descriptionLanguage: language(item.cleanDescription || null),
            price: confidence(rawPrice, rawPrice === null ? 0 : 1),
            currency: confidence(rawPrice === null ? null : "ETB", rawPrice === null ? 0 : 1),
          };
        });
    }),
  };
}

async function loadStarterTemplate(
  service: ServiceClient,
  templateKey: string,
  restaurantType: string,
) {
  let query = service
    .from("restaurant_starter_templates")
    .select("id,template_key,name,restaurant_type,display_order,restaurant_starter_template_categories(id,name,display_order,restaurant_starter_template_items(id,name,description,price,display_order))")
    .eq("active", true);
  if (templateKey) query = query.eq("template_key", templateKey);
  else if (restaurantType) query = query.in("restaurant_type", [restaurantType, "Mixed Restaurant"]);
  const { data, error } = await query.order("display_order", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No starter menu is available for this restaurant type.");
  return data as Record<string, unknown>;
}

function smartLibraryResult(library: Record<string, unknown>): RawAiMenuResult {
  const mappings = Array.isArray(library.serveflow_smart_menu_library_categories)
    ? library.serveflow_smart_menu_library_categories as Array<Record<string, unknown>>
    : [];
  const ordered = [...mappings].sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));
  const itemMappings = Array.isArray(library.serveflow_smart_menu_library_items)
    ? library.serveflow_smart_menu_library_items as Array<Record<string, unknown>>
    : [];
  return {
    restaurantName: confidence(null, 0),
    restaurantNameLanguage: language(null),
    categories: ordered.map((mapping) => {
      const category = mapping.category && typeof mapping.category === "object"
        ? mapping.category as Record<string, unknown>
        : {};
      const name = cleanText(category.name, 120);
      return { name: confidence(name || null, name ? 1 : 0), detectedLanguage: language(name || null) };
    }).filter((category) => category.name.value),
    items: [...itemMappings]
      .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0))
      .map((mapping) => {
        const item = mapping.item && typeof mapping.item === "object"
          ? mapping.item as Record<string, unknown>
          : {};
        const category = item.category && typeof item.category === "object"
          ? item.category as Record<string, unknown>
          : {};
        const categoryName = cleanText(category.name, 120);
        const name = cleanText(item.name, 160);
        const description = cleanText(item.default_description, 160);
        return {
          category: confidence(categoryName || null, categoryName ? 1 : 0),
          categoryLanguage: language(categoryName || null),
          name: confidence(name || null, name ? 1 : 0),
          nameLanguage: language(name || null),
          description: confidence(description || null, description ? 1 : 0),
          descriptionLanguage: language(description || null),
          price: confidence(null, 0),
          currency: confidence(null, 0),
        };
      })
      .filter((item) => item.name.value && item.category.value),
  };
}

async function loadSmartLibrary(service: ServiceClient, restaurantType: string) {
  const { data, error } = await service
    .from("serveflow_smart_menu_libraries")
    .select("id,restaurant_type,name,serveflow_smart_menu_library_categories(display_order,active,category:serveflow_master_menu_categories(id,name,slug,icon,display_order,active)),serveflow_smart_menu_library_items(display_order,active,item:serveflow_master_menu_items(id,name,default_description,default_image_reference,keywords,display_order,active,category:serveflow_master_menu_categories(id,name,slug)))")
    .eq("restaurant_type", restaurantType)
    .eq("active", true)
    .eq("serveflow_smart_menu_library_categories.active", true)
    .eq("serveflow_smart_menu_library_items.active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No ServeFlow Smart Menu is available for this restaurant type.");
  return data as Record<string, unknown>;
}

async function createCompletedDraft(
  service: ServiceClient,
  values: Record<string, unknown>,
  raw: RawAiMenuResult,
) {
  diagnostic("json_validation_started", { sourceKind: values.source_kind });
  const normalized = normalizeAiMenuResult(raw);
  diagnostic("json_validation_completed", {
    sourceKind: values.source_kind,
    categoryCount: normalized.categories.length,
    itemCount: normalized.items.length,
  });
  const now = new Date().toISOString();
  const { data, error } = await service
    .from("ai_menu_import_drafts")
    .insert({
      ...values,
      status: "completed",
      structured_result: normalized,
      error_message: null,
      started_at: now,
      completed_at: now,
      review_state: null,
      review_revision: 0,
      review_updated_by: null,
      review_updated_at: null,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "The review draft could not be created.");
  diagnostic("review_draft_created", { reviewDraftId: data.id, sourceKind: values.source_kind });
  return data;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  try {
    const supabaseUrl = requireEnvironment("SUPABASE_URL");
    const anonKey = requireEnvironment("SUPABASE_ANON_KEY");
    const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization")?.trim();
    if (!authorization) return jsonResponse(401, { error: "Authentication required." });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return jsonResponse(401, { error: "Authentication required." });

    const payload = await request.json() as AiMenuImportRequest;
    const mode = importMode(payload.mode);

    if (mode === "library" || mode === "starter" || mode === "manual") {
      const restaurantId = requireUuid(payload.restaurantId, "restaurant ID");
      await requireOwner(service, restaurantId, userData.user.id);
      const restaurantType = cleanText(payload.restaurantType, 80);
      const sourceReference = mode === "library"
        ? restaurantType
        : mode === "starter"
          ? cleanText(payload.templateKey, 120)
          : `manual-${crypto.randomUUID()}`;
      diagnostic("import_requested", { mode, restaurantId });
      if (mode === "library") {
        const { data: existing, error: existingError } = await service
          .from("ai_menu_import_drafts")
          .select("*")
           .eq("restaurant_id", restaurantId)
           .eq("source_kind", "smart_library")
           .eq("source_reference", restaurantType)
           .eq("model", "smart-menu-library-v1")
           .eq("publish_status", "draft")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingError) throw new Error(existingError.message);
        if (existing) {
          diagnostic("review_draft_reused", { reviewDraftId: existing.id, sourceKind: "smart_library" });
          return jsonResponse(200, { importDraft: existing });
        }
        const { error: cleanupError } = await service
          .from("ai_menu_import_drafts")
          .delete()
          .eq("restaurant_id", restaurantId)
          .eq("source_kind", "smart_library")
          .eq("publish_status", "draft");
        if (cleanupError) throw new Error(cleanupError.message);
      }
      const raw = mode === "library"
        ? smartLibraryResult(await loadSmartLibrary(service, restaurantType))
        : mode === "starter"
          ? starterTemplateResult(await loadStarterTemplate(
            service,
            cleanText(payload.templateKey, 120),
            restaurantType,
          ))
          : payload.menu as RawAiMenuResult;
      const draft = await createCompletedDraft(service, {
        restaurant_id: restaurantId,
        source_draft_id: null,
        source_kind: mode === "library" ? "smart_library" : mode,
        source_reference: sourceReference,
        requested_by: userData.user.id,
        provider: "serveflow",
         model: mode === "library" ? "smart-menu-library-v1" : mode === "starter" ? "starter-template" : "manual",
        source_updated_at: new Date().toISOString(),
      }, raw);
      return jsonResponse(200, { importDraft: draft });
    }

    const draftId = requireUuid(payload.draftId, "import draft ID");
    const { data: source, error: sourceError } = await service
      .from("menu_import_drafts")
      .select("id,restaurant_id,file_name,object_path,mime_type,file_size,updated_at")
      .eq("id", draftId)
      .limit(1)
      .maybeSingle();
    if (sourceError) throw new Error(sourceError.message);
    if (!source) return jsonResponse(404, { error: "Import draft was not found." });
    await requireOwner(service, source.restaurant_id, userData.user.id);

    diagnostic("upload_received", { draftId: source.id, restaurantId: source.restaurant_id });
    if (!SUPPORTED_MIME_TYPES.has(source.mime_type) || Number(source.file_size) <= 0 || Number(source.file_size) > MAX_SOURCE_BYTES) {
      return jsonResponse(400, { error: "The uploaded menu has an unsupported type or size." });
    }

    const provider = getAiMenuProvider();
    const { data: sourceBlob, error: downloadError } = await service.storage
      .from("menu-import-drafts")
      .download(source.object_path);
    if (downloadError || !sourceBlob) throw new Error(downloadError?.message || "The uploaded menu could not be loaded.");
    const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());

    const processingValues = {
      restaurant_id: source.restaurant_id,
      source_draft_id: source.id,
      source_kind: "upload",
      source_reference: null,
      requested_by: userData.user.id,
      provider: provider.name,
      model: provider.model,
      status: "processing",
      source_updated_at: source.updated_at,
      structured_result: null,
      error_message: null,
      started_at: new Date().toISOString(),
      completed_at: null,
    };
    const { data: processingDraft, error: processingError } = await service
      .from("ai_menu_import_drafts")
      .upsert(processingValues, { onConflict: "source_draft_id" })
      .select("*")
      .single();
    if (processingError || !processingDraft) throw new Error(processingError?.message || "The AI import could not be started.");

    try {
      diagnostic("provider_request_started", { provider: provider.name, model: provider.model, reviewDraftId: processingDraft.id });
      const raw = await provider.importMenu({
        bytes: sourceBytes,
        fileName: source.file_name,
        mimeType: source.mime_type,
      });
      diagnostic("provider_response_received", { provider: provider.name, reviewDraftId: processingDraft.id });
      const normalized = normalizeAiMenuResult(raw);
      diagnostic("json_validation_completed", { reviewDraftId: processingDraft.id, categoryCount: normalized.categories.length, itemCount: normalized.items.length });
      const { data: completed, error: completedError } = await service
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
        .eq("source_updated_at", source.updated_at)
        .select("*")
        .single();
      if (completedError || !completed) throw new Error(completedError?.message || "The review draft could not be saved.");
      diagnostic("review_draft_created", { reviewDraftId: completed.id, sourceKind: "upload" });
      return jsonResponse(200, { importDraft: completed });
    } catch (providerError) {
      diagnosticFailure("provider_request_failed", providerError, { provider: provider.name, reviewDraftId: processingDraft.id });
      const { data: failed, error: failedError } = await service
        .from("ai_menu_import_drafts")
        .update({
          status: "failed",
          structured_result: null,
          error_message: USER_FAILURE_MESSAGE,
          completed_at: new Date().toISOString(),
        })
        .eq("id", processingDraft.id)
        .select("*")
        .single();
      if (failedError || !failed) throw new Error(failedError?.message || "The AI import failure could not be saved.");
      return jsonResponse(200, { importDraft: failed });
    }
  } catch (error) {
    diagnosticFailure("request_failed", error);
    const message = error instanceof Error ? error.message : "Request failed.";
    const authError = /Authentication|Owner access/.test(message);
    return jsonResponse(authError ? 403 : 400, { error: authError ? message : USER_FAILURE_MESSAGE });
  }
});
