import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const waiterOrderSource = read("src/modules/waiter-order/pages/WaiterOrderPage.tsx");
const cartHookSource = read("src/modules/public-qr-ordering/hooks/usePublicQrCart.ts");

describe("waiter cart isolation", () => {
  it("starts every waiter table visit with an ephemeral empty cart", () => {
    expect(waiterOrderSource).toContain(
      'usePublicQrCart(restaurantSlug, `waiter:${tableNumber}`, { persist: false })',
    );
  });

  it("does not hydrate or save an ephemeral cart and removes legacy saved contents", () => {
    expect(cartHookSource).toContain(
      "persist ? readStoredCartItems(restaurantSlug, sessionKey) : []",
    );
    expect(cartHookSource).toContain("if (!persist)");
    expect(cartHookSource).toContain("window.localStorage.removeItem(storageKey)");
  });

  it("keeps persistence enabled by default for public QR carts", () => {
    expect(cartHookSource).toContain("const persist = options.persist ?? true");
  });
});
