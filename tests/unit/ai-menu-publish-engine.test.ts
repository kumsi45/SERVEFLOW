import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studio = readFileSync("src/modules/setup-wizard/components/AiMenuReviewStudio.tsx", "utf8");
const preview = readFileSync("src/modules/setup-wizard/components/AiMenuFinalPreview.tsx", "utf8");
const service = readFileSync("src/modules/setup-wizard/services/menuPublishService.ts", "utf8");
const migration = readFileSync("supabase/migrations/193_phase9_8_6_ai_menu_publish_engine.sql", "utf8");
const restoreMigration = readFileSync("supabase/migrations/194_phase9_8_6_publish_draft_restore.sql", "utf8");
const publishStabilityMigration = readFileSync("supabase/migrations/195_production_publish_variable_conflict_fix.sql", "utf8");
const edge = readFileSync("supabase/functions/menu-publish/index.ts", "utf8");
const setup = readFileSync("src/modules/setup-wizard/pages/RestaurantSetupWizardPage.tsx", "utf8");
const ownerAsset = readFileSync("src/modules/setup-wizard/services/ownerImageAsset.ts", "utf8");

describe("Phase 9.8.6 AI menu publish engine", () => {
  it("reuses the production theme and food renderers for preview", () => {
    expect(preview).toContain("<ThemeProvider");
    expect(preview).toContain("<ThemeRenderer");
    expect(preview).toContain("<ModernFoodView");
    expect(preview).toContain('type Device = "desktop" | "tablet" | "mobile"');
    expect(preview).toContain('type Orientation = "portrait" | "landscape"');
    expect(preview).toContain("MENU_LANGUAGE_OPTIONS");
    expect(preview).toContain("MENU_THEMES");
    expect(preview).toContain("PublicQrCartPanel");
    expect(preview).toContain("FoodInfoPanel");
    expect(preview).toContain("Ready to publish");
    expect(preview).toContain("Menu languages");
    expect(preview).toContain("Refresh Preview");
    expect(preview).toContain('placeholderUrl: SERVEFLOW_MENU_PLACEHOLDER_IMAGE }, "owner-review")');
  });

  it("publishes only through the owner-authenticated Edge Function", () => {
    expect(service).toContain('supabase.functions.invoke("menu-publish"');
    expect(edge).toContain('.eq("role", "owner")');
    expect(edge).toContain('userClient.rpc("publish_ai_menu_draft"');
    expect(edge).not.toContain("structured_result");
  });

  it("publishes approved assets without coupling validation to their source bucket", () => {
    expect(edge).toContain('["approved", "owner upload"]');
    expect(edge).toContain('const PRODUCTION_BUCKET = "menu-photos"');
    expect(edge).toContain('const SMART_LIBRARY_BUCKET = "smart-menu-images"');
    expect(edge).toContain("DURABLE_BUCKETS");
    expect(edge).toContain("temporary or unavailable");
    expect(edge).toContain("sourceObject.bucket !== DRAFT_BUCKET");
    expect(edge).toContain("await cleanup.storage.from(PRODUCTION_BUCKET).remove(uploaded)");
  });

  it("optimizes new owner uploads into immutable responsive WebP assets", () => {
    expect(ownerAsset).toContain("[320, 512, 1024, 2048]");
    expect(ownerAsset).toContain('imageOrientation: "from-image"');
    expect(ownerAsset).toContain('"image/webp"');
    expect(studio).toContain('cacheControl: "31536000, immutable"');
    expect(studio).toContain('providerKey: "owner-upload"');
    expect(studio).not.toContain('from("menu-photos").upload(path, entry.file');
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
    expect(studio).toContain('setPublishStage("Publishing")');
    expect(studio).not.toContain("window.setInterval");
    expect(studio).toContain("Approved content is being committed safely");
    expect(studio).toContain("Your Restaurant Is Live");
    expect(studio).toContain("Download QR");
    expect(studio).toContain("Print QR");
    expect(studio).toContain("Share Menu");
    expect(studio).toContain("finishPublishedSetup");
    expect(studio).toContain("Publish History");
    expect(studio).toContain("Restore Previous Draft");
    expect(studio).toContain("onReturn={onBack ?? (() => setPreviewOpen(false))}");
    expect(studio).toContain("onPublish={(theme) => void publishReviewedMenu(theme)}");
    expect(studio).toContain("persistMenuPreviewTheme");
  });

  it("finishes onboarding through the existing setup RPC after confirmed publish", () => {
    expect(setup).toContain('title: "Preview & Publish"');
    expect(setup).toContain('mode="preview"');
    expect(setup).toContain("onFinishSetup={completeSetup}");
    expect(setup).toContain('supabase.rpc("complete_restaurant_setup"');
    expect(studio).toContain("await onFinishSetup()");
  });

  it("keeps publish variables distinct from SQL column names", () => {
    for (const source of [migration, publishStabilityMigration]) {
      expect(source).toContain("target_category_id uuid");
      expect(source).toContain("target_menu_item_id uuid");
      expect(source).toContain("target_image_url text");
      expect(source).not.toMatch(/^\s*(category_id|menu_item_id|image_url)\s+(uuid|text);/m);
    }
  });
});
