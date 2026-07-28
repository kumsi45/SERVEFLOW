import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studio = readFileSync("src/modules/setup-wizard/components/AiMenuReviewStudio.tsx", "utf8");
const preview = readFileSync("src/modules/setup-wizard/components/AiMenuFinalPreview.tsx", "utf8");
const service = readFileSync("src/modules/setup-wizard/services/menuPublishService.ts", "utf8");
const migration = readFileSync("supabase/migrations/193_phase9_8_6_ai_menu_publish_engine.sql", "utf8");
const restoreMigration = readFileSync("supabase/migrations/194_phase9_8_6_publish_draft_restore.sql", "utf8");
const edge = readFileSync("supabase/functions/menu-publish/index.ts", "utf8");

describe("Phase 9.8.6 AI menu publish engine", () => {
  it("reuses the production theme and food renderers for preview", () => {
    expect(preview).toContain("<ThemeProvider");
    expect(preview).toContain("<ThemeRenderer");
    expect(preview).toContain("<ModernFoodView");
    expect(preview).toContain('type Device = "desktop" | "tablet" | "mobile"');
    expect(preview).toContain('type Orientation = "portrait" | "landscape"');
    expect(preview).toContain("MENU_LANGUAGE_OPTIONS");
    expect(preview).toContain("MENU_THEMES");
  });

  it("publishes only through the owner-authenticated Edge Function", () => {
    expect(service).toContain('supabase.functions.invoke("menu-publish"');
    expect(edge).toContain('.eq("role", "owner")');
    expect(edge).toContain('userClient.rpc("publish_ai_menu_draft"');
    expect(edge).not.toContain("structured_result");
  });

  it("copies only approved durable images to production storage", () => {
    expect(edge).toContain('["Approved", "Owner Upload"]');
    expect(edge).toContain('const PRODUCTION_BUCKET = "menu-photos"');
    expect(edge).toContain("Approved image for");
    expect(edge).toContain("await cleanup.storage.from(PRODUCTION_BUCKET).remove(uploaded)");
  });

  it("locks and validates the exact Review Studio revision transactionally", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("for update");
    expect(migration).toContain("draft.review_revision <> target_review_revision");
    expect(migration).toContain("Approve every active Review Studio item before publishing.");
    expect(migration).toContain("Only approved image versions may be published.");
  });

  it("publishes categories, menu items, localizations and mappings without duplicate inserts", () => {
    expect(migration).toContain("ai_menu_publish_category_links");
    expect(migration).toContain("ai_menu_publish_item_links");
    expect(migration).toContain("lower(btrim(existing.name))");
    expect(migration).toContain("menu_category_localizations");
    expect(migration).toContain("menu_item_localizations");
    expect(migration).toContain("name_owner_edited");
  });

  it("records versioned history, progress, success and retry-safe failures", () => {
    expect(migration).toContain("ai_menu_publish_versions");
    expect(migration).toContain("published_by");
    expect(restoreMigration).toContain("restore_ai_menu_publish_version");
    expect(studio).toContain('const stages = ["Preparing", "Categories", "Menu Items", "Images", "Translations", "Finalizing"]');
    expect(studio).toContain("Menu Published Successfully");
    expect(studio).toContain("Publish History");
    expect(studio).toContain("Restore Previous Draft");
    expect(studio).toContain("onPublish={() => void publishReviewedMenu()}");
  });
});
