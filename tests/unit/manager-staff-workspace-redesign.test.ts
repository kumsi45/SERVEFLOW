import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerStaffOperationsPage.tsx");
const service = read("src/modules/manager/services/managerStaffOperationsService.ts");
const styles = read("src/modules/manager/styles/managerStaffOperations.css");
const staffFunction = read("supabase/functions/manage-staff/index.ts");

describe("Manager Staff workspace redesign", () => {
  it("uses the focused people-management navigation with Overview as default", () => {
    expect(page).toContain('type StaffTab = "overview" | "directory" | "shift" | "create"');
    expect(page).toContain('useState<StaffTab>("overview")');
    for (const tab of ["Overview", "Directory", "Shift Status"]) expect(page).toContain(`["${tab === "Shift Status" ? "shift" : tab.toLowerCase()}", "${tab}"]`);
    expect(page).not.toContain('["create", "Create Staff"]');
    expect(page).toContain('setActiveTab("create")}>+ Add Staff');
    for (const removed of ["Assignment Center", '"activity" |', '"analytics"']) expect(page).not.toContain(removed);
  });

  it("keeps assignments informational and removes mutation controls", () => {
    expect(page).toContain("currentWork(member)");
    expect(page).toContain('selectedStaff.role === "waiter" ? "Live Operations" : "Kitchen"');
    expect(page).toContain('member.role === "waiter" ? "/manager/tables" : "/manager/kitchen"');
    expect(page).toContain('"/manager/kitchen"');
    expect(page).not.toContain("assignWaiterTables");
    expect(page).not.toContain("assignedKitchenStationId:");
    expect(page).not.toContain("Assign Table");
    expect(page).not.toContain("Move Chef");
  });

  it("uses one aligned directory grid without bulk selection", () => {
    expect(page).toContain('className="mso-directory-row"');
    expect(page).not.toContain("selectedIds");
    expect(page).not.toContain("mso-check");
    expect(styles).toContain(".mso-directory-list .mso-list-header,\n.mso-directory-row");
    expect(styles).toContain("grid-template-columns: minmax(210px, 1.4fr)");
  });

  it("does not represent shared-device authentication as attendance", () => {
    expect(service).toContain('shiftStatus: "not_recorded"');
    expect(service).toContain("clockIn: null");
    expect(page).toContain("Shift check-in is not recorded.");
    expect(page).toContain("not employee attendance or arrival time");
    expect(page).not.toContain("Late");
    expect(page).not.toContain("Absent");
  });

  it("uses a contextual staff inspector and existing authorized actions", () => {
    expect(page).toContain('role="dialog"');
    expect(page).toContain("mso-drawer-backdrop");
    for (const action of ["sendManagerStaffMessage", "markManagerStaffBreak", "endManagerStaffBreak", "activateManagerStaff", "deactivateManagerStaff", "suspendManagerStaff", "resetManagerStaffPassword"]) expect(page).toContain(action);
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("width: 100vw");
  });

  it("keeps tenant and role authority in the existing server path", () => {
    expect(service).toContain('.eq("restaurant_id", restaurantId)');
    expect(page).toContain("useTenantRealtime");
    expect(staffFunction).toContain("canCreateStaffRole");
    expect(staffFunction).toContain('.in("role", ["owner", "manager"])');
    expect(page).not.toContain("service_role");
  });

  it("provides deliberate tablet, mobile, and narrow-mobile reflow", () => {
    expect(styles).toContain("@media (max-width: 820px)");
    expect(styles).toContain("@media (max-width: 640px)");
    expect(styles).toContain("@media (max-width: 355px)");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("overflow-x: clip");
  });
});
