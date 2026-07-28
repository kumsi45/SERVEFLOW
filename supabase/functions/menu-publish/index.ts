import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRAFT_BUCKET = "menu-item-image-drafts";
const PRODUCTION_BUCKET = "menu-photos";

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function publicObjectPath(url: string) {
  const marker = `/storage/v1/object/public/${DRAFT_BUCKET}/`;
  const index = url.indexOf(marker);
  return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response(405, { error: "Method not allowed." });
  const uploaded: string[] = [];
  try {
    const authorization = request.headers.get("Authorization")?.trim();
    if (!authorization) return response(401, { error: "Authentication required." });
    const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) return response(401, { error: "Authentication required." });
    const payload = await request.json() as { restaurantId?: unknown; draftId?: unknown; expectedRevision?: unknown };
    if (typeof payload.restaurantId !== "string" || !UUID.test(payload.restaurantId)) return response(400, { error: "Restaurant ID is invalid." });
    if (typeof payload.draftId !== "string" || !UUID.test(payload.draftId)) return response(400, { error: "Draft ID is invalid." });
    if (!Number.isInteger(payload.expectedRevision) || Number(payload.expectedRevision) < 0) return response(400, { error: "Draft revision is invalid." });

    const { data: membership } = await service.from("restaurant_staff").select("id,role").eq("restaurant_id", payload.restaurantId).eq("user_id", authData.user.id).eq("role", "owner").eq("active", true).maybeSingle();
    if (!membership) return response(403, { error: "Only the restaurant owner may publish a menu." });
    const { data: draft, error: draftError } = await service.from("ai_menu_import_drafts").select("id,restaurant_id,status,review_state,review_revision,publish_status").eq("id", payload.draftId).eq("restaurant_id", payload.restaurantId).maybeSingle();
    if (draftError) throw new Error(draftError.message);
    if (!draft) return response(404, { error: "Review Studio draft was not found." });
    if (draft.status !== "completed" || !draft.review_state) return response(409, { error: "Review Studio must be completed before publishing." });
    if (Number(draft.review_revision) !== Number(payload.expectedRevision)) return response(409, { error: "A newer Review Studio revision exists. Reload before publishing." });
    if (draft.publish_status === "publishing") return response(409, { error: "This menu is already publishing." });

    const state = draft.review_state as { items?: Array<Record<string, unknown>> };
    const publishedImages: Record<string, string> = {};
    for (const item of state.items ?? []) {
      if (item.deleted || item.hidden || item.rejected || !item.approved) continue;
      const imageDraft = item.imageDraft as { selectedVersionId?: string; versions?: Array<Record<string, unknown>> } | undefined;
      const selected = imageDraft?.versions?.find((version) => version.id === imageDraft.selectedVersionId);
      if (!selected || !["Approved", "Owner Upload"].includes(String(selected.status))) continue;
      const sourceUrl = typeof selected.imageUrl === "string" ? selected.imageUrl : "";
      const sourcePath = publicObjectPath(sourceUrl);
      if (!sourcePath) throw new Error(`Approved image for ${String(item.id)} is not a durable Review Studio asset.`);
      const { data: source, error: downloadError } = await service.storage.from(DRAFT_BUCKET).download(sourcePath);
      if (downloadError || !source) throw new Error(downloadError?.message || "Approved image could not be loaded.");
      const targetPath = `${payload.restaurantId}/ai-published/${payload.draftId}/${String(item.id)}/${String(selected.id)}.webp`;
      const { error: uploadError } = await service.storage.from(PRODUCTION_BUCKET).upload(targetPath, source, { contentType: source.type || "image/webp", upsert: false });
      if (uploadError && !uploadError.message.toLowerCase().includes("already exists")) throw new Error(uploadError.message);
      if (!uploadError) uploaded.push(targetPath);
      publishedImages[String(item.id)] = service.storage.from(PRODUCTION_BUCKET).getPublicUrl(targetPath).data.publicUrl;
    }

    const { data, error } = await userClient.rpc("publish_ai_menu_draft", {
      target_restaurant_id: payload.restaurantId,
      target_draft_id: payload.draftId,
      target_review_revision: payload.expectedRevision,
      published_images: publishedImages,
    });
    if (error) throw new Error(error.message);
    return response(200, { ...data, status: "published" });
  } catch (error) {
    if (uploaded.length) {
      try {
        const cleanup = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
        await cleanup.storage.from(PRODUCTION_BUCKET).remove(uploaded);
      } catch { /* best-effort rollback of newly copied objects */ }
    }
    return response(400, { error: error instanceof Error ? error.message : "Menu publishing failed." });
  }
});
