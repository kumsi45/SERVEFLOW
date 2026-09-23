import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/owner/pages/OwnerReportsPage.tsx");
const service = read("src/modules/owner/services/ownerReportsReadModel.ts");
const ownerDashboard = read("src/modules/owner/pages/OwnerDashboardPage.tsx");

describe("Owner Reports R4 authoritative workspace", () => {
  it("mounts the dedicated R3-backed Reports surface", () => {
    expect(ownerDashboard).toContain('<OwnerReportsPage restaurantId={restaurantId} />');
    expect(service).toContain('supabase.rpc("get_owner_reports_read_model"');
    expect(service).not.toContain('.from("orders")');
    expect(service).not.toContain('.from("order_invoices")');
    expect(service).not.toContain('.from("order_items")');
    expect(service).toContain('row.periodCompleteness');
    expect(service).toContain('row.limitations');
    expect(service).toContain('string(row.key, "Report period")');
  });

  it("keeps details lazy and preserves exact backend period arguments", () => {
    expect(page).toContain('loadOwnerReportsReadModel(restaurantId, query.period, query.start, query.end)');
    expect(page).toContain('loadOwnerReportFeedbackPage(restaurantId, query.period, query.start, query.end');
    expect(page).toContain('loadOwnerReportStaffOperationsPage(restaurantId, query.period, query.start, query.end');
    expect(page).toContain('period === "custom" ? appliedCustom.start : null');
    expect(page).toContain('period === "custom" ? appliedCustom.end : null');
    expect(page).toContain('onOpenFeedback={() => void openDetail("feedback")}');
    expect(page).toContain('onOpenStaff={() => void openDetail("staff")}');
  });

  it("uses owner-first language and a clear report hierarchy", () => {
    for (const expected of ["Money Collected", "Payments collected", "Orders Started", "Average payment collected", "Needs attention", "Facts to review", "Sales history", "Menu performance", "Staff activity", "Kitchen performance", "Payments & cash", "Customer feedback", "Cash handovers", "No sales or orders were recorded in this period."]) expect(page).toContain(expected);
    for (const removed of ["Profit", "Worst Items", "Staff Performance", "Customer Growth", "Executive Briefing", "AI BUSINESS INSIGHTS", "Hours Worked", "Attendance", "Most Profitable Table", "Hourly Revenue"]) expect(page).not.toContain(removed);
  });

  it("keeps attention and trends tied to supported R3 facts", () => {
    expect(page).toContain("function attentionItems(model: OwnerReportsReadModel)");
    for (const supportedFact of ["refundCount", "unknownCount", "untimedItems", "legacyUnattributedItemCount", "comparisonSentence(model)"]) expect(page).toContain(supportedFact);
    expect(page).toContain('aria-label={`Money collected across ${buckets.length} report periods`}');
    expect(page).not.toContain("ordersY");
  });

  it("contains isolated retryable detail sheets and mobile-safe controls", () => {
    expect(service).toContain('Couldn’t load feedback. Try again.');
    expect(service).toContain('Couldn’t load staff operations. Try again.');
    expect(page).toContain('onClick={onMore}');
    expect(page).toContain('event.key === "Escape"');
    expect(read("src/modules/owner/styles/ownerReports.css")).toContain('@media(max-width:640px)');
  });

  it("keeps period controls accessible and the compact mobile layout deliberate", () => {
    for (const label of ["Today", "Yesterday", "Week", "Month", "Custom"]) expect(page).toContain(`label: "${label}"`);
    expect(page).toContain("aria-pressed={period === option.value}");
    const css = read("src/modules/owner/styles/ownerReports.css");
    expect(css).toContain(".od-reports-periods{width:100%;overflow:auto");
    expect(css).toContain(".od-reports-sheet{width:100%;height:min(88dvh,720px)");
  });
});
