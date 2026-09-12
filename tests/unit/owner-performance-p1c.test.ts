import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnerRealtimeRefreshScheduler } from "../../src/modules/owner/services/ownerRealtimeRefreshScheduler";

const scope = { userId: "owner-a", restaurantId: "restaurant-a" };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Owner performance P1C realtime coalescing", () => {
  it("coalesces an invoice burst into one financial cycle without merging its truths", async () => {
    const payments = vi.fn(async () => undefined);
    const obligations = vi.fn(async () => undefined);
    const comparison = vi.fn(async () => undefined);
    const scheduler = createOwnerRealtimeRefreshScheduler({
      scope,
      refresh: {
        financial: async () => { await Promise.all([payments(), obligations(), comparison()]); },
        "table-metadata": async () => undefined,
        "table-stats": async () => undefined,
        menu: async () => undefined,
      },
    });
    scheduler.mark("financial"); scheduler.mark("financial"); scheduler.mark("financial");
    await vi.advanceTimersByTimeAsync(80);
    expect(payments).toHaveBeenCalledTimes(1);
    expect(obligations).toHaveBeenCalledTimes(1);
    expect(comparison).toHaveBeenCalledTimes(1);
  });

  it("runs one required follow-up when a newer event arrives in flight", async () => {
    const first = deferred();
    const refresh = vi.fn(() => refresh.mock.calls.length === 1 ? first.promise : Promise.resolve());
    const scheduler = createOwnerRealtimeRefreshScheduler({
      scope,
      refresh: { financial: refresh, "table-metadata": refresh, "table-stats": refresh, menu: refresh },
    });
    scheduler.mark("financial");
    await vi.advanceTimersByTimeAsync(80);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.mark("financial"); scheduler.mark("financial");
    await vi.advanceTimersByTimeAsync(80);
    expect(refresh).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(80);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps table stats, metadata, menu, and financial work independent", async () => {
    const financial = vi.fn(async () => undefined);
    const metadata = vi.fn(async () => undefined);
    const stats = vi.fn(async () => undefined);
    const menu = vi.fn(async () => undefined);
    const scheduler = createOwnerRealtimeRefreshScheduler({ scope, refresh: { financial, "table-metadata": metadata, "table-stats": stats, menu } });
    scheduler.mark("table-stats"); scheduler.mark("table-stats"); scheduler.mark("menu");
    await vi.advanceTimersByTimeAsync(80);
    expect(stats).toHaveBeenCalledTimes(1);
    expect(menu).toHaveBeenCalledTimes(1);
    expect(financial).not.toHaveBeenCalled();
    expect(metadata).not.toHaveBeenCalled();
  });

  it("cancels queued old-tenant callbacks on dispose", async () => {
    const financial = vi.fn(async () => undefined);
    const scheduler = createOwnerRealtimeRefreshScheduler({
      scope,
      refresh: { financial, "table-metadata": financial, "table-stats": financial, menu: financial },
    });
    scheduler.mark("financial");
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(80);
    expect(financial).not.toHaveBeenCalled();
  });
});
