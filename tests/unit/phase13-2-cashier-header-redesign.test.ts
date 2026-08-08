import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const styles = read("src/modules/cashier/styles/cashierDashboard.css");
const ui = read("src/modules/cashier/components/CashierDashboardUi.tsx");
const phase13_2Start = styles.indexOf("Phase 13.2");
const phase13_3Start = styles.indexOf("Phase 13.3");
const phaseStyles = styles.slice(phase13_2Start, phase13_3Start);

describe("Phase 13.2 cashier hospitality POS header", () => {
  it("is isolated from the other cashier workspaces", () => {
    expect(phaseStyles).toContain("premium hospitality POS top header");
    expect(phaseStyles).not.toContain(".cd-pos-nav");
    expect(phaseStyles).not.toContain(".cd-kpi");
    expect(phaseStyles).not.toContain(".cd-operational");
    expect(phaseStyles).not.toContain(".cd-location-switch");
    expect(phaseStyles).not.toContain(".cd-drawer");
  });

  it("keeps the brand, centered search, actions, and existing handlers", () => {
    for (const value of ["ServeFlow", "Search", "Shift Duration", "Notifications", "Sign Out"]) {
      expect(ui).toContain(value);
    }
    expect(ui).not.toContain("Terminal");
    expect(ui).not.toContain('className="cd-terminal-info"');
    expect(ui).not.toContain('className="cd-cashier-avatar"');
    expect(ui).toContain("onSearchChange(event.target.value)");
    expect(ui).toContain("onClick={onNotifications}");
    expect(ui).toContain("onClick={onShiftAction}");
    expect(ui).toContain("onClick={onSignOut}");
    expect(ui.match(/className="cd-header-shift-time"/g)).toHaveLength(1);
    expect(ui.indexOf('className="cd-header-shift-time"')).toBeLessThan(
      ui.indexOf('className="cd-header-right"'),
    );
  });

  it("uses a calm single-row 76px POS header", () => {
    expect(phaseStyles).toContain("--cd-header-height: 76px");
    expect(phaseStyles).toContain("position: fixed");
    expect(phaseStyles).toContain("grid-template-columns: minmax(0, 1fr) minmax(360px, 760px) minmax(0, 1fr)");
    expect(phaseStyles).toContain("justify-content: center");
    expect(phaseStyles).toContain("padding: 12px 24px");
    expect(phaseStyles).toContain("border-bottom: 1px solid #e4e9e6");
  });

  it("makes search the flexible visual center", () => {
    expect(ui).toContain("Search table, customer, invoice or phone...");
    expect(phaseStyles).toContain("width: 100%");
    expect(phaseStyles).toContain("flex: 1 1 auto");
    expect(phaseStyles).toContain("min-height: 52px");
    expect(phaseStyles).toContain("border-radius: 16px");
    expect(phaseStyles).toContain('content: "Ctrl + K"');
    expect(phaseStyles).toContain("font-size: 16px");
  });

  it("uses compact shift, notification, and user controls", () => {
    for (const icon of ['name="clock"', 'name="bell"', 'name="door"', 'name="logout"']) {
      expect(ui).toContain(icon);
    }
    expect(ui).not.toContain('name="terminal"');
    expect(phaseStyles).toContain("min-width: 118px");
    expect(phaseStyles).toContain("width: 48px");
    expect(phaseStyles).toContain("border: 1px solid #e9aaa4");
    expect(phaseStyles).toContain("animation: cd-header-notification-pulse");
  });

  it("collapses profile detail before wrapping at narrower desktop widths", () => {
    expect(phaseStyles).toContain("@media (min-width: 1024px) and (max-width: 1500px)");
    expect(phaseStyles).toContain(".cd-header-cashier { display: none; }");
    expect(phaseStyles).toContain("@media (min-width: 1024px) and (max-width: 1180px)");
  });

  it("provides short microinteractions and accessible focus", () => {
    expect(phaseStyles).toContain("120ms ease");
    expect(phaseStyles).toContain("transform: scale(.98)");
    expect(phaseStyles).toContain("button:focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
