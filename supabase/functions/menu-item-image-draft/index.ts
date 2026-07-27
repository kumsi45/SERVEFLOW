import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildImageGenerationPrompt,
  type ImageDraftVersion,
  type RestaurantProfile,
  type ReviewItem,
  type ReviewState,
} from "./contracts.ts";
import { getImageGenerationProvider } from "./providers/registry.ts";

type ImageDraftRequest = {
  extractionId?: unknown;
  itemId?: unknown;
  expectedRevision?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const BUCKET = "menu-item-image-drafts";
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
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requireItemId(value: unknown) {
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) {
    throw new Error("Item ID is invalid.");
  }
  return value;
}

function requireRevision(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("A valid expected revision is required.");
  }
  return Number(value);
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : "Image generation failed.";
  return message.slice(0, 1000);
}

function assertReviewState(value: unknown): ReviewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Review state is required before generating images.");
  }
  const state = value as ReviewState;
  if (state.schemaVersion !== 2 || !Array.isArray(state.items)) {
    throw new Error("Review state is invalid.");
  }
  return state;
}

function assertEligibleItem(item: ReviewItem | undefined) {
  if (!item) throw new Error("Review item was not found.");
  if (!item.approved || item.deleted || item.hidden || item.rejected) {
    throw new Error("Only approved Review Studio draft items can generate images.");
  }
  const selectedVersion = item.imageDraft.versions.find((version) =>
    version.id === item.imageDraft.selectedVersionId
  );
  if (
    item.imageDraft.status === "Approved" ||
    selectedVersion?.status === "Approved"
  ) {
    throw new Error("Approved image versions are locked and cannot be overwritten.");
  }
  return item;
}

function nextVersion(item: ReviewItem) {
  return Math.max(0, ...item.imageDraft.versions.map((entry) =>
    Number.isInteger(entry.version) ? entry.version : 0
  )) + 1;
}

function updateItemVersion(
  state: ReviewState,
  itemId: string,
  version: ImageDraftVersion,
  status: ReviewItem["imageDraft"]["status"],
  generationProgress: number,
  errorMessage: string | null,
) {
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === itemId
        ? {
          ...item,
          imageDraft: {
            ...item.imageDraft,
            status,
            selectedVersionId: version.imageUrl
              ? version.id
              : item.imageDraft.selectedVersionId,
            versions: [...item.imageDraft.versions, version],
            lastPrompt: version.prompt || item.imageDraft.lastPrompt,
            generationProgress,
            errorMessage,
          },
        }
        : item
    ),
  };
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
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse(401, { error: "Authentication required." });
    }

    const payload = await request.json() as ImageDraftRequest;
    const extractionId = requireUuid(payload.extractionId, "Extraction ID");
    const itemId = requireItemId(payload.itemId);
    const expectedRevision = requireRevision(payload.expectedRevision);

    const { data: draft, error: draftError } = await serviceClient
      .from("ai_menu_import_drafts")
      .select("id,restaurant_id,status,review_state,review_revision")
      .eq("id", extractionId)
      .limit(1)
      .maybeSingle();
    if (draftError) throw new Error(draftError.message);
    if (!draft) {
      return jsonResponse(404, { error: "AI import draft was not found." });
    }
    if (draft.status !== "completed") {
      return jsonResponse(409, {
        error: "Extraction must complete before image generation.",
      });
    }
    if (Number(draft.review_revision) !== expectedRevision) {
      return jsonResponse(409, {
        error: "This draft changed in another session. Reload before generating images.",
      });
    }

    const { data: staffMembership, error: staffError } = await serviceClient
      .from("restaurant_staff")
      .select("id,role")
      .eq("restaurant_id", draft.restaurant_id)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "manager"])
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (staffError) throw new Error(staffError.message);
    if (!staffMembership) {
      return jsonResponse(403, { error: "Owner or manager access is required." });
    }

    const reviewState = assertReviewState(draft.review_state);
    const item = assertEligibleItem(
      reviewState.items.find((entry) => entry.id === itemId),
    );
    const versionNumber = nextVersion(item);

    const { data: restaurant } = await serviceClient
      .from("restaurants")
      .select("name,profile")
      .eq("id", draft.restaurant_id)
      .limit(1)
      .maybeSingle();
    if (!restaurant) {
      return jsonResponse(404, { error: "Restaurant was not found." });
    }
    const profile = restaurant?.profile && typeof restaurant.profile === "object"
      ? restaurant.profile as Record<string, unknown>
      : {};
    const restaurantProfile: RestaurantProfile = {
      name: typeof restaurant?.name === "string" ? restaurant.name : null,
      restaurantType: typeof profile.restaurant_type === "string"
        ? profile.restaurant_type
        : null,
      cuisine: typeof profile.cuisine === "string" ? profile.cuisine : null,
      description: typeof profile.description === "string"
        ? profile.description
        : null,
      style: typeof profile.style === "string"
        ? profile.style
        : typeof profile.restaurant_style === "string"
        ? profile.restaurant_style
        : null,
      nameLocalization: reviewState.restaurantNameLocalization ?? null,
    };

    const provider = getImageGenerationProvider();
    const prompt = buildImageGenerationPrompt(
      item,
      reviewState.categories,
      restaurantProfile,
    );

    try {
      const generated = await provider.generate(prompt);
      const now = new Date().toISOString();
      const versionId = crypto.randomUUID();
      const objectPath = [
        draft.restaurant_id,
        "ai-menu",
        extractionId,
        itemId,
        `version-${versionNumber}.webp`,
      ].join("/");
      const { error: uploadError } = await serviceClient.storage
        .from(BUCKET)
        .upload(objectPath, generated.bytes, {
          contentType: "image/webp",
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);

      const { data: publicUrlData } = serviceClient.storage
        .from(BUCKET)
        .getPublicUrl(objectPath);
      const imageUrl = publicUrlData.publicUrl;
      const version: ImageDraftVersion = {
        id: versionId,
        version: versionNumber,
        status: "Ready",
        source: "ai",
        imageUrl,
        thumbnailUrl: imageUrl,
        prompt: prompt.prompt,
        createdAt: now,
        errorMessage: null,
        crop: null,
      };
      const nextState = updateItemVersion(
        reviewState,
        itemId,
        version,
        "Ready",
        1,
        null,
      );
      const { data: savedDraft, error: saveError } = await serviceClient
        .from("ai_menu_import_drafts")
        .update({
          review_state: nextState,
          review_revision: expectedRevision + 1,
          review_updated_by: userData.user.id,
          review_updated_at: now,
        })
        .eq("id", extractionId)
        .eq("review_revision", expectedRevision)
        .select("id,review_revision,review_state")
        .maybeSingle();
      if (saveError) throw new Error(saveError.message);
      if (!savedDraft) {
        await serviceClient.storage.from(BUCKET).remove([objectPath]).catch(() =>
          undefined
        );
        return jsonResponse(409, {
          error: "This draft changed in another session. Reload before generating images.",
        });
      }
      return jsonResponse(200, {
        version,
        imageUrl,
        thumbnailUrl: imageUrl,
        generationProgress: 1,
        reviewRevision: savedDraft.review_revision,
        provider: provider.name,
        model: provider.model,
      });
    } catch (generationError) {
      const errorMessage = safeErrorMessage(generationError);
      const failedVersion: ImageDraftVersion = {
        id: crypto.randomUUID(),
        version: versionNumber,
        status: "Rejected",
        source: "ai",
        imageUrl: null,
        thumbnailUrl: null,
        prompt: prompt.prompt,
        createdAt: new Date().toISOString(),
        errorMessage,
        crop: null,
      };
      const restoredStatus = item.imageDraft.versions.length ? "Ready" : "Pending";
      const failedState = updateItemVersion(
        reviewState,
        itemId,
        failedVersion,
        restoredStatus,
        item.imageDraft.versions.length ? 1 : 0,
        errorMessage,
      );
      await serviceClient
        .from("ai_menu_import_drafts")
        .update({
          review_state: failedState,
          review_revision: expectedRevision + 1,
          review_updated_by: userData.user.id,
          review_updated_at: new Date().toISOString(),
        })
        .eq("id", extractionId)
        .eq("review_revision", expectedRevision);
      return jsonResponse(200, {
        version: failedVersion,
        generationProgress: restoredStatus === "Ready" ? 1 : 0,
        error: errorMessage,
        reviewRevision: expectedRevision + 1,
        provider: provider.name,
        model: provider.model,
      });
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    const configurationError =
      /OPENAI_API_KEY|MENU_IMAGE_PROVIDER|SUPABASE_/.test(message);
    return jsonResponse(configurationError ? 503 : 400, { error: message });
  }
});
