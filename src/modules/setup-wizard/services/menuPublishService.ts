import { supabase } from "../../../core/database";
import type { MenuTheme } from "../../menu/theme-engine/ThemeTypes";

export type MenuPublishSummary = {
  publishedVersion: number;
  categoriesPublished: number;
  itemsPublished: number;
  imagesPublished: number;
  languagesPublished: number;
  skippedItems: number;
  warnings: string[];
};

export type MenuPublishHistoryEntry = MenuPublishSummary & {
  id: string;
  reviewRevision: number;
  publishedAt: string;
  publishedBy: string | null;
  publishedRole: string;
};

export type MenuPreviewRestaurant = {
  id: string;
  name: string;
  slug: string;
  menu_theme: "modern" | "luxury" | "premium_grid" | "coffee" | null;
  logo_url: string | null;
  cover_url: string | null;
  ordering_settings: Record<string, unknown> | null;
  currency_code: string | null;
  currency_symbol: string | null;
  locale: string | null;
};

export async function loadMenuPreviewRestaurant(restaurantId: string): Promise<MenuPreviewRestaurant> {
  const { data, error } = await supabase.from("restaurants").select("id,name,slug,menu_theme,branding,ordering_settings,currency_code,currency_symbol,locale").eq("id", restaurantId).single();
  if (error || !data) throw new Error(error?.message || "Restaurant preview is unavailable.");
  const branding = data.branding && typeof data.branding === "object" ? data.branding as Record<string, unknown> : {};
  return { id: data.id, name: data.name, slug: data.slug, menu_theme: data.menu_theme, logo_url: typeof branding.logo_url === "string" ? branding.logo_url : null, cover_url: typeof branding.cover_url === "string" ? branding.cover_url : null, ordering_settings: data.ordering_settings, currency_code: data.currency_code, currency_symbol: data.currency_symbol, locale: data.locale };
}

export async function publishMenuDraft(restaurantId: string, draftId: string, expectedRevision: number): Promise<MenuPublishSummary> {
  const { data, error } = await supabase.functions.invoke("menu-publish", { body: { restaurantId, draftId, expectedRevision } });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const payload = await context.clone().json() as { error?: unknown };
        if (typeof payload.error === "string" && payload.error.trim()) message = payload.error;
      } catch { /* Keep the SDK fallback when the response is not JSON. */ }
    }
    throw new Error(message);
  }
  const payload = data as MenuPublishSummary & { error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload;
}

export async function persistMenuPreviewTheme(restaurantId: string, theme: MenuTheme) {
  const { error } = await supabase.from("restaurants").update({ menu_theme: theme }).eq("id", restaurantId);
  if (error) throw new Error(error.message);
}

export async function loadMenuPublishHistory(restaurantId: string, draftId: string): Promise<MenuPublishHistoryEntry[]> {
  const { data, error } = await supabase.rpc("get_ai_menu_publish_history", { target_restaurant_id: restaurantId, target_draft_id: draftId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), reviewRevision: Number(row.review_revision), publishedVersion: Number(row.published_version),
    categoriesPublished: Number(row.categories_published), itemsPublished: Number(row.items_published), imagesPublished: Number(row.images_published),
    languagesPublished: Number(row.languages_published), skippedItems: Number(row.skipped_items), warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    publishedAt: String(row.published_at), publishedBy: typeof row.published_by === "string" ? row.published_by : null, publishedRole: String(row.published_role),
  }));
}

export async function restoreMenuPublishVersion(restaurantId: string, draftId: string, versionId: string) {
  const { data, error } = await supabase.rpc("restore_ai_menu_publish_version", { target_restaurant_id: restaurantId, target_draft_id: draftId, target_version_id: versionId });
  if (error) throw new Error(error.message);
  return Number(data);
}
