import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration264 = readFileSync(resolve(process.cwd(), "supabase/migrations/264_kitchen_station_unresolved_routing_obligation_safety.sql"), "utf8");
const migration265 = readFileSync(resolve(process.cwd(), "supabase/migrations/265_explicit_kitchen_station_disable_no_foundation_side_effect.sql"), "utf8");
const foundation = readFileSync(resolve(process.cwd(), "supabase/migrations/041_kitchen_station_foundation.sql"), "utf8");
const ownerPage = readFileSync(resolve(process.cwd(), "src/modules/owner/pages/OwnerDashboardPage.tsx"), "utf8");

describe("Kitchen station K1.8 explicit Disable foundation separation", () => {
  it("does not ensure or create a default station before explicit Disable", () => {
    expect(migration265).toContain("if normalized_action <> 'disable' then");
    expect(migration265).toContain("perform public.ensure_default_kitchen_station(target_restaurant_id);");
    const disableBranch = migration265.slice(migration265.indexOf("elsif normalized_action in ('disable', 'enable')"));
    expect(disableBranch).not.toContain("ensure_default_kitchen_station");
  });

  it("keeps Migration 264 as the only Disable safety authority", () => {
    expect(migration265).not.toContain("LAST_ACTIVE_KITCHEN_STATION");
    expect(migration265).not.toContain("KITCHEN_STATION_HAS_UNRESOLVED_WORK");
    expect(migration264).toContain("LAST_ACTIVE_KITCHEN_STATION");
    expect(migration264).toContain("KITCHEN_STATION_HAS_UNRESOLVED_WORK");
    expect(migration264).toContain("kitchen_station_lifecycle");
  });

  it("preserves legitimate foundation creation outside explicit Disable", () => {
    expect(foundation).toContain("create or replace function public.get_owner_kitchen_stations");
    expect(foundation).toContain("perform public.ensure_default_kitchen_station(target_restaurant_id);");
    expect(migration265).toContain("if normalized_action <> 'disable' then");
  });

  it("preserves the existing Owner business-error mapping", () => {
    expect(ownerPage).toContain("At least one kitchen station must remain active.");
  });
});
