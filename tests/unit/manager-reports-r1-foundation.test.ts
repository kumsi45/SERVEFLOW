import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const service = read("src/modules/manager/services/managerOperationalReportsService.ts");
const page = read("src/modules/manager/pages/ManagerOperationalReportsPage.tsx");
const audit = read("docs/MANAGER_REPORTS_R1_REPORTING_TRUTH.md");

describe("Manager Reports R1 reporting foundation", () => {
  it("routes all four Manager periods through the shared validated contract", () => {
    expect(service).toContain('export type ManagerReportRange = "today" | "week" | "month" | "custom"');
    expect(service).toContain("reportingPeriodWindow(range, timezone, customStart, customEnd)");
    expect(service).not.toContain("return analyticsWindow(range");
  });

  it("surfaces invalid custom periods instead of crashing or querying", () => {
    expect(page).toContain("const periodResult=useMemo");
    expect(page).toContain("if(!periodResult.window){setError(periodResult.error);setReport(null);setLoading(false);return;}");
  });

  it("records every required report domain and the Manager authority boundary", () => {
    for (const domain of [
      "Overview",
      "Menu Performance",
      "Sales & Payments / VAT",
      "Cashier & Shifts",
      "Kitchen",
      "Staff Operations",
      "Inventory",
      "Guests / Tables",
      "Exceptions & Incidents",
      "Manager Decisions / Notes",
    ]) expect(audit).toContain(`| ${domain} |`);
    expect(audit).toContain("Managers do not inherit Owner reporting RPCs");
    expect(audit).toContain("R2 should implement one tenant-guarded, period-aware Manager reporting read model for Overview plus Sales & Payments/VAT only");
  });
});
