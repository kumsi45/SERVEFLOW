import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ManagerWaiterTableAssignments } from "../../src/modules/manager/components/ManagerWaiterTableAssignments";
import type { ManagerWaiterAssignmentContext } from "../../src/modules/manager/services/managerWaiterTableAssignmentService";

const read = (path: string) => readFileSync(path, "utf8");
const component = read("src/modules/manager/components/ManagerWaiterTableAssignments.tsx");
const page = read("src/modules/manager/pages/ManagerOperationsCenterPage.tsx");
const service = read("src/modules/manager/services/managerWaiterTableAssignmentService.ts");
const styles = read("src/modules/manager/styles/managerWaiterTableAssignments.css");

const context: ManagerWaiterAssignmentContext = {
  waiters: [
    { staffId: "waiter-a", displayName: "Abdi", active: true, assignedTableCount: 2 },
    { staffId: "waiter-b", displayName: "Hana", active: true, assignedTableCount: 0 },
  ],
  tables: [
    { tableId: "table-1", tableNumber: 1, tableLabel: "Table 1", active: true, currentWaiterStaffId: "waiter-a", currentWaiterName: "Abdi", assignmentVersion: 1, occupancyStatus: "occupied" },
    { tableId: "table-2", tableNumber: 2, tableLabel: "Table 2", active: true, currentWaiterStaffId: "waiter-a", currentWaiterName: "Abdi", assignmentVersion: 1, occupancyStatus: "available" },
    { tableId: "table-3", tableNumber: 3, tableLabel: "Table 3", active: true, currentWaiterStaffId: null, currentWaiterName: null, assignmentVersion: null, occupancyStatus: "occupied" },
  ],
};

function markup(nextContext: ManagerWaiterAssignmentContext | null = context, state: "loading" | "ready" | "unavailable" = "ready") {
  return renderToStaticMarkup(<ManagerWaiterTableAssignments context={nextContext} state={state} syncNotice={null} requestedTableId={null} onRequestHandled={vi.fn()} onAssign={vi.fn()} onUnassign={vi.fn()} />);
}

describe("Manager Waiter to table assignment frontend", () => {
  it("renders current responsibility, factual counts, occupancy, and Unassigned separately", () => {
    const html = markup();
    expect(html).toContain("Table Assignments");
    expect(html).toContain("Abdi");
    expect(html).toContain("2 tables");
    expect(html).toContain("Hana");
    expect(html).toContain("0 tables");
    expect(html).toContain("Unassigned Tables");
    expect(html).toContain("Occupied");
    expect(html).toContain("Available");
  });

  it("uses only the authorized canonical read and mutation RPCs", () => {
    expect(service).toContain('supabase.rpc("get_waiter_table_assignment_context"');
    expect(service).toContain('supabase.rpc("assign_waiter_tables"');
    expect(service).toContain('supabase.rpc("unassign_waiter_tables"');
    expect(service).not.toContain('.from("restaurant_staff")');
    expect(service).not.toContain('.from("restaurant_tables")');
  });

  it("supports one or many checkbox selections with an updating selected count", () => {
    expect(component).toContain('type="checkbox"');
    expect(component).toContain("toggleTable(table.tableId)");
    expect(component).toContain('countLabel(selectedTableIds.length, "table")');
    expect(component).toContain("Assign ${countLabel(selectedTableIds.length, \"Table\")}");
  });

  it("shows explicit reassignment and lifecycle-preservation copy", () => {
    expect(component).toContain("Currently assigned to ${table.currentWaiterName}");
    expect(component).toContain("This changes current responsibility only.");
    expect(component).toContain("Existing orders, payments, kitchen state, and table occupancy will remain unchanged.");
    expect(component).toContain("Confirm Assignment");
  });

  it("supports unassignment without presenting it as table release", () => {
    expect(component).toContain("Move selected to Unassigned");
    expect(page).toContain("Occupancy is unchanged.");
    expect(component).not.toContain("Free Table");
  });

  it("preserves distinct loading, unavailable, no-Waiter, and non-table states", () => {
    expect(markup(null, "loading")).toContain("Loading table assignments...");
    expect(markup(null, "unavailable")).toContain("Table assignments unavailable.");
    expect(markup({ waiters: [], tables: context.tables })).toContain("No Waiters available.");
    expect(markup({ waiters: [], tables: [] })).toBe("");
  });

  it("refreshes from authoritative data after writes and tenant-scoped realtime", () => {
    expect(page).toContain("await Promise.all([refresh(), refreshAssignments()])");
    expect(page).toContain('channelName: "manager-waiter-table-assignments"');
    expect(page).toContain('tables: ["restaurant_table_waiter_assignments"]');
    expect(page).toContain("Assignment changed by another Manager. Refreshing...");
  });

  it("keeps mobile keyboard and touch operation independent from drag and horizontal boards", () => {
    expect(component).not.toContain("draggable");
    expect(component).not.toContain("onDrag");
    expect(styles).toContain("@media(max-width:767px)");
    expect(styles).toContain("grid-template-columns:1fr");
    expect(styles).toContain("height:100dvh");
  });
});
