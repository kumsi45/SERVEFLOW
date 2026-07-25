import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Inventory initialization flag foundation", () => {
  const sql = read("supabase/migrations/170_inventory_initialization_flag.sql");

  it("adds persistent restaurant-scoped initialization fields with a false default", () => {
    expect(sql).toContain("alter table public.restaurants");
    expect(sql).toContain("inventory_initialized boolean not null default false");
    expect(sql).toContain("inventory_initialized_at timestamptz");
    expect(sql).toContain("inventory_template text");
  });

  it("requires completion state and timestamp to change together", () => {
    expect(sql).toContain("restaurants_inventory_initialization_state_consistent");
    expect(sql).toContain("inventory_initialized = false and inventory_initialized_at is null");
    expect(sql).toContain("inventory_initialized = true and inventory_initialized_at is not null");
  });

  it("does not implement the initialization engine or touch domain tables", () => {
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(sql).not.toMatch(/insert\s+into/i);
    expect(sql).not.toMatch(/update\s+public\./i);
    expect(sql).not.toMatch(/inventory_(units|categories|storage_locations|items|movements)|recipes|orders|kitchen/i);
  });
});

