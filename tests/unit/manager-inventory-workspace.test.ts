import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");
const page = read(
  "src/modules/manager/pages/ManagerInventoryWorkspacePage.tsx",
);
const service = read(
  "src/modules/manager/services/managerInventoryWorkspaceService.ts",
);
const requestMigration = read(
  "supabase/migrations/240_live_operations_kitchen_request_review.sql",
);

describe("Manager Inventory workspace", () => {
  it("is a manager-shell workspace with an explicit full Inventory handoff", () => {
    expect(read("src/app/router/AppRouter.tsx")).toContain(
      '"menu", "inventory"',
    );
    expect(
      read("src/modules/staff-auth/pages/ProtectedManagerRoute.tsx"),
    ).toContain('section === "inventory"');
    expect(page).toContain('"/inventory/dashboard"');
  });

  it("uses ledger-derived current stock and tenant-scoped request/menu data", () => {
    expect(service).toContain("loadInventoryCurrentStock(restaurantId)");
    expect(service).toContain("loadInventoryRequests(restaurantId)");
    expect(service).toContain('.eq("restaurant_id", restaurantId)');
    expect(page).toContain('"inventory_movements"');
    expect(page).toContain('"kitchen_inventory_requests"');
  });

  it("keeps request decisions in Live Operations without inventing partial states", () => {
    expect(page).not.toContain("processInventoryRequest(");
    expect(page).not.toContain('"partially_fulfilled"');
    expect(requestMigration).toContain("target_action in ('accept','reject') and role::text in ('manager','owner')");
    expect(page).toContain("Approve or reject this request from Live Operations.");
  });

  it("provides compact responsive stock and request views", () => {
    expect(page).toContain("Needs Attention");
    expect(page).toContain("Request Center");
    expect(page).toContain("Stock Health");
    expect(page).toContain("Prepare for Next Service");
    expect(
      read("src/modules/manager/styles/managerInventoryWorkspace.css"),
    ).toContain("@media (max-width: 767px)");
  });
});
