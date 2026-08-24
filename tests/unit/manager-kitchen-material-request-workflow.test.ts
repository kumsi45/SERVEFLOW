import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8").replaceAll("\r\n","\n");
const page=read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
const service=read("src/modules/kitchen/services/inventoryRequestService.ts");
const migration=read("supabase/migrations/240_live_operations_kitchen_request_review.sql");
const realtime=read("src/core/realtime/restaurantEventService.ts");
const css=read("src/modules/manager/styles/managerOperationsCenter.css");

describe("Live Operations kitchen material request workflow",()=>{
  it("extends the canonical request and immutable event architecture",()=>{
    expect(migration).toContain("alter table public.kitchen_inventory_requests");
    expect(migration).not.toContain("create table");
    expect(migration).toContain("insert into public.inventory_request_events");
    expect(migration).toContain("reviewed_by_staff_id");
    expect(migration).toContain("fulfilled_by_staff_id");
  });

  it("renders canonical item, quantity, station, requester, reason, time, age and status",()=>{
    for(const value of ["request.itemName","request.quantity","request.unit","request.stationName","request.requesterName","request.comment","request.requestedAt","action.age","inventoryRequestStatusLabel(request.status)"]) expect(page).toContain(value);
    expect(page).toContain("Reason not recorded");
    expect(service).toContain("Pending Review");
  });

  it("shows only unique pending requests in the approval queue",()=>{
    expect(page).toContain("new Map(inventoryRequests.map((request) => [request.id, request]))");
    expect(page).toContain('request.status === "pending"');
    expect(page).not.toContain('request.status === "delivered" ? "approvals"');
  });

  it("gives managers review authority and inventory officers fulfillment authority",()=>{
    expect(migration).toContain("target_action in ('accept','reject') and role::text in ('manager','owner')");
    expect(migration).toContain("target_action='deliver' and role::text in ('inventory_officer','owner')");
    expect(migration).toContain("Manager request review access denied.");
    expect(migration).toContain("Inventory fulfillment access denied.");
  });

  it("requires rejection reason and preserves atomic status transitions",()=>{
    expect(page).toContain("Rejection reason is required.");
    expect(page).toContain("disabled={reviewingRequestId===selectedRequest.id||!rejectionReason.trim()}");
    expect(migration).toContain("if next_status='rejected' and normalized_reason is null");
    expect(migration).toContain("for update");
    expect(migration).toContain("Request was already handled or is not available for this action.");
  });

  it("keeps approval separate from delivery and Check Inventory non-mutating",()=>{
    expect(migration).toContain("target_action='accept' and req.status='pending'");
    expect(migration).toContain("target_action='deliver' and req.status='accepted'");
    expect(migration).toContain("perform public.record_inventory_movement");
    expect(migration).not.toContain("set current_quantity=greatest");
    expect(page).toContain('navigateTo("/manager/inventory", restaurantId)');
    expect(page).not.toContain('checkInventory() {\n    void processInventoryRequest');
  });

  it("keeps reads and decisions tenant scoped with server-derived actors",()=>{
    expect(service).toContain('.eq("restaurant_id",restaurantId)');
    expect(migration).toContain("restaurant_id=target_restaurant_id");
    expect(migration).toContain("user_id=auth.uid()");
    expect(migration).toContain("active=true");
    expect(migration).toContain("from public,anon");
    expect(migration).toContain("inventory_officer");
    expect(migration).toContain("normalized_name:=catalog_name");
    expect(migration).toContain("normalized_unit:=catalog_unit");
  });

  it("refreshes requests and current stock through tenant realtime",()=>{
    expect(realtime).toContain('"kitchen_inventory_requests"');
    expect(realtime).toContain('"inventory_items"');
    expect(page).toContain('"kitchen_inventory_requests", "inventory_items"');
    expect(page).toContain("await refresh()");
  });

  it("provides explicit operational states and responsive touch controls",()=>{
    for(const value of ["Loading requests...","No kitchen requests require attention.","Request details unavailable.","You no longer have permission to review this request.","Request was already handled by another Manager."]) expect(page).toContain(value);
    expect(css).toContain(".moc-request-action");
    expect(css).toContain("@media(max-width:767px)");
    expect(css).toContain("@media(max-width:430px)");
    expect(css).toContain("min-height:46px");
  });

  it("keeps the mobile queue compact while retaining full Review details",()=>{
    expect(page).toContain("moc-request-mobile-summary");
    expect(page).toContain('className="moc-request-wait"');
    expect(page).toContain('return "Critical \\u00b7 Pending"');
    expect(page).toContain('aria-pressed={actionFilter === filter}');
    expect(css).toContain(".moc-request-action>dl{display:none}");
    expect(css).toContain(".moc-request-mobile-summary{display:grid");
    expect(css).toContain("button span.is-zero{display:none}");
    expect(css).toContain("footer button{width:auto;min-height:44px");
    expect(page).toContain("<section><h3>Reason</h3>");
    expect(page).toContain("requestedLabel(selectedRequest.requestedAt)");
    expect(page).toContain("selectedRequestStockQuantity");
  });
});
