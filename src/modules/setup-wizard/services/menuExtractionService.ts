import { supabase } from "../../../core/database";
import type {
  MenuExtractionDraft,
  MenuExtractionResult,
  MenuExtractionStatus,
} from "./menuExtractionTypes";
import type {
  MenuReviewAccess,
  MenuReviewState,
} from "./menuReviewTypes";
import { upgradeMenuReviewState } from "./menuReviewState";

type MenuExtractionRow = {
  id: string;
  restaurant_id: string;
  source_draft_id: string;
  source_updated_at: string;
  provider: string;
  model: string;
  status: MenuExtractionStatus;
  structured_result: MenuExtractionResult | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  review_state: MenuReviewState | null;
  review_revision: number;
  review_updated_at: string | null;
};

function mapExtraction(row: MenuExtractionRow): MenuExtractionDraft {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    sourceDraftId: row.source_draft_id,
    sourceUpdatedAt: row.source_updated_at,
    provider: row.provider,
    model: row.model,
    status: row.status,
    result: row.structured_result,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    reviewState: row.review_state
      ? upgradeMenuReviewState(row.review_state)
      : null,
    reviewRevision: Number(row.review_revision),
    reviewUpdatedAt: row.review_updated_at,
  };
}

const extractionColumns =
  "id,restaurant_id,source_draft_id,source_updated_at,provider,model,status,structured_result,error_message,started_at,completed_at,updated_at,review_state,review_revision,review_updated_at";

async function readFunctionError(error: unknown) {
  const context = (error as { context?: Response })?.context;
  if (context) {
    try {
      const payload = await context.clone().json() as { error?: string };
      if (payload.error) return payload.error;
    } catch {
      // Use the standard function error below when no JSON body is available.
    }
  }
  return error instanceof Error ? error.message : "The request failed.";
}

export async function listMenuExtractionDrafts(restaurantId: string) {
  const { data, error } = await supabase
    .from("ai_menu_import_drafts")
    .select(extractionColumns)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MenuExtractionRow[]).map(mapExtraction);
}

export async function extractMenuImportDraft(draftId: string) {
  const { data, error } = await supabase.functions.invoke(
    "menu-ocr-extract",
    { body: { draftId } },
  );
  if (error) {
    throw new Error(await readFunctionError(error));
  }
  if (!data || typeof data !== "object" || !("extraction" in data)) {
    throw new Error("The extraction service returned an invalid response.");
  }
  return mapExtraction(
    (data as { extraction: MenuExtractionRow }).extraction,
  );
}

export async function getMenuReviewAccess(
  restaurantId: string,
): Promise<MenuReviewAccess> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("Sign in again to review this import draft.");
  }
  const { data, error } = await supabase
    .from("restaurant_staff")
    .select("role")
    .eq("restaurant_id", restaurantId)
    .eq("user_id", authData.user.id)
    .eq("active", true)
    .in("role", ["owner", "manager"])
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.role === "owner" || data?.role === "manager") return data.role;
  throw new Error("You do not have access to AI menu review drafts.");
}

export async function saveMenuReviewDraft(
  extractionId: string,
  expectedRevision: number,
  reviewState: MenuReviewState,
) {
  const { data, error } = await supabase.functions.invoke(
    "menu-review-draft",
    {
      body: {
        extractionId,
        expectedRevision,
        reviewState,
      },
    },
  );
  if (error) throw new Error(await readFunctionError(error));
  if (!data || typeof data !== "object" || !("extraction" in data)) {
    throw new Error("The review service returned an invalid response.");
  }
  return mapExtraction(
    (data as { extraction: MenuExtractionRow }).extraction,
  );
}
