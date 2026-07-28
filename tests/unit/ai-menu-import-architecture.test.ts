import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const edge = read("supabase/functions/menu-ai-import/index.ts");
const contract = read("supabase/functions/menu-ai-import/contracts.ts");
const registry = read("supabase/functions/menu-ai-import/providers/registry.ts");
const service = read("src/modules/setup-wizard/services/menuExtractionService.ts");
const studio = read("src/modules/setup-wizard/components/AiMenuReviewStudio.tsx");
const upload = read("src/modules/setup-wizard/components/AiMenuUploadStep.tsx");
const migration = read("supabase/migrations/196_phase9_11_ai_menu_import_sources.sql");
const publish = read("supabase/functions/menu-publish/index.ts");

describe("Phase 9.11 AI Menu Import architecture", () => {
  it("uses one provider-neutral AI Menu Import entrypoint", () => {
    expect(service).toContain('"menu-ai-import"');
    expect(registry).toContain("MENU_AI_PROVIDER");
    expect(registry).toContain("getAiMenuProvider");
    expect(edge).toContain('mode === "starter" || mode === "manual"');
    expect(edge).toContain("provider.importMenu");
  });

  it("normalizes AI, starter, and manual sources into the same private draft table", () => {
    expect(edge.match(/from\("ai_menu_import_drafts"\)/g)?.length).toBeGreaterThan(2);
    expect(edge).toContain('source_kind: "upload"');
    expect(edge).toContain('source_kind: mode');
    expect(migration).toContain("source_kind in ('upload', 'starter', 'manual')");
    expect(migration).toContain("alter column source_draft_id drop not null");
    expect(edge).not.toMatch(/from\("(menu_items|categories|recipes|inventory_items)"\)/);
  });

  it("keeps the AI JSON contract narrow and validates safe fields", () => {
    for (const field of ["restaurantName", "categories", "items", "name", "description", "price", "currency", "confidence"]) {
      expect(contract).toContain(field);
    }
    for (const forbidden of ["preparationTime", "nutrition", "kitchenStation", "foodCost", "inventoryDeduction", "recipeId"]) {
      expect(contract).not.toContain(forbidden);
    }
    expect(contract).toContain("duplicateOf");
    expect(contract).toContain("Number.isFinite");
  });

  it("keeps failures private, retryable, and starter-capable", () => {
    expect(edge).toContain("We couldn't create your digital menu.");
    expect(edge).toContain('error_message: USER_FAILURE_MESSAGE');
    expect(edge).toContain("provider_request_failed");
    expect(edge).not.toMatch(/console\.(log|error)\([^)]*(apiKey|sourceBytes|structured_result)/);
    expect(studio).toContain("Retry AI Import");
    expect(studio).toContain("Use Smart Starter Menu");
    expect(studio).toContain("Cancel");
    expect(upload).toContain("createStarterMenuReviewDraft");
  });

  it("does not change the existing publishing engine", () => {
    expect(publish).toContain('.from("ai_menu_import_drafts")');
    expect(publish).toContain("publish_ai_menu_draft");
    expect(migration).not.toMatch(/alter table public\.(menu_items|categories|recipes|inventory_items)/);
  });
});
