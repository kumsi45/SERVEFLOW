import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const service = read("src/modules/kitchen/services/inventoryRequestService.ts");
const kitchenPage = read("src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx");
const operationsPage = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
const kitchenDrawer = kitchenPage.slice(kitchenPage.indexOf("{selectedRequest &&"), kitchenPage.indexOf("{selectedStation &&"));
const operationsDrawer = operationsPage.slice(operationsPage.indexOf("{selectedRequest &&"), operationsPage.indexOf("{selectedRequestId && !selectedRequest"));

describe("Manager Kitchen request handoff frontend", () => {
  it("maps every deployed request status to a human label", () => {
    expect(service).toContain('"pending" | "accepted" | "issued" | "delivered" | "rejected" | "unable_to_fulfill"');
    for (const label of [
      "Pending Review",
      "Awaiting Inventory",
      "Issued · Awaiting Kitchen Confirmation",
      "Fulfilled",
      "Rejected",
      "Unable to Fulfill",
    ]) expect(service).toContain(label);
  });

  it("loads real issue, confirmation, and unable-to-fulfill attribution through the same tenant query", () => {
    for (const field of ["issued_at", "issued_quantity", "confirmed_at", "unable_to_fulfill_at", "unable_to_fulfill_reason"]) expect(service).toContain(field);
    for (const relation of ["kitchen_requests_issuer_restaurant_fk", "kitchen_requests_confirmer_restaurant_fk", "kitchen_requests_unable_actor_restaurant_fk"]) expect(service).toContain(relation);
    expect(service).toContain('.eq("restaurant_id",restaurantId)');
    expect(service).not.toContain(".select(\"*\")");
  });

  it("keeps Manager mutations limited to canonical approve and reject", () => {
    expect(service).toContain('action:"accept"|"reject"');
    expect(service).not.toContain('"accept"|"reject"|"deliver"');
    expect(service).toContain('supabase.rpc("process_kitchen_inventory_request"');
    for (const drawer of [kitchenDrawer, operationsDrawer]) {
      expect(drawer).toContain('selectedRequest.status === "pending"');
      expect(drawer).toContain("Approve Request");
      expect(drawer).toContain(">Reject</button>");
      expect(drawer).not.toContain("Send to Inventory");
      expect(drawer).not.toContain("Issue Stock");
      expect(drawer).not.toContain("Confirm Received");
    }
  });

  it("renders accepted as the automatic observational Inventory handoff", () => {
    for (const drawer of [kitchenDrawer, operationsDrawer]) {
      expect(drawer).toContain('selectedRequest.status === "accepted"');
      expect(drawer).toContain("Inventory has not issued this request yet.");
    }
    expect(kitchenDrawer).toContain("Approved by");
    expect(kitchenDrawer).toContain("Approved at");
  });

  it("renders issued attribution without Manager receipt authority", () => {
    for (const value of ["Issued · Awaiting Kitchen Confirmation", "Waiting for Kitchen to confirm receipt.", "Issued quantity", "Issued by", "Issued at"]) expect(kitchenDrawer).toContain(value);
    for (const value of ["issuerName", "issuedAt", "issuedQuantity"]) expect(operationsDrawer).toContain(value);
  });

  it("renders fulfilled confirmation attribution", () => {
    for (const value of ["Fulfilled", "Received by Kitchen.", "Confirmed by", "Confirmed at"]) expect(kitchenDrawer).toContain(value);
    expect(operationsDrawer).toContain("confirmerName");
    expect(operationsDrawer).toContain("confirmedAt");
  });

  it("keeps unable and rejected outcomes truthful and terminal", () => {
    for (const value of ["Unable to Fulfill", "unableToFulfillReason", "Inventory Officer", "unableToFulfillAt"]) expect(kitchenDrawer).toContain(value);
    for (const value of ["Rejected", "rejectionReason", "Rejected by", "Rejected at"]) expect(kitchenDrawer).toContain(value);
    expect(operationsDrawer).toContain("unableToFulfillByName");
    expect(operationsDrawer).toContain("Rejection reason");
  });

  it("counts only unique pending Manager decisions without duplicating urgent requests", () => {
    expect(operationsPage).toContain("new Map(inventoryRequests.map((request) => [request.id, request]))");
    expect(operationsPage).toContain('uniqueRequests.filter((request) => request.status === "pending")');
    expect(kitchenPage).toContain('const pendingRequests = requests.filter((request) => request.status === "pending")');
    expect(kitchenPage).toContain("regularPendingRequests");
    expect(kitchenPage).toContain('request.urgency !== "critical" && request.urgency !== "high"');
    expect(kitchenPage).not.toContain("pendingRequests.slice(0, 6)");
  });

  it("uses tenant-scoped realtime refresh for every lifecycle transition", () => {
    for (const page of [kitchenPage, operationsPage]) {
      expect(page).toContain('"kitchen_inventory_requests"');
      expect(page).toContain("refresh");
    }
    expect(service).toContain('.eq("restaurant_id",restaurantId)');
  });
});
