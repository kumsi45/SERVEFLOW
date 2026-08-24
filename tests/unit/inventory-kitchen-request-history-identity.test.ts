import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration=readFileSync(new URL("../../supabase/migrations/250_inventory_kitchen_request_identity_context.sql",import.meta.url),"utf8");
const service=readFileSync(new URL("../../src/modules/inventory/services/inventoryKitchenRequestService.ts",import.meta.url),"utf8");
const dashboard=readFileSync(new URL("../../src/modules/inventory/components/InventoryOperationalDashboard.tsx",import.meta.url),"utf8");

describe("Inventory Kitchen request History identity",()=>{
  it("resolves station and Chef names through a narrow same-tenant RPC",()=>{
    expect(migration).toContain("get_inventory_kitchen_request_context");
    expect(migration).toContain("request.restaurant_id=target_restaurant_id");
    expect(migration).toContain("station.restaurant_id=request.restaurant_id");
    expect(migration).toContain("requester.restaurant_id=request.restaurant_id");
    expect(service).toContain('rpc("get_inventory_kitchen_request_context"');
    expect(service).toContain("stationName: authoritativeContext?.station_name");
    expect(service).toContain("requesterName: authoritativeContext?.requested_by_name");
  });

  it("keeps Inventory visibility least-privilege",()=>{
    expect(migration).toContain("staff.user_id=auth.uid()");
    expect(migration).toContain("staff.active=true");
    expect(migration).toContain("request.status in ('accepted','issued','unable_to_fulfill','delivered')");
    expect(migration).toContain("security definer set search_path=public");
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).not.toContain("using (true)");
    expect(migration).not.toContain("alter policy");
  });

  it("shows honest labels instead of generic Kitchen and Chef fallbacks",()=>{
    expect(dashboard).toContain('request.stationName ?? "Kitchen / station not recorded"');
    expect(dashboard).toContain("request.requesterName && <span>Requested by {request.requesterName}</span>");
    expect(dashboard).not.toContain("Name not recorded");
    expect(dashboard).not.toContain('request.stationName ?? "Kitchen"');
    expect(dashboard).not.toContain('request.requesterName ?? "Chef"');
  });
});
