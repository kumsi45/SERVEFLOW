import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/parked-migrations/owner_menu_item_creation_atomic_idempotent.PARKED.sql"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/modules/owner/services/ownerMenuItemCreation.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/modules/owner/pages/OwnerDashboardPage.tsx"), "utf8");

describe("Owner Menu Phase 3B atomic creation candidate", () => {
  it("uses a narrow owner-bound idempotency operation and canonical payload fingerprint", () => {
    expect(sql).toContain("create table public.menu_item_creation_operations");
    expect(sql).toContain("primary key (restaurant_id, request_id)");
    expect(sql).toContain("actor_user_id uuid not null");
    expect(sql).toContain("request_fingerprint text not null");
    expect(sql).toContain("extensions.digest(convert_to(normalized_payload::text, 'UTF8'), 'sha256')");
    expect(sql).toContain("existing.actor_user_id <> actor_id or existing.request_fingerprint <> fingerprint");
    expect(sql).toContain("jsonb_set(existing.result, '{replayed}', 'true'::jsonb, true)");
    expect(sql).toContain("pg_advisory_xact_lock");
  });

  it("resolves category, inventory, recipe, and station authority inside one database transaction", () => {
    expect(sql).toContain("hashtextextended(target_restaurant_id::text || ':menu-category:'");
    expect(sql).toContain("public.manage_recipe('create'");
    expect(sql).toContain("item.restaurant_id = target_restaurant_id");
    expect(sql).toContain("station.restaurant_id = target_restaurant_id");
    expect(sql).toContain("station.active = true");
    expect(sql).toContain("station.archived_at is null");
    expect(sql).not.toMatch(/unique\s*\([^)]*restaurant_id[^)]*name|unique\s*\([^)]*name[^)]*restaurant_id/i);
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("makes public photos deterministic, operation-scoped, and finalizable only after upload", () => {
    expect(sql).toContain("target_restaurant_id::text || '/' || saved.id::text || '/'");
    expect(sql).toContain("from storage.objects object");
    expect(sql).toContain("object.bucket_id = 'menu-photos'");
    expect(sql).toContain("operation.actor_user_id <> actor_id");
    expect(sql).toContain("target_object_path is distinct from operation.expected_photo_path");
    expect(sql).toContain("auth.jwt()->>'iss'");
    expect(sql).not.toContain("request.headers");
  });

  it("keeps one request ID through a retry and clears it only after a completed create", () => {
    expect(service).toContain("sessionStorage");
    expect(service).toContain("pending?.payload === serialized ? pending.requestId : createBrowserUuid()");
    expect(page).toContain("activeCreationRequestId.current = operation.requestId");
    expect(page).toContain("operation.complete()");
    expect(page).toContain("activeCreationRequestId.current = null");
    expect(page).toContain(".from(\"menu-photos\")");
    expect(page).toContain("finalizeOwnerMenuItemPhoto(");
  });
});
