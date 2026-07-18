import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("authentication and tenant isolation contracts", () => {
  it("isolates staff auth by browser tab instead of shared localStorage", () => {
    const source = read("src/core/database/supabaseClient.ts");
    expect(source).toContain("serveflow.staff-tab-id");
    expect(source).toContain("createBrowserUuid()");
    expect(source).toContain("sessionStorage.getItem");
    expect(source).toContain("serveflow-staff-auth:${staffTabId}");
    expect(source).not.toContain("localStorage.getItem(key)");
  });

  it("keeps every active restaurant selection inside its role and tab", () => {
    const source = read("src/app/router/RoleNamespaceRoute.tsx");
    expect(source).toContain("serveflow.active-restaurant:${namespace}");
    expect(source).toContain("window.sessionStorage");
    expect(source).not.toContain("window.localStorage");
  });

  it("binds waiter authentication and offline orders to one restaurant", () => {
    const auth = read("src/modules/waiter-auth/services/waiterAuthService.ts");
    expect(auth).toContain("serveflow-waiter-auth:${waiterTabId}");
    expect(auth).toContain('.eq("restaurant_id", identity.restaurant_id)');
    expect(auth).toContain('.eq("user_id", authData.user.id)');
    expect(auth).toContain('.eq("role", "waiter")');
    expect(auth).toContain('.eq("active", true)');
    const queue = read("src/modules/waiter-order/services/waiterOrderService.ts");
    expect(queue).toContain("order-queue.v2:${restaurantSlug.trim().toLowerCase()}");
  });

  it("never clears another restaurant's QR browser state", () => {
    const source = read("src/modules/public-qr-ordering/services/publicQrContext.ts");
    expect(source).toContain('QR_ACTIVE_SESSION_STORAGE_PREFIX = "serveflow.publicQrActiveSessionKey"');
    expect(source).toContain("${QR_ACTIVE_SESSION_STORAGE_PREFIX}:${restaurantSlug}");
    expect(source).toContain("belongsToRestaurant");
    expect(source).not.toContain("key.startsWith(`${prefix}:`)");
  });

  it("contains no PostgreSQL format calls in the migration chain", () => {
    const legacy = read("supabase/migrations/094_phase_o102_ai_business_intelligence.sql");
    const canonical = read("supabase/migrations/139_canonical_historical_analytics.sql");
    const fix = read("supabase/migrations/143_phase6_safe_ai_insight_formatting.sql");
    expect(`${legacy}\n${canonical}\n${fix}`).not.toMatch(/\bformat\s*\(/i);
  });
});
