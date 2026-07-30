import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const modern = readFileSync(resolve(process.cwd(), "src/modules/menu/theme-engine/themes/modern/modernFood.css"), "utf8");
const customization = readFileSync(resolve(process.cwd(), "src/modules/menu/theme-engine/customization/themeCustomization.css"), "utf8");
const component = readFileSync(resolve(process.cwd(), "src/modules/menu/theme-engine/themes/modern/ModernBottomNavigation.tsx"), "utf8");

describe("Modern digital menu bottom navigation visibility", () => {
  it("always renders both Home and Orders", () => {
    expect(component).toContain("<span>Home</span>");
    expect(component).toContain("<span>Orders</span>");
  });

  it("does not turn an inactive Orders tab white solely because an order exists", () => {
    expect(modern).toContain("button.has-order:not(.active)");
    expect(modern).not.toContain("button.has-order { color: #fff; }");
  });

  it("defines visible inactive and active colors on customized light menus", () => {
    expect(customization).toContain('[data-color-mode="light"] .modern-bottom-nav button');
    expect(customization).toContain("color: #6b5c52");
    expect(customization).toContain('[data-color-mode="light"] .modern-bottom-nav button.active');
  });

  it("preserves visible contrast in dark and automatic dark modes", () => {
    expect(customization).toContain('[data-color-mode="dark"] .modern-bottom-nav button');
    expect(customization).toContain('[data-color-mode="auto"] .modern-bottom-nav button');
    expect(customization).toContain("color: #cfc3b8");
  });
});
