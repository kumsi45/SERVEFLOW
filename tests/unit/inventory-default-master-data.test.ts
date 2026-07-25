import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureInventoryDefaultMasterData } from "../../src/modules/inventory/services/inventoryRepository";

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../../src/core/database", () => ({
  supabase: supabaseMock,
}));

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function exportedFunction(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}`);
  const next = source.indexOf("\nexport async function ", start + 1);
  if (start < 0) throw new Error(`Function ${name} was not found.`);
  return source.slice(start, next < 0 ? source.length : next);
}

function sqlFunction(source: string, name: string, signature = "(target_restaurant_id uuid)") {
  const start = source.indexOf(`create or replace function public.${name}${signature}`);
  const end = source.indexOf("$$;", start);
  if (start < 0 || end < 0) throw new Error(`SQL function ${name}${signature} was not found.`);
  return source.slice(start, end + "$$;".length);
}

function mockRestaurantInitialized(initialized: boolean) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { inventory_initialized: initialized },
      error: null,
    }),
  };
  supabaseMock.from.mockReturnValue(query);
  return query;
}

describe("Phase 8.2.8 inventory default master data architecture", () => {
  const repository = read("src/modules/inventory/services/inventoryRepository.ts");
  const sql = read("supabase/migrations/175_inventory_default_master_data_seed.sql");

  beforeEach(() => {
    supabaseMock.from.mockReset();
    supabaseMock.rpc.mockReset();
  });

  it("performs no write RPC when inventory is already initialized", async () => {
    mockRestaurantInitialized(true);

    await ensureInventoryDefaultMasterData("restaurant-a");

    expect(supabaseMock.from).toHaveBeenCalledWith("restaurants");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("initializes an uninitialized restaurant without automatic repair", async () => {
    mockRestaurantInitialized(false);
    supabaseMock.rpc.mockResolvedValue({ data: { initialized: true }, error: null });

    await ensureInventoryDefaultMasterData("restaurant-a");

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("initialize_inventory", {
      target_restaurant_id: "restaurant-a",
    });
  });

  it("gates repository initialization on the persistent restaurant flag", () => {
    const ensure = exportedFunction(repository, "ensureInventoryDefaultMasterData");

    expect(ensure).toContain('.from("restaurants")');
    expect(ensure).toContain('.select("inventory_initialized")');
    expect(ensure).toContain('if ((state.data as Row | null)?.inventory_initialized === true) return;');
    expect(ensure).toContain('supabase.rpc("initialize_inventory"');
    expect(ensure).not.toContain("repair_inventory_defaults");
    expect(ensure.indexOf('.select("inventory_initialized")')).toBeLessThan(
      ensure.indexOf('supabase.rpc("initialize_inventory"'),
    );
  });

  it("keeps repair as a manual owner or manager operation", () => {
    const ensure = exportedFunction(repository, "ensureInventoryDefaultMasterData");
    const repair = sqlFunction(sql, "repair_inventory_defaults");

    expect(ensure).not.toContain("repair_inventory_defaults");
    expect(repair).toContain("public.has_staff_role(");
    expect(repair).toContain("array['owner','manager']::public.restaurant_staff_role[]");
    expect(repair).not.toContain("inventory_admin_has_access");
  });

  it("returns from initialize_inventory before seeding initialized restaurants", () => {
    const initialize = sqlFunction(sql, "initialize_inventory");
    const guardIndex = initialize.indexOf("if restaurant_row.inventory_initialized = true then");
    const seedIndex = initialize.indexOf("seed_result := public.seed_inventory_default_master_data");

    expect(guardIndex).toBeGreaterThan(-1);
    expect(seedIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(seedIndex);
    expect(initialize).toContain("'already_initialized', true");
    expect(initialize).toContain("inventory_initialized = true");
    expect(initialize).toContain("inventory_initialized_at = now()");
  });

  it("uses one canonical seed function for initialize and repair", () => {
    const seed = sqlFunction(sql, "seed_inventory_default_master_data");
    const initialize = sqlFunction(sql, "initialize_inventory");
    const repair = sqlFunction(sql, "repair_inventory_defaults");

    expect(seed).toContain("insert into public.inventory_categories");
    expect(seed).toContain("insert into public.inventory_units");
    expect(seed).toContain("insert into public.inventory_storage_locations");
    expect(initialize).toContain("public.seed_inventory_default_master_data(target_restaurant_id)");
    expect(repair).toContain("public.seed_inventory_default_master_data(target_restaurant_id)");
    expect(initialize).not.toContain("insert into public.inventory_categories");
    expect(repair).not.toContain("insert into public.inventory_categories");
  });
});
