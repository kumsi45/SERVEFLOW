import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/manager/pages/ManagerCustomerExperiencePage.tsx");
const service = read("src/modules/manager/services/managerCustomerExperienceService.ts");
const styles = read("src/modules/manager/styles/managerCustomerExperience.css");

describe("Manager Guests workspace redesign", () => {
  it("uses the focused V1 navigation with Needs Attention as default", () => {
    expect(page).toContain('type GuestTab = "attention" | "complaints" | "requests" | "lookup"');
    expect(page).toContain('useState<GuestTab>("attention")');
    for (const label of ["Needs Attention", "Complaints", "Special Requests", "Guest Lookup"]) expect(page).toContain(`label: "${label}"`);
    for (const removed of ["Reservations", "VIP Guests", "Bill Requests", "Customer Timeline"]) expect(page).not.toContain(removed);
    expect(page).not.toContain('<h1>Guests</h1>');
    expect(page).not.toContain("Live service recovery");
    expect(page).not.toContain("Service recovery</span>");
    expect(page).not.toContain('id="attention-heading"');
  });

  it("removes cross-workspace operational controls", () => {
    for (const removed of ["assignManagerCustomerWaiter", "notifyManagerCustomerKitchen", "notifyManagerCustomerCashier", "Assign waiter", "Notify Kitchen", "Notify Cashier"]) expect(page).not.toContain(removed);
    expect(page).toContain("Assigned Staff");
  });

  it("shows supported attention sources and excludes heuristic VIP alerts", () => {
    expect(page).toContain('alert.type !== "vip_wait"');
    for (const issue of ["Excessive service wait", "Delayed bill assistance", "Unresolved complaint", "Special request needs attention"]) expect(page).toContain(issue);
    expect(page).toContain('normalized.includes("delay")');
  });

  it("keeps only authoritative complaint actions", () => {
    expect(page).toContain("escalateManagerComplaint");
    expect(page).toContain("resolveManagerComplaint");
    expect(page).not.toContain("Add note");
    expect(page).not.toContain("Acknowledge");
    expect(page).not.toContain("Assign complaint");
  });

  it("does not invent customer identities or table-only references", () => {
    expect(page).toContain('`Order ${session.displayNumber}`');
    expect(page).toMatch(/session\.tableNumber\s*\?/);
    expect(page).toContain("Customer not recorded");
    expect(page).not.toContain('customerName || "Guest"');
  });

  it("retains tenant-scoped reads and existing realtime", () => {
    expect(service.match(/\.eq\("restaurant_id", restaurantId\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(page).toContain("useTenantRealtime");
    expect(page).toContain('"manager_customer_complaints"');
    expect(page).not.toContain("service_role");
  });

  it("provides responsive rows and a contextual inspector", () => {
    expect(page).toContain('role="dialog"');
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("@media (max-width: 480px)");
    expect(styles).toContain("@media (max-width: 360px)");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("width: 100vw");
  });
});
