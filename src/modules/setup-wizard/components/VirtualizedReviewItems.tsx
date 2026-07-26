import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { AiMenuReviewItemCard } from "./AiMenuReviewItemCard";
import type { MenuReviewItem } from "../services/menuReviewTypes";

type ItemCardProps = ComponentProps<typeof AiMenuReviewItemCard>;
type VirtualizedReviewItemsProps = Omit<
  ItemCardProps,
  "item" | "warnings" | "selected"
> & {
  items: MenuReviewItem[];
  warningsById: ReadonlyMap<string, ItemCardProps["warnings"]>;
  selectedIds: ReadonlySet<string>;
};

const VIRTUALIZATION_THRESHOLD = 18;
const OVERSCAN_ROWS = 1;
const GAP = 12;

export const VirtualizedReviewItems = memo(function VirtualizedReviewItems({
  items,
  warningsById,
  selectedIds,
  ...cardProps
}: VirtualizedReviewItemsProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? viewport.clientWidth);
    });
    observer.observe(viewport);
    setWidth(viewport.clientWidth);
    return () => observer.disconnect();
  }, []);

  const columns = width >= 1120 ? 3 : width >= 680 ? 2 : 1;
  const rowHeight = columns === 1 ? 1040 : 900;
  const rows = Math.ceil(items.length / columns);
  const visible = useMemo(() => {
    if (items.length <= VIRTUALIZATION_THRESHOLD) return items.map((item, index) => ({ item, index }));
    const viewportHeight = 880;
    const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
    const lastRow = Math.min(
      rows - 1,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS,
    );
    const start = firstRow * columns;
    const end = Math.min(items.length, (lastRow + 1) * columns);
    return items.slice(start, end).map((item, index) => ({
      item,
      index: start + index,
    }));
  }, [columns, items, rowHeight, rows, scrollTop]);

  if (items.length <= VIRTUALIZATION_THRESHOLD) {
    return (
      <div className="review-items-grid">
        {items.map((item) => (
          <AiMenuReviewItemCard
            {...cardProps}
            item={item}
            warnings={warningsById.get(item.id) ?? []}
            selected={selectedIds.has(item.id)}
            key={item.id}
          />
        ))}
      </div>
    );
  }

  const totalHeight = rows * rowHeight;
  return (
    <div
      className="review-items-virtual"
      ref={viewportRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      role="region"
      aria-label={`Virtualized list of ${items.length} menu items`}
      tabIndex={0}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visible.map(({ item, index }) => {
          const row = Math.floor(index / columns);
          const column = index % columns;
          const columnWidth = `calc((100% - ${(columns - 1) * GAP}px) / ${columns})`;
          return (
            <div
              className="review-items-virtual-cell"
              key={item.id}
              style={{
                top: row * rowHeight,
                left: `calc(${column} * (${columnWidth} + ${GAP}px))`,
                width: columnWidth,
                height: rowHeight - GAP,
              }}
            >
              <AiMenuReviewItemCard
                {...cardProps}
                item={item}
                warnings={warningsById.get(item.id) ?? []}
                selected={selectedIds.has(item.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
