import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const service = read("src/modules/kitchen/services/inventoryRequestService.ts");
const kitchen = read("src/modules/manager/pages/ManagerKitchenSupervisionPage.tsx");
const operations = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");

describe("Kitchen request relationship disambiguation", () => {
  it("uses the deployed tenant-safe station relationship explicitly", () => {
    expect(service).toContain("station:kitchen_stations!kitchen_requests_station_restaurant_fk(name)");
    expect(service).not.toContain(",kitchen_stations(name)");
    expect(service).toContain("stationName:one(row.station)?.name??null");
    expect(service).toContain('.eq("restaurant_id",restaurantId)');
  });

  it("uses tenant-safe relationship hints for every embedded staff actor", () => {
    for (const relationship of [
      "kitchen_requests_requester_restaurant_fk",
      "kitchen_requests_reviewer_restaurant_fk",
      "kitchen_requests_fulfiller_restaurant_fk",
      "kitchen_requests_issuer_restaurant_fk",
      "kitchen_requests_confirmer_restaurant_fk",
      "kitchen_requests_unable_actor_restaurant_fk",
    ]) expect(service).toContain(relationship);
    expect(service).not.toContain("!kitchen_inventory_requests_requested_by_staff_id_fkey");
    expect(service).not.toContain("!kitchen_inventory_requests_reviewed_by_staff_id_fkey");
    expect(service).not.toContain("!kitchen_inventory_requests_fulfilled_by_staff_id_fkey");
  });

  it("keeps Kitchen operational metrics unavailable when the core snapshot fails", () => {
    expect(kitchen).toContain('setOperationsState("unavailable")');
    expect(kitchen).toContain('operationsState === "unavailable"');
    expect(kitchen).toContain("Unable to load Kitchen operations.");
  });

  it("isolates request failures without rendering a confirmed empty request state", () => {
    expect(kitchen).toContain('setRequestsState(nextRequestsResult.available ? "ready" : "unavailable")');
    expect(kitchen).toContain("Kitchen requests unavailable.");
    expect(operations).toContain('if (requestsResult.status === "fulfilled")');
    expect(operations).toContain("setRequestsUnavailable(false)");
    expect(operations).toContain("setRequestsUnavailable(true)");
    expect(operations).toContain("Kitchen requests unavailable.");
    expect(operations).toContain("!requestsUnavailable && visibleActions.length === 0");
  });

  it("keeps Live Operations metrics unavailable when its core load fails", () => {
    expect(operations).toContain('setOperationsState("unavailable")');
    expect(operations).toContain('operationsState === "unavailable"');
    expect(operations).toContain("Unable to load Live Operations.");
  });
});
