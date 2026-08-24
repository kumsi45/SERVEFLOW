import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const layout = read("src/modules/manager/components/ManagerLayout.tsx");
const styles = read("src/modules/manager/styles/managerLayout.css");

describe("Manager mobile navigation finalization", () => {
  it("keeps exactly four primary destinations in the mobile bottom bar", () => {
    expect(layout).toContain(
      '["dashboard", "tables", "kitchen", "staff"].includes(item.key)',
    );
    for (const label of ["Dashboard", "Operations", "Kitchen", "Staff"]) {
      expect(layout).toContain(`mobileLabel: "${label}"`);
    }
    expect(layout).toContain("MOBILE_PRIMARY_NAV.map");
  });

  it("keeps the six secondary destinations exclusively in the mobile drawer", () => {
    expect(layout).toContain(
      '["customers", "reports", "intelligence", "recipes", "menu", "inventory"].includes(item.key)',
    );
    expect(layout).toContain("MOBILE_SECONDARY_NAV.map");
    expect(layout).not.toContain("MOBILE_NAV.map");
  });

  it("preserves one ten-destination desktop sidebar and shared destination icons", () => {
    expect(layout).toContain("MANAGER_NAV.map");
    expect(layout).toContain("ml-desktop-sidebar");
    expect(layout.match(/<Icon strokeWidth=\{1\.9\} \/>/g)).toHaveLength(3);
  });

  it("places a focus-managed hamburger drawer at the mobile header edge", () => {
    expect(layout).toContain("useModalFocus(");
    expect(layout).toContain('aria-label="Open navigation"');
    expect(layout).toContain('aria-controls="manager-mobile-navigation"');
    expect(layout).toContain('aria-label="Secondary Manager navigation"');
    expect(layout).toContain("setMobileMenuOpen(false)");
    expect(styles).toMatch(/\.ml-mobile-drawer \{[\s\S]*?right: 0;/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.ml-menu-button \{[\s\S]*?position: static;/);
  });

  it("keeps secondary routes from falsely activating a primary item", () => {
    expect(layout).toContain('className={activeSection === item.key ? "is-active" : ""}');
    expect(layout).toContain('section === "cashier" || section === "tables" ? "tables" : section');
    expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
  });

  it("reserves content space and safe-area padding for the persistent bar", () => {
    expect(styles).toContain("padding-bottom: calc(92px + env(safe-area-inset-bottom))");
    expect(styles).toContain("min-height: calc(66px + env(safe-area-inset-bottom))");
    expect(styles).toContain("env(safe-area-inset-bottom)");
  });
});
