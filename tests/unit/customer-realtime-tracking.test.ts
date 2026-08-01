import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscribeCustomerTrackingEvents } from "../../src/core/realtime/restaurantEventService";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/214_phase11_3d_customer_realtime_broadcast_fix.sql"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/modules/qr-menu/pages/QRMenuPage.tsx"), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("Phase 11.3D customer realtime tracking", () => {
  it("uses a public secret-topic invalidation signal instead of an unreachable private broadcast", () => {
    expect(migration).toContain("perform realtime.send(");
    expect(migration).toContain("'order_changed'");
    expect(migration).toContain("topic,");
    expect(migration).toContain("false");
    expect(migration).not.toContain("perform realtime.broadcast_changes(");
    expect(migration).not.toContain("'new', to_jsonb");
    for (const table of ["orders", "order_items", "order_invoices"]) expect(migration).toContain(`on public.${table}`);
  });

  it("subscribes publicly, tenant-filters the signal, and reports connection state", () => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout, clearTimeout });
    vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: "visible" });
    vi.stubGlobal("navigator", { onLine: true });
    let broadcast: ((message: { payload: unknown }) => void) | undefined;
    const channel = {
      on: vi.fn((_kind, _filter, callback) => { broadcast = callback; return channel; }),
      subscribe: vi.fn((callback) => { callback("SUBSCRIBED"); return channel; }),
    };
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => undefined) } as unknown as SupabaseClient;
    const listener = vi.fn();
    const state = vi.fn();
    const unsubscribe = subscribeCustomerTrackingEvents("business-a", "browser-token", listener, state, client);

    expect(client.channel).toHaveBeenCalledWith("customer-order:browser-token", { config: { private: false } });
    expect(state).toHaveBeenCalledWith("connected");
    broadcast?.({ payload: { record: { restaurant_id: "business-b", order_id: "other" } } });
    expect(listener).not.toHaveBeenCalled();
    broadcast?.({ payload: { record: { restaurant_id: "business-a", order_id: "mine" } } });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ order_id: "mine" }));
    unsubscribe();
  });

  it("rebinds when the browser session token changes and refreshes canonical RPC state", () => {
    expect(page).toMatch(/\}, \[\s*checkout\.browserSessionToken,\s*checkout\.qrToken,\s*checkout\.sessionKey,/);
    expect(page).toContain('if (status === "connected") refresh()');
    expect(page).toContain("void refreshActiveSession()");
  });
});
