import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const css = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");

describe("Owner Tables Phase 2A workspace", () => {
  it("removes the redundant technical headings and permanent QR URL presentation", () => {
    expect(page).not.toContain("QR & Table Management");
    expect(page).not.toContain("Business Tables");
    expect(page).not.toContain('className="od-qr-url"');
    expect(page).not.toContain("Created Date");
    expect(page).not.toContain("Last Regenerated");
    expect(page).not.toContain("Scan Count");
  });

  it("uses canonical occupancy and keeps disabled occupied distinct from available", () => {
    expect(page).toContain("getOccupiedOwnerTableIds(orders, restaurantId)");
    expect(page).toContain('"Disabled · Occupied"');
    expect(page).toContain('statusFilter === "available" && !row.occupied && !row.disabled');
  });

  it("renders a compact summary, toolbar, and the owner-level desktop columns", () => {
    for (const value of ["od-tables-summary", "Tables", "Occupied", "Available", "Disabled", "Search tables", "Print QR", "Orders Today", "Last Activity"]) expect(page).toContain(value);
    expect(page).not.toContain("Print Selected");
    expect(page).not.toContain("Print All Tables");
  });

  it("keeps QR readiness safe and actions reachable behind an accessible menu", () => {
    expect(page).toContain("qrReady: Boolean(restaurantTable.qr_path || restaurantTable.qr_url)");
    expect(page).toContain('aria-label={`Actions for ${table.label}`}');
    expect(page).toContain('aria-haspopup="menu"');
    expect(page).toContain("View QR");
    expect(page).toContain("Regenerate QR");
  });

  it("uses native mobile rows rather than a horizontally scrolling desktop table", () => {
    expect(page).toContain("od-tables-mobile-list");
    expect(css).toContain(".od-qr-experience .od-tables-desktop-list{display:none}");
    expect(css).toContain(".od-qr-experience .od-tables-mobile-list{display:grid");
    expect(css).not.toContain(".od-tables-table{width:100%;min-width");
  });
});
