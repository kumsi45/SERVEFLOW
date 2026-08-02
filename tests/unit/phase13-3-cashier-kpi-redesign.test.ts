import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const ui = read("src/modules/cashier/components/CashierDashboardUi.tsx");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const phase13_3Start = styles.indexOf("Phase 13.3");
const phase13_4Start = styles.indexOf("Phase 13.4");
const phaseStyles = styles.slice(phase13_3Start, phase13_4Start);

describe("Phase 13.3 cashier operational KPI summary", () => {
  it("isolates the redesign to the KPI summary", () => {
    expect(phaseStyles).toContain("compact hospitality POS operational summary");
    expect(phaseStyles).not.toContain(".cd-header");
    expect(phaseStyles).not.toContain(".cd-pos-nav");
    expect(phaseStyles).not.toContain(".cd-operational");
    expect(phaseStyles).not.toContain(".cd-location-switch");
    expect(phaseStyles).not.toContain(".cd-drawer");
  });

  it("keeps the five existing values and calculations", () => {
    for (const label of [
      "Active Orders",
      "Awaiting Collection",
      "Cash Collected",
      "Digital Collected",
      "Total Collected",
    ]) expect(page).toContain(label);
    expect(page).toContain("activeDiningSessions.length");
    expect(page).toContain("awaitingCollection.length");
    expect(page).toContain("fmtMoney(cashCollectedToday)");
    expect(page).toContain("fmtMoney(digitalCollectedToday)");
    expect(page).toContain("fmtMoney(cashCollectedToday + digitalCollectedToday)");
  });

  it("uses one compact five-card row", () => {
    expect(phaseStyles).toContain("width: 100%");
    expect(phaseStyles).toContain("grid-column: auto");
    expect(phaseStyles).toContain("height: 110px");
    expect(phaseStyles).toContain("min-height: 94px");
    expect(phaseStyles).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
    expect(phaseStyles).toContain("gap: 16px");
    expect(phaseStyles).toContain("border-radius: 16px");
  });

  it("uses clean white cards without decorative icons or accent lines", () => {
    expect(phaseStyles).toContain("background: #fff");
    expect(phaseStyles).toContain("border: 1px solid #e5e7eb");
    expect(phaseStyles).not.toContain(".cd-kpi-card::before");
    expect(phaseStyles).not.toContain(".cd-kpi-icon");
    expect(page).not.toContain('icon="total"');
  });

  it("uses a clear text hierarchy and contextual helper text", () => {
    expect(ui).toContain("cd-kpi-detail");
    expect(phaseStyles).toContain("font-size: 11px");
    expect(phaseStyles).toContain("font-size: clamp(18px, 20cqi, 30px)");
    expect(phaseStyles).toContain("font-size: 12px");
    expect(phaseStyles).toContain("white-space: nowrap");
  });

  it("keeps motion lightweight and prevents narrow desktop wrapping", () => {
    expect(phaseStyles).toContain("transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease");
    expect(phaseStyles).toContain("transform: none");
    expect(phaseStyles).toContain("@media (min-width: 1024px) and (max-width: 1500px)");
    expect(phaseStyles).toContain(".cd-kpi-detail { display: none; }");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("adds screen-reader context without changing card behavior", () => {
    expect(page).toContain('aria-label="Operational summary"');
    expect(ui).toContain('aria-label={`${label}: ${value}`}');
    expect(ui).toContain("<article");
    expect(ui).not.toContain("animated-counter");
  });
});
