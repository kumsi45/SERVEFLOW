import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/249_kitchen_material_request_expansion.sql", import.meta.url),
  "utf8",
);

const between = (start: string, end: string) => {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  return migration.slice(startIndex, endIndex === -1 ? undefined : endIndex);
};

describe("KMR1 Kitchen material request backend expansion", () => {
  it("adds one check-constrained canonical request type and factual legacy backfill", () => {
    expect(migration).toContain("add column if not exists request_type text");
    expect(migration).toContain("when inventory_item_id is null then 'other' else 'ingredient'");
    expect(migration).toContain("request_type in ('ingredient','supply','tool','cleaning','other')");
    expect(migration).toContain("request_type<>'ingredient' or inventory_item_id is not null");
  });

  it("keeps one create RPC with legacy inference and explicit material types", () => {
    const create = between(
      "create function public.create_kitchen_inventory_request(",
      "-- Manager review is generic.",
    );
    expect(create).toContain("target_request_type text default null");
    expect(create).toContain("case when target_inventory_item_id is null then 'other' else 'ingredient' end");
    expect(create).toContain("if normalized_type='ingredient' and target_inventory_item_id is null");
    expect(create).toContain("and item.restaurant_id=target_restaurant_id");
    expect(create).toContain("station.restaurant_id=target_restaurant_id");
    expect(create).toContain("security definer set search_path=public");
  });

  it("derives linked item facts and canonicalizes matching free-text units", () => {
    expect(migration).toContain("normalized_name:=catalog_name");
    expect(migration).toContain("normalized_unit:=catalog_unit");
    expect(migration).toContain("lower(btrim(inventory_unit.name))=lower(normalized_unit)");
    expect(migration).toContain("normalized_unit:=coalesce(canonical_free_text_unit,normalized_unit)");
  });

  it("records type, material, inventory link, quantity, unit, and station in creation history", () => {
    expect(migration).toContain("'request_type',normalized_type,'item_name',normalized_name");
    expect(migration).toContain("'inventory_item_id',target_inventory_item_id,'quantity',target_quantity");
    expect(migration).toContain("'unit',normalized_unit,'urgency',target_urgency,'station_id',target_station_id");
  });

  it("allows generic Manager approval without stock movement", () => {
    const review = between(
      "create or replace function public.process_kitchen_inventory_request(",
      "drop function if exists public.get_inventory_kitchen_request_queue(uuid);",
    );
    expect(review).toContain("role::text in ('manager','owner')");
    expect(review).not.toContain("record_inventory_movement");
    expect(review).not.toContain("Inventory link is required before approval.");
    expect(review).toContain("request.inventory_item_id is not null");
  });

  it("includes approved free-text materials in the existing Inventory queue", () => {
    const queue = between(
      "create function public.get_inventory_kitchen_request_queue(",
      "revoke all on function public.create_kitchen_inventory_request",
    );
    expect(queue).toContain("request_type text");
    expect(queue).toContain("left join public.inventory_items item");
    expect(queue).toContain("request.item_name");
    expect(queue).toContain("request.status='accepted'");
  });

  it("preserves least-privilege grants and does not replace RLS or realtime", () => {
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).toContain("to authenticated,service_role");
    expect(migration).not.toContain("disable row level security");
    expect(migration).not.toContain("using (true)");
    expect(migration).not.toContain("alter publication");
    expect(migration).not.toContain("create table");
  });

  it("does not create a parallel lifecycle or a free-text stock path", () => {
    expect(migration).not.toContain("record_inventory_movement");
    expect(migration).not.toContain("create type");
    expect(migration).not.toContain("requires_purchase");
    expect(migration).not.toContain("non_stock_issued");
  });
});
