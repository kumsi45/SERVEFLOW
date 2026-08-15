import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManagerR4OperationalReport } from "../../src/modules/manager/services/managerR4ReportsService";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/239_manager_reports_r4_operational_reporting.sql"), "utf8").replaceAll("\r\n", "\n");

describe("Manager Reports R4 operational truth", () => {
  it("keeps every read and mutation under manager-only report authority", () => {
    expect(migration.match(/manager_can_report/g)?.length).toBeGreaterThanOrEqual(7);
    expect(migration).not.toContain("owner_can_report");
    expect(migration).toContain("role::text='manager'");
    expect(migration).toContain("from public,anon,authenticated");
  });

  it("uses canonical kitchen milestones without producing staff scores", () => {
    expect(migration).toContain("kitchen_preparation_started_at");
    expect(migration).toContain("kitchen_completed_at");
    expect(migration).toContain("percentile_cont(.5)");
    expect(migration).toContain("'score_available',false");
    expect(migration).not.toMatch(/performance_score|staff_rank/i);
  });

  it("uses only immutable inventory movement history", () => {
    expect(migration).toContain("public.inventory_movements");
    expect(migration).toContain("movement_date>=p.period_start");
    expect(migration).toContain("'inventory_history_quality','mixed_legacy'");
    expect(migration).toContain("'inventory_history_scope','movement_ledger_only'");
    expect(migration).not.toContain("current_quantity");
  });

  it("keeps sessions, tables and guests semantically separate", () => {
    expect(migration).toContain("dining_session_opened_at");
    expect(migration).toContain("count(distinct o.table_number)");
    expect(migration).toContain("'guest_count_available',false");
    expect(migration).not.toContain("'guest_count',(select count");
  });

  it("records explicit incidents, append-only decisions and period-linked notes", () => {
    expect(migration).toContain("create table public.manager_report_incidents");
    expect(migration).toContain("create table public.manager_report_incident_decisions");
    expect(migration).toContain("create table public.manager_operational_notes");
    expect(migration).toContain("Resolved incidents are immutable.");
    expect(migration).toContain("period_start<range_end and n.period_end>range_start");
  });

  it("parses raw comparison facts without inventing scores or guest counts", () => {
    const report = parseManagerR4OperationalReport({
      generated_at: "2026-08-15T00:00:00Z", range_start: "a", range_end: "b", comparison_range_start: "c", comparison_range_end: "d",
      kitchen: { current: { items_completed: 4, avg_minutes: 12.5 }, comparison: { items_completed: 3 }, stations: [], delay_threshold_minutes: 25 },
      staff: { facts: [{ id: "staff", orders_created: 2 }] },
      inventory: { current: { movement_count: 2, quantity_out: 4 }, comparison: {}, movements: [], requests: [] },
      guests: { current: { sessions_opened: 3, tables_served: 2 }, comparison: {}, assistance_requests: 1, complaints: 1, feedback_count: 1, average_feedback_rating: 4 },
      exceptions: { native: [], manual: [] }, manager_records: { decisions: [], notes: [] }, data_quality: {}, definitions: {},
    });
    expect(report.kitchen.current.avgMinutes).toBe(12.5);
    expect(report.staff.scoreAvailable).toBe(false);
    expect(report.inventory.current.quantityOut).toBe(4);
    expect(report.guests.guestCountAvailable).toBe(false);
  });

  it("rejects error payloads", () => {
    expect(() => parseManagerR4OperationalReport({ error: "Permission denied." })).toThrow("Permission denied.");
  });
});
