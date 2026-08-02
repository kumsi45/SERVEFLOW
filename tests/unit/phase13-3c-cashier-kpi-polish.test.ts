import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const ui = read("src/modules/cashier/components/CashierDashboardUi.tsx");
const page = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const phase13_3cStart = styles.indexOf("Phase 13.3C");
const phase13_4Start = styles.indexOf("Phase 13.4");
const phaseStyles = styles.slice(phase13_3cStart, phase13_4Start);

describe("Phase 13.3C cashier KPI visual polish", () => {
  it("keeps the finalized five-card layout and calculations", () => {
    expect(phaseStyles).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
    expect(phaseStyles).toContain("height: 110px");
    expect(phaseStyles).toContain("min-height: 94px");
    expect(page).toContain("fmtMoney(cashCollectedToday)");
    expect(page).toContain("fmtMoney(digitalCollectedToday)");
    expect(page).toContain("fmtMoney(cashCollectedToday + digitalCollectedToday)");
  });

  it("uses the approved Inter hierarchy and separates currency from amount", () => {
    expect(ui).toContain('value.match(/^([A-Za-z]{3}|[^\\d\\s.,]+)\\s*(\\d.*)$/)');
    expect(ui).toContain("cd-kpi-currency");
    expect(ui).toContain("cd-kpi-amount");
    expect(phaseStyles).toContain("font-family: Inter");
    expect(phaseStyles).toContain("font-size: 11px");
    expect(phaseStyles).toContain("font-size: 14px");
    expect(phaseStyles).toContain("font-size: clamp(18px, 20cqi, 30px)");
    expect(phaseStyles).toContain("font-weight: 700");
  });

  it("uses calm surfaces, borders, radius, and shadow", () => {
    expect(phaseStyles).toContain("border: 1px solid #e5e7eb");
    expect(phaseStyles).toContain("border-radius: 16px");
    expect(phaseStyles).toContain("background: #fff");
    expect(phaseStyles).toContain("box-shadow: 0 1px 3px rgba(15, 23, 42, .04)");
    expect(phaseStyles).not.toContain("linear-gradient");
  });

  it("preserves icon-free cards and uses accents only for focus", () => {
    for (const accent of ["#2563eb", "#f59e0b", "#15803d", "#3b82f6", "#10b981"]) {
      expect(phaseStyles).toContain(accent);
    }
    expect(phaseStyles).not.toContain(".cd-kpi-icon");
    expect(phaseStyles).not.toContain(".cd-kpi-card::before");
    expect(phaseStyles).toContain("outline: 2px solid var(--cd-kpi-accent)");
  });

  it("provides the requested restrained hover and keyboard focus", () => {
    expect(phaseStyles).toContain("border-color: #15803d");
    expect(phaseStyles).toContain("background: #fafffc");
    expect(phaseStyles).toContain("120ms ease");
    expect(phaseStyles).toContain("transform: none");
    expect(ui).toContain("tabIndex={0}");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps labels readable instead of truncating them", () => {
    expect(phaseStyles).toContain("text-overflow: clip");
    expect(phaseStyles).toContain("white-space: normal");
    expect(phaseStyles).toContain("@media (min-width: 1200px) and (max-width: 1500px)");
    expect(page).toContain('label="Awaiting Collection"');
    expect(page).toContain('label="Cash Collected"');
  });
});
