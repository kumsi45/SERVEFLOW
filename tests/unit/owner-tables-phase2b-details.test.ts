import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const css = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");

describe("Owner Tables Phase 2B details", () => {
  it("opens a contextual accessible details dialog from table identity", () => {
    expect(page).toContain("od-table-details-trigger");
    expect(page).toContain('aria-labelledby="od-table-details-title"');
    expect(page).toContain("useModalFocus(Boolean(selectedRow)");
  });

  it("keeps canonical state concepts separate and unavailable values truthful", () => {
    expect(page).toContain('selectedRow.occupied ? "Occupied" : "Available"');
    expect(page).toContain('selectedRow.disabled ? "Disabled" : "Enabled"');
    expect(page).toContain('selectedRow.ordersToday ?? "Unavailable"');
    expect(page).toContain('selectedRow.lastScanAt ?');
  });

  it("keeps QR visual and on demand, never displaying its capability as text", () => {
    expect(page).toContain("openQrPreview(selectedRow.table)");
    expect(page).toContain("if (!previewTable || !previewUrl)");
    expect(page).not.toContain('className="od-qr-url"');
  });

  it("uses existing owner authority behind deliberate confirmations", () => {
    expect(page).toContain('kind: "replace" | "active"');
    expect(page).toContain("Replace QR Code?");
    expect(page).toContain("Printed copies must be replaced");
    expect(page).toContain('"regenerate_restaurant_table_qr"');
    expect(page).toContain('"set_restaurant_table_active"');
    expect(page).toContain("if (workingTableId) return");
  });

  it("uses a desktop drawer and a mobile bottom sheet without a new route", () => {
    expect(css).toContain(".od-table-details-layer{position:fixed");
    expect(css).toContain(".od-table-details{width:min(410px,100%)");
    expect(css).toContain("height:min(88dvh,760px)");
    expect(page).not.toContain("/owner/tables/");
  });
});
