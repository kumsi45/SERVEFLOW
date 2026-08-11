import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activeWaiterAssistanceRequests,
  WAITER_ASSISTANCE_STALE_MS,
} from "../../src/modules/waiter-dashboard/services/waiterAssistance";
import type { WaiterAssistanceRequest } from "../../src/modules/waiter-dashboard/types";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/233_waiter_assistance_authoritative_resolution.sql");
const service = read("src/modules/waiter-dashboard/services/waiterDashboardService.ts");
const page = read("src/modules/waiter-dashboard/pages/WaiterDashboardPage.tsx");

const now = Date.parse("2026-08-11T12:00:00.000Z");
const request = (
  id: string,
  status: WaiterAssistanceRequest["status"],
  tableId: string,
  ageMs: number,
): WaiterAssistanceRequest => ({
  id,
  orderId: `order-${id}`,
  tableId,
  status,
  requestedAt: new Date(now - ageMs).toISOString(),
});

describe("authoritative waiter assistance resolution", () => {
  it("shows fresh pending and acknowledged requests only on assigned tables", () => {
    const active = activeWaiterAssistanceRequests([
      request("pending", "pending", "table-a", 5 * 60_000),
      request("acknowledged", "acknowledged", "table-a", 10 * 60_000),
      request("other-waiter", "pending", "table-b", 2 * 60_000),
    ], new Set(["table-a"]), now);
    expect(active.map(({ id }) => id)).toEqual(["pending", "acknowledged"]);
  });

  it("hides unresolved requests at and beyond the 30-minute stale window", () => {
    expect(WAITER_ASSISTANCE_STALE_MS).toBe(30 * 60 * 1000);
    expect(activeWaiterAssistanceRequests([
      request("fresh", "pending", "table-a", WAITER_ASSISTANCE_STALE_MS - 1),
      request("stale", "pending", "table-a", WAITER_ASSISTANCE_STALE_MS + 1),
      request("week-old", "pending", "table-a", 7 * 24 * 60 * 60_000),
    ], new Set(["table-a"]), now).map(({ id }) => id)).toEqual(["fresh"]);
  });

  it("locks resolution to the active assigned waiter and records staff audit identity", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("staff.user_id = auth.uid()");
    expect(migration).toContain("staff.role::text = 'waiter'");
    expect(migration).toContain("assignments.waiter_staff_id = acting_waiter.id");
    expect(migration).toContain("assignments.table_id = target_request.table_id");
    expect(migration).toContain("target_request.status not in ('pending', 'acknowledged')");
    expect(migration).toContain("resolved_by_staff_id = acting_waiter.id");
    expect(migration).toContain("status = 'resolved'");
    expect(migration).toContain("resolved_at = clock_timestamp()");
    expect(migration).toContain("Assistance request is no longer active.");
  });

  it("enforces assignment-scoped reads and forbids direct authenticated updates", () => {
    expect(migration).toContain("create policy waiter_assistance_requests_select_authorized_staff");
    expect(migration).toContain("staff.role::text in ('manager', 'owner')");
    expect(migration).toContain("assignments.active");
    expect(migration).toContain("revoke update on public.waiter_assistance_requests from authenticated");
    expect(migration.match(/create policy/g)).toHaveLength(1);
    expect(migration).toContain("for select\nto authenticated");
  });

  it("queries active recent assigned requests and resolves only through the RPC", () => {
    expect(service).toContain('.in("status", ["pending", "acknowledged"])');
    expect(service).toContain('.in("table_id", assignedTableIds)');
    expect(service).toContain('.gte("requested_at", cutoff)');
    expect(service).toContain('"resolve_waiter_assistance_request"');
    expect(service).not.toMatch(/from\("waiter_assistance_requests"\)[\s\S]{0,500}\.update\(/);
  });

  it("uses DONE, clears from authoritative state, restores on failure, and reuses realtime", () => {
    expect(page).toContain("TABLE {requestTable.tableNumber} NEEDS HELP");
    expect(page).toContain('"DONE"');
    expect(page).toContain("Resolve assistance request for Table");
    expect(page).toContain("current.filter((item) => item.id !== request.id)");
    expect(page).toContain("[request, ...current]");
    expect(page).toContain("Could not update. Try again.");
    expect(page).toContain("setAssistanceRequests([])");
    expect(page).toContain("nextExpiry - Date.now() + 25");
    expect(page).toContain('"waiter_assistance_requests"');
    expect(page.match(/useTenantRealtime\(/g)).toHaveLength(1);
  });
});
