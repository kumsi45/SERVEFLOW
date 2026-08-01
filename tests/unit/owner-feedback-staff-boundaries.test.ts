import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const staff = read("src/modules/owner/services/staffManagementService.ts");
const managerDashboard = read("src/modules/manager/services/managerDashboardService.ts");
const managerAi = read("src/modules/manager/services/managerAiOperationsService.ts");

describe("owner feedback and operational staff boundaries", () => {
  it("uses the explicit tenant-safe menu-item relationship in feedback reports", () => {
    expect(owner).toContain("menu_items!order_items_menu_item_same_restaurant(name)");
    expect(owner).not.toContain('.select("order_id,menu_item_id,menu_items(name)")');
  });

  it("never presents the business owner as staff", () => {
    expect(staff).toContain('.neq("role", "owner")');
    expect(owner.match(/\.neq\("role", "owner"\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(managerDashboard).toContain('.neq("role", "owner")');
    expect(managerAi).toContain('.neq("role", "owner")');
  });
});
