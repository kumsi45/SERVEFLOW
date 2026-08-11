import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/modules/waiter-order/pages/WaiterOrderPage.tsx");
const styles = read("src/modules/waiter-order/styles/waiterOrder.css");
const menuHook = read("src/modules/qr-menu/hooks/useQRMenu.ts");

describe("waiter order phase A3 contract", () => {
  it("keeps the primary menu card image, name, price, and add-only", () => {
    expect(page).toContain("<WaiterMenuImage item={item} />");
    expect(page).toContain("<strong>{item.name}</strong>");
    expect(page).toContain("<b>{formatMenuPrice(Number(item.price))}</b>");
    expect(page).not.toContain("item.description");
    expect(page).not.toContain("Modifiers & Notes");
  });

  it("keeps notes and customer details secondary", () => {
    expect(page).toContain("+ Note");
    expect(page).toContain("+ Order Note");
    expect(page).toContain("setCustomerOpen(true)");
    expect(page).not.toContain('<label className="w93-field"><span>Customer</span>');
  });

  it("uses a mobile bottom summary instead of a forced sidebar", () => {
    expect(page).toContain('className="w93-mobile-summary"');
    expect(page).toContain("View Order");
    expect(styles).toContain(".w93-cart {\n    display: none;");
    expect(styles).toContain(".w93-mobile-summary {\n    position: fixed;");
  });

  it("guards duplicate send attempts before React state catches up", () => {
    expect(page).toContain("const submitLockedRef = useRef(false)");
    expect(page).toContain("if (submitLockedRef.current || submitting) return");
    expect(page).toContain("submitLockedRef.current = true");
  });

  it("reuses recent tenant menu data while refreshing availability", () => {
    expect(menuHook).toContain("const MENU_CACHE_TTL_MS = 30_000");
    expect(menuHook).toContain("const menuCache = new Map<string, CachedMenuState>()");
    expect(menuHook).toContain("fetchQRMenuData(restaurantSlug)");
  });
});
