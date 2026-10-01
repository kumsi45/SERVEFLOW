import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/owner/pages/OwnerReportsPage.tsx");
const menu = read("src/modules/owner/pages/OwnerMenuSalesReport.tsx");
const mainService = read("src/modules/owner/services/ownerReportsReadModel.ts");
const detailService = read("src/modules/owner/services/ownerReportDetails.ts");
const css = read("src/modules/owner/styles/ownerReports.css");
const migration = read("supabase/migrations/269_owner_reports_inventory_cashier_details.sql");
const performanceMigration = read("supabase/migrations/270_owner_reports_performance.sql");

describe("Owner Reports premium reporting workspace", () => {
  it("uses the dedicated route and authoritative reporting RPCs without raw React table reads", () => {
    expect(read("src/modules/owner/pages/OwnerDashboardPage.tsx")).toContain("<OwnerReportsPage ownerUserId={ownerUserId} restaurantId={restaurantId} />");
    expect(mainService).toContain('supabase.rpc("get_owner_reports_read_model"');
    expect(mainService).not.toMatch(/\.from\("(?:orders|order_invoices|order_items)"\)/);
    expect(detailService).toContain('supabase.rpc("get_owner_report_inventory_v2"');
    expect(detailService).toContain('supabase.rpc("get_owner_report_cashier_shifts_v2"');
  });

  it("provides the required report order with desktop and mobile navigation", () => {
    const labels = ["Overview", "Sales & Payments", "Menu Performance", "Orders & Tables", "Staff Operations", "Kitchen", "Cashier & Shifts", "Inventory", "Customer Feedback"];
    let previous = -1;
    for (const label of labels) { const next = page.indexOf(`label:\"${label}\"`); expect(next).toBeGreaterThan(previous); previous = next; }
    expect(page).toContain('className="od-reports-tabs"');
    expect(page).toContain('className="od-reports-mobile-select"');
    expect(page).toContain("aria-current={activeTab===tab.id?\"page\":undefined}");
    expect(css).toMatch(/@media \(max-width: 768px\)/);
    expect(css).toMatch(/\.od-reports-tabs \{ display: none; \}/);
    expect(page).toContain("icon:WalletCards");
    expect(page).toContain("icon:Package");
  });

  it("preserves server period arguments, custom apply behavior, refresh, and request identity protection", () => {
    expect(page).toContain("loadOwnerReportsReadModel(restaurantId,query.period,query.start,query.end)");
    expect(page).toContain('period===\"custom\"?appliedCustom.start:null');
    expect(page).toContain('period===\"custom\"?appliedCustom.end:null');
    expect(page).toContain("mainGeneration.current");
    expect(page).toContain("detailGeneration.current");
    expect(page).toContain("busy.current.has(busyKey)");
    for (const label of ["Today", "Yesterday", "Week", "Month", "Custom"]) expect(page).toContain(`label:\"${label}\"`);
    expect(page).toContain("aria-pressed={period===option.value}");
    expect(page).toContain('aria-label="Select report period"');
    expect(page).toContain('className="od-reports-date-control"');
    expect(page).toContain('aria-label="Refresh reports"');
  });

  it("starts with one compact control toolbar and removes repeated page identity metadata", () => {
    expect(page).toContain('className="od-reports-toolbar"');
    expect(page.indexOf('className="od-reports-toolbar"')).toBeLessThan(page.indexOf('className="od-reports-tabs"'));
    expect(page).not.toContain("Business intelligence");
    expect(page).not.toContain("Restaurant performance and business activity.");
    expect(page).not.toContain("Restaurant timezone");
    expect(css).not.toContain(".od-reports-hero");
    expect(css).not.toContain(".od-reports-period-context");
  });

  it("uses factual Owner language and avoids unsupported judgments or accounting claims", () => {
    for (const value of ["Money Collected", "Orders Started", "Attention Required", "Highest Sales by Table", "Team Activity", "Cash Difference", "Waste / Spoilage"]) expect(page).toContain(value);
    for (const value of ["Profit", "Best Employee", "Worst Employee", "Productivity Score", "Most Profitable", "Attendance", "Unit Price", "VAT"]) expect(page).not.toContain(value);
    expect(menu).toContain("it differs from Money Collected");
    expect(page).toContain("Quantities are shown in their own units");
  });

  it("keeps expensive details lazy, retryable, isolated, and paginated where supported", () => {
    expect(page).toContain('activeTab===\"feedback\"&&!feedback');
    expect(page).toContain('activeTab===\"inventory\"&&!inventory');
    expect(page).toContain('activeTab===\"cashier\"&&!cashier');
    expect(page).toContain("detailError[activeTab]");
    expect(page).toContain("onRetry={()=>void loadDetail(activeTab)}");
    expect(page).toContain("onMore={()=>void loadDetail(activeTab,true)}");
    expect(menu).toContain("generation.current");
    expect(menu).toContain("busy.current");
    expect(page).not.toContain('activeTab==="overview"){if(!inventory)');
    expect(page).toContain('loadInventoryMore=async');
    expect(page).toContain('loadCashierMore=async');
    expect(menu).toContain("resource: 'reports-menu'");
    expect(menu).toContain("slice(0, soldLimit)");
  });

  it("adds fixed-search-path Owner-only inventory and cashier contracts with explicit grants", () => {
    expect(migration).toContain("perform public._owner_reports_assert_owner(target_restaurant_id)");
    expect(migration.match(/set search_path = pg_catalog, public/g)).toHaveLength(2);
    expect(migration).toContain("public._owner_reports_resolve_period");
    expect(migration).toContain("revoke all on function public.get_owner_report_inventory");
    expect(migration).toContain("revoke all on function public.get_owner_report_cashier_shifts");
    expect(migration).toContain("grant execute on function public.get_owner_report_inventory");
    expect(migration).toContain("grant execute on function public.get_owner_report_cashier_shifts");
    expect(migration).not.toContain("grant execute on function public.get_owner_report_inventory(uuid,text,date,date) to anon");
    expect(performanceMigration).toContain("get_owner_report_inventory_v2");
    expect(performanceMigration).toContain("get_owner_report_cashier_shifts_v2");
    expect(performanceMigration.match(/set search_path = pg_catalog, public/g)).toHaveLength(2);
    expect(performanceMigration).toContain("limit page_size+1");
    expect(performanceMigration).toContain("m.movement_type::text not in ('waste','spoilage')");
  });

  it("has compact empty states, responsive record cards, focus states, and Advisor-safe bottom space", () => {
    for (const width of ["1100px", "768px", "640px"]) expect(css).toContain(`max-width: ${width}`);
    expect(css).toContain(":focus-visible");
    expect(css).toContain("padding-bottom: 9rem");
    expect(css).toContain("content: attr(data-label)");
    expect(page).toContain("No inventory movements were recorded during this period.");
    expect(page).toContain("No customer feedback was received during this period.");
  });

  it("centralizes restrained domain identities and modern report typography", () => {
    for (const token of ["--report-overview", "--report-sales", "--report-menu", "--report-orders", "--report-staff", "--report-kitchen", "--report-cashier", "--report-inventory", "--report-feedback"]) expect(css).toContain(token);
    expect(css).toContain("font-family: Inter, ui-sans-serif");
    expect(css).toContain("font-size: clamp(1.625rem, 2.2vw, 2rem)");
    expect(css).not.toContain('font-family: Georgia');
    expect(css).toContain(".od-reports-attention-panel");
  });

  it("uses dedicated compact mobile controls without duplicating period state", () => {
    expect(page).toContain('className="od-reports-mobile-period"');
    expect(page).toContain('value={period} onChange={(event)=>setPeriod');
    expect(css).toContain("grid-template-columns: minmax(88px, .8fr) minmax(0, 1.4fr) 40px");
    expect(css).toContain(".od-reports-refresh span { display: none; }");
    expect(css).toContain("z-index: 40");
  });
});
