import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "src/modules/owner/pages/OwnerDashboardPage.tsx",
  "utf8",
);
const styles = readFileSync(
  "src/modules/owner/styles/ownerDashboard.css",
  "utf8",
);
const home = page.slice(
  page.indexOf("function OwnerHomeOverview"),
  page.indexOf("function RevenueBars"),
);

describe("Owner Home redesign", () => {
  it("uses the approved information hierarchy", () => {
    const headings = [
      "Today&apos;s Revenue",
      "Money to Watch",
      "Business Health",
      "Today vs Yesterday",
      "Recent Activity",
    ];

    let previousIndex = -1;
    for (const heading of headings) {
      const index = home.indexOf(heading);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it("collects revenue only from paid invoices and keeps the split consolidated", () => {
    expect(page).toContain('.from("order_invoices")');
    expect(page).toContain('.eq("payment_status", "paid")');
    expect(page).toContain("loadOwnerHomeComparisonPayments");
    expect(home).toContain('payment.payment_status === "paid"');
    expect(home).toContain('canonicalPaymentMethod(payment.payment_method) === "Cash"');
    expect(home).toContain("const digitalRevenue = today.revenue - cashRevenue");
    expect(home.match(/Today&apos;s Revenue/g)).toHaveLength(1);
    expect(home.match(/<span>Orders<\/span>/g)).toHaveLength(1);
    expect(home.match(/<span>Avg\. order<\/span>/g)).toHaveLength(1);
    expect(home).not.toContain("Payment summary");
    expect(home).not.toContain("Latest payments");
    expect(home).not.toContain("Today&apos;s Performance");
  });

  it("drives Payment Due from the canonical tenant-scoped obligation RPC", () => {
    expect(page).toContain('"get_restaurant_unresolved_obligations"');
    expect(page).toContain("{ target_restaurant_id: restaurantId }");
    expect(home).toContain("data.unresolvedObligations.length");
    expect(home).toContain("sum + obligation.amount_due");
    expect(home).not.toContain('operational_status === "new"');
    expect(home).not.toContain("Pending payments");
    expect(home.match(/Payment due/g)).toHaveLength(1);
    expect(home).toContain("All settled");
  });

  it("removes shortcuts and fabricated alert categories from rendered Home", () => {
    expect(page).not.toMatch(/Quick actions|Quick Actions/);
    expect(page).not.toMatch(/Latest payments|Latest Payments/);
    expect(home).not.toContain("Quick actions");
    expect(home).not.toContain("Latest payments");
    expect(home).not.toContain("Inventory");
    expect(home).not.toMatch(/Normal|Delayed/);
  });

  it("distinguishes confirmed zero values from unavailable data", () => {
    expect(home).toContain('financialAvailable ? fmtMoney(value) : "Unavailable"');
    expect(home).toContain("data.obligationsError");
    expect(home).toContain("Could not confirm unresolved bills.");
    expect(home).toContain("Daily comparison is unavailable");
  });

  it("uses truthful business-health facts without inferring health states", () => {
    expect(home).toContain('order.dining_session_status === "open"');
    expect(home).toContain("data.restaurantTables.filter");
    expect(home).toContain("No active orders");
    expect(page).toContain("member.staff_session_active === true");
    expect(page).toContain("member.waiter_session_active === true");
  });

  it("uses matching timezone windows for the Today vs Yesterday comparison", () => {
    expect(page).toContain('analyticsWindow("yesterday", timezone)');
    expect(page).toContain('.gte("paid_at", yesterday.rangeStart)');
    expect(page).toContain('.lt("paid_at", today.rangeEnd)');
    expect(page).toContain('.eq("restaurant_id", restaurantId)');
    expect(home).toContain("yesterdayComparableEnd");
    expect(home).toContain("Yesterday by now");
    expect(home).toContain('current === 0 ? "No change" : "New today"');
    expect(home).toContain("comparisonLabel(today.revenue, yesterday.revenue)");
  });

  it("limits activity to meaningful events from today", () => {
    expect(home).toContain("payment verified");
    expect(home).toContain("data.completedToday");
    expect(home).toContain("occurredAt >= todayRange.rangeStart");
    expect(home).toContain(".slice(0, 3)");
    expect(home).toContain("No recent activity today");
    expect(home).not.toContain("recentOrders");
  });

  it("keeps mobile Home compact and preserves the approved navigation", () => {
    expect(styles).toContain(".od-home-layout");
    expect(styles).toContain(".od-owner-home-refined");
    expect(home).toContain('className="od-home-business-name"');
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.od-owner-home-refined \.od-home-header p\.od-home-business-name \{[\s\S]*?display: none/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.od-owner-home-refined \{[\s\S]*?env\(safe-area-inset-bottom\)/,
    );
    for (const label of ["Home", "Orders", "Tables", "Finance", "Menu"]) {
      expect(page).toContain(`label: "${label}"`);
    }
  });
});
