import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../src/modules/kitchen/pages/KitchenDashboardPage.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../src/modules/kitchen/services/inventoryRequestService.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../src/modules/kitchen/styles/kitchenDashboard.css", import.meta.url), "utf8");
const receipts = readFileSync(new URL("../../src/modules/kitchen/components/KitchenStockRequestsPanel.tsx", import.meta.url), "utf8");

describe("KMR2 Kitchen Create Request", () => {
  it("maps all canonical request types to friendly labels", () => {
    for (const label of [
      "Ingredient / Food Material",
      "Kitchen Supply",
      "Tool / Equipment",
      "Cleaning / Consumable",
      "Other",
    ]) expect(page).toContain(`label: "${label}"`);
    expect(page).toContain("Request Type");
  });

  it("uses Item for catalog flow and Material name for free-text flow", () => {
    expect(page).toContain("<span>Item</span>");
    expect(page).toContain("<span>Material name</span>");
    expect(page).toContain('placeholder="Search inventory..."');
    expect(page).toContain('placeholder="e.g. metal tray, gloves, detergent"');
    expect(page).not.toContain("Catalog Item");
    expect(page).not.toContain("Need\n");
  });

  it("searches inventory server-side within the tenant and submits through the canonical RPC", () => {
    expect(service).toContain('.eq("restaurant_id",restaurantId)');
    expect(service).toContain('.ilike("name"');
    expect(service).toContain('.limit(20)');
    expect(service).toContain('supabase.rpc("create_kitchen_inventory_request"');
    expect(service).toContain("target_request_type:input.requestType");
    expect(service).not.toMatch(/from\("kitchen_inventory_requests"\)[\s\S]{0,100}\.insert\(/);
  });

  it("keeps station context read-only and uses the authenticated assignment", () => {
    expect(page).toContain('<span>Station</span>');
    expect(page).toContain('<div className="kd-request-readonly">{stationLabel}</div>');
    expect(page).toContain("dashboardContext?.assignedStation?.id");
    expect(page).not.toMatch(/kd-request[^\n]+setSelectedStationId/);
  });

  it("provides concise client validation and sanitizes server failures", () => {
    for (const message of [
      "Select an item.",
      "Enter a material name.",
      "Enter a quantity greater than 0.",
      "Select a unit.",
    ]) expect(page + service).toContain(message);
    expect(page).toContain('role="alert"');
    expect(page).toContain("materialRequestErrorMessage(cause)");
  });

  it("preserves receipt confirmation and the existing material action placement", () => {
    const requests = page.indexOf("<KitchenStockRequestsPanel");
    const create = page.indexOf("Create Request", requests);
    expect(requests).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(requests);
    expect(page).toContain("handleConfirmStockReceipt");
    expect(receipts).toContain("Confirm Received");
  });

  it("uses a compact two-column sheet with portrait and mobile fallbacks", () => {
    expect(css).toContain("width: min(640px, 100%)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
    expect(css).toContain("max-height: min(740px, calc(100dvh - 36px))");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("@media (max-width: 800px)");
    expect(css).toContain("grid-template-columns: 1fr");
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("max-height: 100dvh");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});
