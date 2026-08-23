import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const kitchenService=readFileSync(new URL("../../src/modules/kitchen/services/inventoryRequestService.ts",import.meta.url),"utf8");
const kitchenPage=readFileSync(new URL("../../src/modules/kitchen/pages/KitchenDashboardPage.tsx",import.meta.url),"utf8");
const managerKitchen=readFileSync(new URL("../../src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx",import.meta.url),"utf8");
const managerOperations=readFileSync(new URL("../../src/modules/manager/pages/ManagerOperationsCenterPage.tsx",import.meta.url),"utf8");
const managerInventory=readFileSync(new URL("../../src/modules/manager/pages/ManagerInventoryWorkspacePage.tsx",import.meta.url),"utf8");
const inventoryService=readFileSync(new URL("../../src/modules/inventory/services/inventoryKitchenRequestService.ts",import.meta.url),"utf8");
const inventoryDashboard=readFileSync(new URL("../../src/modules/inventory/components/InventoryOperationalDashboard.tsx",import.meta.url),"utf8");
const handoffMigration=readFileSync(new URL("../../supabase/migrations/242_kitchen_request_inventory_handoff.sql",import.meta.url),"utf8");

describe("KMR3 end-to-end closeout contracts",()=>{
  it("carries the request type through the shared read models",()=>{
    expect(kitchenService).toContain("request_type,inventory_item_id");
    expect(kitchenService).toContain("requestType:row.request_type");
    expect(inventoryService).toContain('request_type: InventoryRequest["requestType"]');
    expect(inventoryService).toContain("requestType: row.request_type");
  });

  it("uses friendly material labels in Kitchen, Manager, and Inventory",()=>{
    for(const label of ["Ingredient / Food Material","Kitchen Supply","Tool / Equipment","Cleaning / Consumable","Other"]){
      expect(kitchenService+kitchenPage).toContain(label);
    }
    for(const consumer of [managerKitchen,managerOperations,managerInventory,inventoryDashboard]){
      expect(consumer).toContain("materialRequestTypeLabel");
      expect(consumer).not.toContain("{request.requestType}");
      expect(consumer).not.toContain("{selectedRequest.requestType}");
    }
  });

  it("keeps non-stock materials visible but impossible to issue as stock",()=>{
    expect(inventoryService).toContain("row.current_quantity == null ? null");
    expect(inventoryDashboard).toContain("!request.inventoryItemId || available === null");
    expect(inventoryDashboard).toContain("Boolean(request.inventoryItemId)");
    expect(inventoryDashboard).toContain("Cannot Fulfill");
    expect(inventoryDashboard).toContain("Confirm Cannot Fulfill");
  });

  it("preserves canonical issue and receipt authority with no second deduction",()=>{
    expect(handoffMigration).toContain("movement_id:=public.record_inventory_movement(");
    const confirmation=handoffMigration.slice(handoffMigration.indexOf("create or replace function public.confirm_kitchen_inventory_request_receipt"));
    expect(confirmation).not.toContain("record_inventory_movement(");
    expect(kitchenService).toContain('rpc("confirm_kitchen_inventory_request_receipt"');
  });

  it("keeps request badge refresh on the tenant realtime stream",()=>{
    expect(kitchenPage).toContain('event.table === "kitchen_inventory_requests"');
    expect(kitchenPage).toContain("refreshStockReceipts(false)");
    expect(kitchenPage).toContain("KitchenStockRequestsPanel");
  });

  it("never replaces RPC authority with direct request mutation",()=>{
    expect(kitchenService).toContain('rpc("create_kitchen_inventory_request"');
    expect(inventoryService).toContain('rpc("issue_kitchen_inventory_request"');
    expect(inventoryService).toContain('rpc("mark_kitchen_inventory_request_unable_to_fulfill"');
    expect(kitchenService).not.toMatch(/from\("kitchen_inventory_requests"\)[\s\S]{0,120}\.(insert|update|delete)\(/);
  });
});
