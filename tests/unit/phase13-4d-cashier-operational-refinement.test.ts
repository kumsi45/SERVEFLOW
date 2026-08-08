import { describe, expect, it } from "vitest";
import {
  buildOperationalQueueView,
  summarizeOperationalItems,
} from "../../src/modules/cashier/operationalWorkspace";

type QueueRow = { id: string; createdAt: number; visible?: boolean };

const emptyQueues = () => ({
  pending: [] as QueueRow[],
  preparing: [] as QueueRow[],
  ready: [] as QueueRow[],
  completed: [] as QueueRow[],
});

describe("Phase 13.4D cashier operational refinement", () => {
  it("derives every badge count from the exact visible row collection", () => {
    const queues = emptyQueues();
    queues.pending = [{ id: "due-1", createdAt: 1 }];
    queues.completed = [
      { id: "done-1", createdAt: 2 },
      { id: "done-2", createdAt: 3 },
    ];

    const view = buildOperationalQueueView(queues);

    expect(view.counts.pending).toBe(1);
    expect(view.counts.completed).toBe(2);
    expect(view.counts.pending).toBe(view.rows.pending.length);
    expect(view.counts.completed).toBe(view.rows.completed.length);
    expect(view.counts.preparing).toBe(0);
    expect(view.counts.ready).toBe(0);
  });

  it("updates Payment Due and Receipt Pending together when a row moves", () => {
    const paymentDue = { id: "invoice-182", createdAt: 1 };
    const before = emptyQueues();
    before.pending = [paymentDue];

    const after = emptyQueues();
    after.ready = [paymentDue];

    expect(buildOperationalQueueView(before).counts).toMatchObject({
      pending: 1,
      ready: 0,
    });
    expect(buildOperationalQueueView(after).counts).toMatchObject({
      pending: 0,
      ready: 1,
    });
  });

  it("keeps counts aligned with filtered rows and preserves newest-first order", () => {
    const queues = emptyQueues();
    queues.pending = [
      { id: "hidden", createdAt: 3, visible: false },
      { id: "older", createdAt: 1, visible: true },
      { id: "newer", createdAt: 2, visible: true },
    ];

    const view = buildOperationalQueueView(queues, {
      matches: (row) => row.visible !== false,
      compare: (left, right) => right.createdAt - left.createdAt,
    });

    expect(view.rows.pending.map((row) => row.id)).toEqual(["newer", "older"]);
    expect(view.counts.pending).toBe(2);
  });

  it("handles zero, one, three, and twenty distinct items without hiding overflow", () => {
    expect(summarizeOperationalItems([])).toMatchObject({
      totalQuantity: 0,
      previewText: "",
      hiddenDistinctCount: 0,
      fullSummary: "",
    });

    expect(summarizeOperationalItems([{ name: "Coffee", quantity: 1 }])).toMatchObject({
      totalQuantity: 1,
      previewText: "Coffee ×1",
      hiddenDistinctCount: 0,
    });

    const three = summarizeOperationalItems([
      { name: "Burger", quantity: 2 },
      { name: "Coffee", quantity: 3 },
      { name: "Pizza", quantity: 1 },
    ]);
    expect(three.totalQuantity).toBe(6);
    expect(three.previewText).toBe("Burger ×2 • Coffee ×3 • Pizza ×1");
    expect(three.hiddenDistinctCount).toBe(0);

    const twenty = summarizeOperationalItems(
      Array.from({ length: 20 }, (_, index) => ({
        name: `Item ${index + 1}`,
        quantity: 1,
      })),
    );
    expect(twenty.totalQuantity).toBe(20);
    expect(twenty.previewText).toBe("Item 1 ×1 • Item 2 ×1 • Item 3 ×1");
    expect(twenty.hiddenDistinctCount).toBe(17);
    expect(twenty.fullSummary).toContain("Item 20 ×1");
  });

  it("merges repeated quantities and preserves long names for accessible output", () => {
    const longName = "Slow-roasted heritage tomato and basil sourdough sandwich";
    const summary = summarizeOperationalItems([
      { name: longName, quantity: 2 },
      { name: longName, quantity: 3 },
      { name: "Coffee", quantity: 2 },
    ]);

    expect(summary.totalQuantity).toBe(7);
    expect(summary.distinctItemCount).toBe(2);
    expect(summary.previewText).toContain(`${longName} ×5`);
    expect(summary.fullSummary).toBe(`${longName} ×5 • Coffee ×2`);
  });
});
