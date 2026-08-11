import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve(
    process.cwd(),
    "src/modules/manager/pages/ManagerDashboardPage.tsx",
  ),
  "utf8",
);
const styles = readFileSync(
  resolve(
    process.cwd(),
    "src/modules/manager/styles/managerDashboard.css",
  ),
  "utf8",
);

describe("manager overview command center", () => {
  it("uses the required hierarchy and exactly six shift KPIs", () => {
    for (const heading of [
      "Shift Pulse",
      "Needs Attention",
      "Live Service Locations",
      "Recent Activity",
    ]) {
      expect(page).toContain(heading);
    }
    for (const metric of [
      "Sales Today",
      "Active Orders",
      "Payment Due",
      "Occupied Service Locations",
      "Kitchen Load",
      "Staff on Shift",
    ]) {
      expect(page).toContain(`label: "${metric}"`);
    }
    expect(page.match(/label: "/g)).toHaveLength(6);
    expect(page).not.toContain('className="md-overview-header"');
  });

  it("removes the former quick actions and oversized copilot surfaces", () => {
    expect(page).not.toContain("Quick Actions");
    expect(page).not.toContain("AI Operations Copilot");
    expect(page).not.toContain("Open Operations Copilot");
    expect(page).toContain('className="md-ai-entry"');
  });

  it("keeps available location cards free from synthetic session details", () => {
    expect(page).toContain('const isAvailable = visualStatus === "available"');
    expect(page).toContain(
      '!isAvailable && visualStatus !== "cleaning" &&',
    );
    expect(page).not.toContain("<small>Guests</small>");
    expect(page).not.toContain("table.seats");
  });

  it("preserves the current snapshot, realtime, filtering, and detail paths", () => {
    expect(page).toContain("fetchManagerDashboardSnapshot(restaurantId)");
    expect(page).toContain('channelName: "manager-dashboard"');
    expect(page).toContain("setSelectedTableId(table.id)");
    expect(page).toContain('role="dialog"');
    expect(page).toContain('aria-label="Close service location details"');
  });

  it("defines the 70/30 desktop rail and responsive collapse", () => {
    expect(styles).toContain(
      "grid-template-columns: minmax(0, 7fr) minmax(270px, 3fr)",
    );
    expect(styles).toContain(
      "grid-template-columns: minmax(0, 13fr) minmax(250px, 7fr)",
    );
    expect(styles).toMatch(
      /@media \(max-width: 1023px\)[\s\S]*?\.md-overview \.md-main-grid \{\s*grid-template-columns: 1fr;/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1023px\)[\s\S]*?\.md-overview \.md-kpis \{\s*grid-template-columns: repeat\(2/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.md-overview \.md-table-grid \{\s*grid-template-columns: repeat\(2/,
    );
  });
});
