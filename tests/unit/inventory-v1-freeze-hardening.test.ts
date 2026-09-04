import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const migration = read("supabase/migrations/253_inventory_operation_concurrency_idempotency.sql");
const seedHardening = read("supabase/migrations/254_inventory_internal_seed_execution_hardening.sql");
const repository = read("src/modules/inventory/services/inventoryStockRepository.ts");
const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");

describe("Inventory V1 freeze hardening", () => {
  it("serializes every ledger insert before the server-side negative-stock check", () => {
    expect(migration).toContain("inventory_movement_lock_item_row");
    expect(migration).toContain("for update;");
    expect(migration).toContain("before insert on public.inventory_movements");
  });

  it("keeps the material quantity read model synchronized to the immutable ledger", () => {
    expect(migration).toContain("inventory_movement_sync_item_quantity");
    expect(migration).toContain("referencing new table as inserted_movements");
    expect(migration).toContain("sum(public.inventory_movement_signed_quantity");
  });

  it("requires tenant-scoped idempotency for manual stock mutations", () => {
    expect(migration).toContain("create table if not exists public.inventory_operation_idempotency");
    expect(migration).toContain("primary key (restaurant_id, idempotency_key)");
    for (const rpc of ["record_inventory_movement_v2", "record_inventory_transfer_v2", "record_inventory_waste_v2"]) {
      expect(migration).toContain(`public.${rpc}`);
      expect(repository).toContain(`\"${rpc}\"`);
    }
    expect(repository).toContain("window.sessionStorage.getItem(storageKey)");
    expect(repository).toContain("window.sessionStorage.removeItem(storageKey)");
    expect(repository).toContain('import { createBrowserUuid } from "../../../core/browser/createBrowserUuid"');
    expect(repository).toContain("stored || createBrowserUuid()");
    expect(repository).not.toContain("globalThis.crypto.randomUUID()");
  });

  it("closes direct authenticated access to deprecated non-idempotent RPCs", () => {
    for (const rpc of ["record_inventory_movement", "record_inventory_transfer", "record_inventory_waste", "record_inventory_adjustment"]) {
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${rpc}\\(`));
    }
  });

  it("keeps technical diagnostics in developer logs and business language in the UI", () => {
    expect(repository).toContain("Inventory operation could not be completed. Refresh stock and try again.");
    expect(dashboard).toContain('console.error("Inventory Kitchen Request action failed.", cause)');
    expect(dashboard).toContain('inventoryUserMessage(cause, "Kitchen request action could not be completed. Try again.")');
  });

  it("keeps the unauthorised internal seed contract off the authenticated API", () => {
    expect(seedHardening).toContain("seed_inventory_default_master_data(uuid)");
    expect(seedHardening).toContain("from public, anon, authenticated");
    expect(seedHardening).toContain("to service_role");
  });
});
