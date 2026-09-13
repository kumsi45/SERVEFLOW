import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const owner = readFileSync("src/modules/owner/pages/OwnerDashboardPage.tsx", "utf8");
const publicMenu = readFileSync("src/modules/qr-menu/pages/QRMenuPage.tsx", "utf8");
const stream = readFileSync("src/core/realtime/restaurantEventService.ts", "utf8");

describe("Owner workspace stability", () => {
  it("does not revalidate table stats for ordinary order status updates", () => {
    expect(owner).toContain('payload.eventType !== "UPDATE" || nextTableId !== previousTableId');
    expect(owner).toContain("Kitchen/status updates change the local occupancy row directly");
  });

  it("keeps valid table activity visible while background validation is silent", () => {
    expect(owner).toContain("qrStatsRefreshing && qrStats === null");
    expect(owner).toContain("Loading table activity");
    expect(owner).not.toContain("Refreshing table activity");
  });

  it("does not call a normal public menu initial state a reconnect", () => {
    expect(publicMenu).toContain('Boolean(activeSession?.order_id ?? submittedOrder?.order_id) && realtimeState === "reconnecting"');
    expect(publicMenu).toContain("Realtime reconnecting");
  });

  it("preserves one tenant-scoped shared stream and only scopes Owner recreation to identity", () => {
    expect(owner).toContain("}, [ownerUserId, restaurantId]);");
    expect(stream).toContain("const streams = new WeakMap");
    expect(stream).toContain("getRestaurantEventStream(restaurantId, client, [...handlers.keys()])");
    expect(stream).not.toContain("setInterval");
  });
});
