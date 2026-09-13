import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const css = readFileSync("src/modules/owner/styles/ownerDashboard.css", "utf8");

describe("Owner Tables Phase 2C QR Print Center", () => {
  it("opens from the sole Tables print action with the recommended six-card default", () => {
    expect(page).toContain("setPrintCenterOpen(true)");
    expect(page).toContain('useState<QrPrintFormat>("compact")');
    expect(page).toContain('compact: { cardsPerPage: 6');
    expect(page).toContain("6 per page — Recommended");
  });

  it("keeps selection tenant-local, numeric, unique, and truthful about unavailable QR codes", () => {
    expect(page).toContain("rows.filter((row) => row.table.active && row.qrReady");
    expect(page).toContain("sort((a, b) => a.table.table_number - b.table.table_number)");
    expect(page).toContain("QR unavailable");
    expect(page).toContain("currently disabled");
    expect(page).toContain("will not print");
  });

  it("generates QR images only in an open print-center session and never mutates QR authority", () => {
    const center = page.slice(page.indexOf("function QrPrintCenter"), page.indexOf("function QrTablesPage"));
    expect(center).toContain("QRCode.toDataURL");
    expect(center).not.toContain("regenerate_restaurant_table_qr");
    expect(center).not.toContain("set_restaurant_table_active");
    expect(center).not.toMatch(/qr_token|qr_path.*visible|orderingUrl}\s*</);
  });

  it("uses A4 print units, paginates cards, and excludes owner controls from print output", () => {
    const center = page.slice(page.indexOf("function QrPrintCenter"), page.indexOf("function QrTablesPage"));
    expect(center).toContain("@page{size:A4 portrait;margin:10mm}");
    expect(center).toContain("page-break-after:always");
    expect(center).toContain("break-inside:avoid");
    expect(center).toContain("Scan to view menu &amp; order");
    expect(center).not.toContain("Replace QR Code");
  });

  it("provides a responsive modal/sheet with print-safe preview geometry", () => {
    expect(css).toContain(".od-print-center-layer{position:fixed");
    expect(css).toContain("aspect-ratio:210/297");
    expect(css).toContain("@media(max-width:760px){.od-print-center-layer{align-items:end");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});
