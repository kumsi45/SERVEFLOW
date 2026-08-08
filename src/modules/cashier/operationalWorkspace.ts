export const OPERATIONAL_QUEUE_TABS = [
  "pending",
  "preparing",
  "ready",
  "completed",
] as const;

export type OperationalQueueTab = (typeof OPERATIONAL_QUEUE_TABS)[number];

export type OperationalQueueCollections<T> = Record<
  OperationalQueueTab,
  readonly T[]
>;

export function buildOperationalQueueView<T>(
  collections: OperationalQueueCollections<T>,
  options: {
    matches?: (row: T) => boolean;
    compare?: (left: T, right: T) => number;
  } = {},
) {
  const rows = {} as Record<OperationalQueueTab, T[]>;
  const counts = {} as Record<OperationalQueueTab, number>;

  for (const tab of OPERATIONAL_QUEUE_TABS) {
    const visibleRows = collections[tab].filter(
      options.matches ?? (() => true),
    );
    if (options.compare) visibleRows.sort(options.compare);
    rows[tab] = visibleRows;
    counts[tab] = visibleRows.length;
  }

  return { rows, counts };
}

type OperationalItem = {
  name: string;
  quantity: number;
};

export function summarizeOperationalItems(
  items: readonly OperationalItem[],
  previewLimit = 3,
) {
  const distinctItems = new Map<
    string,
    { name: string; quantity: number }
  >();

  for (const item of items) {
    const name = item.name.trim() || "Unnamed item";
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const key = name.toLocaleLowerCase();
    const existing = distinctItems.get(key);
    if (existing) {
      existing.quantity += quantity;
    } else {
      distinctItems.set(key, { name, quantity });
    }
  }

  const allItems = [...distinctItems.values()];
  const totalQuantity = allItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const fullSummary = allItems
    .map((item) => `${item.name} ×${item.quantity}`)
    .join(" • ");
  const previewItems = allItems.slice(0, Math.max(0, previewLimit));

  return {
    totalQuantity,
    distinctItemCount: allItems.length,
    previewText: previewItems
      .map((item) => `${item.name} ×${item.quantity}`)
      .join(" • "),
    hiddenDistinctCount: Math.max(0, allItems.length - previewItems.length),
    fullSummary,
  };
}
