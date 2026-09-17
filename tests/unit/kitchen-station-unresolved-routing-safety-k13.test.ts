import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/264_kitchen_station_unresolved_routing_obligation_safety.sql"), "utf8");
const ownerPage = readFileSync(resolve(process.cwd(), "src/modules/owner/pages/OwnerDashboardPage.tsx"), "utf8");

describe("Kitchen station unresolved routing obligation safety K1.3", () => {
  it("keeps held, actionable, preparing, and ready frozen work as disable obligations", () => {
    expect(migration).toContain("kitchen_status not in ('completed', 'cancelled')");
    expect(migration).toContain("KITCHEN_STATION_HAS_UNRESOLVED_WORK");
  });

  it("excludes only canonical completed and cancelled terminal item states", () => {
    expect(migration).toContain("where kitchen_station_id is not null\n  and kitchen_status not in ('completed', 'cancelled')");
    expect(migration).toContain("and items.kitchen_status not in ('completed', 'cancelled')");
  });

  it("guards every active-to-inactive mutation and preserves one active station", () => {
    expect(migration).toContain("before update of active on public.kitchen_stations");
    expect(migration).toContain("LAST_ACTIVE_KITCHEN_STATION");
  });

  it("coordinates canonical routing with disable using the same tenant-station advisory lock", () => {
    const routeStart = migration.indexOf("create or replace function public.resolve_kitchen_station_route");
    const disableStart = migration.indexOf("create or replace function public.enforce_kitchen_station_disable_obligations");
    const route = migration.slice(routeStart, disableStart);
    const disable = migration.slice(disableStart);
    expect(route).toContain("pg_advisory_xact_lock(\n      hashtext(target_restaurant_id::text),");
    expect(disable).toContain("pg_advisory_xact_lock(\n      hashtext(old.restaurant_id::text),\n      hashtext(old.id::text)");
    expect(disable).toContain("hashtext('kitchen_station_lifecycle')");
  });

  it("keeps routing centralized in the universal order-item trigger", () => {
    const routing = readFileSync(resolve(process.cwd(), "supabase/migrations/166_kitchen_station_routing_engine_fix.sql"), "utf8");
    expect(routing).toContain("before insert or update of restaurant_id, menu_item_id\non public.order_items");
    expect(routing).toContain("public.resolve_kitchen_station_route");
  });

  it("maps both server business errors without redesigning the owner kitchen UI", () => {
    expect(ownerPage).toContain("Station still has orders assigned to it. Complete or resolve them before disabling this station.");
    expect(ownerPage).toContain("At least one kitchen station must remain active.");
  });
});
