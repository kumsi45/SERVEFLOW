import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const layout = read("src/modules/manager/components/ManagerLayout.tsx");
const styles = read("src/modules/manager/styles/managerLayout.css");

describe("Manager sidebar icon system", () => {
  it("uses Lucide consistently for every manager navigation destination", () => {
    expect(layout).toContain('from "lucide-react"');
    for (const mapping of [
      'href: "/manager/dashboard", icon: Home',
      'href: "/manager/tables", icon: Activity',
      'href: "/manager/kitchen", icon: CookingPot',
      'href: "/manager/staff", icon: Users',
      'href: "/manager/customers", icon: Heart',
      'href: "/manager/reports", icon: BarChart3',
      'href: "/manager/intelligence", icon: Gem',
      'href: "/manager/recipes", icon: BookOpen',
      'href: "/manager/menu", icon: UtensilsCrossed',
      'href: "/manager/inventory", icon: Package',
    ]) expect(layout).toContain(mapping);
  });

  it("removes text abbreviations and symbolic icon glyphs", () => {
    for (const removed of ['icon: "RC"', 'icon: "MN"', 'icon: "IN"', 'icon: "⌂"', 'icon: "✦"']) expect(layout).not.toContain(removed);
    expect(layout).toContain('<Icon strokeWidth={1.9} />');
  });

  it("uses the same icon container and geometry on desktop and mobile", () => {
    expect(layout.match(/className="ml-nav-icon"/g)?.length).toBe(3);
    expect(styles).toContain(".ml-nav-icon svg");
    expect(styles).toContain("width: 17px");
    expect(styles).toContain("height: 17px");
    expect(styles).toContain(".ml-bottom-nav .is-active .ml-nav-icon");
    expect(styles).toContain("background: var(--manager-primary)");
  });
});
