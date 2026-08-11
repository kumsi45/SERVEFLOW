import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterKitchenWorkspaceOrders,
  sortKitchenWorkspaceOrders,
} from "../../src/modules/kitchen/kitchenWorkspace";
import { resolveKitchenOrderStatus } from "../../src/modules/kitchen/services/kitchenOrderService";
import type { KitchenOrder } from "../../src/modules/kitchen/types";

const page = readFileSync(
  resolve(process.cwd(), "src/modules/kitchen/pages/KitchenDashboardPage.tsx"),
  "utf8",
);
const css = readFileSync(
  resolve(process.cwd(), "src/modules/kitchen/styles/kitchenDashboard.css"),
  "utf8",
);
const service = readFileSync(
  resolve(process.cwd(), "src/modules/kitchen/services/kitchenOrderService.ts"),
  "utf8",
);

describe("kitchen dashboard card workspace", () => {
  const stationNames = { a: "Beverages", b: "Hot Kitchen", c: "Bakery" };
  const specifications = [
    ["a", "dine-in", "accepted"],
    ["a", "takeaway", "preparing"],
    ["a", "delivery", "ready"],
    ["b", "dine-in", "preparing"],
    ["b", "dine-in", "accepted"],
    ["b", "takeaway", "accepted"],
    ["b", "delivery", "ready"],
    ["c", "dine-in", "ready"],
    ["c", "takeaway", "preparing"],
  ] as const;
  const multiStationOrders: KitchenOrder[] = specifications.map(
    ([stationId, serviceType, status], index) => ({
      id: `order-${index + 1}`,
      displayNumber: `K-${index + 1}`,
      kitchenTicketNumber: `K-${index + 1}`,
      kitchenBatchKey: "initial",
      status,
      customerName: `Customer ${index + 1}`,
      tableNumber: serviceType === "dine-in" ? `${index + 1}` : null,
      serviceType,
      totalPrice: 100,
      createdAt: new Date(Date.UTC(2026, 7, 9, 10, index)).toISOString(),
      preparationStartedAt: null,
      readyMarkedAt: null,
      items: [
        {
          id: `item-${index + 1}`,
          orderId: `order-${index + 1}`,
          name: `Item ${index + 1}`,
          quantity: 1,
          price: 100,
          kitchenStationId: stationId,
          kitchenStationName: stationNames[stationId],
        },
      ],
      stationProgress: [
        {
          stationId,
          stationName: stationNames[stationId],
          stationStatus: status,
          itemCount: 1,
          readyCount: status === "ready" ? 1 : 0,
          completedCount: 0,
          startedAt: null,
          readyAt: null,
          completedAt: null,
        },
      ],
    }),
  );

  it("combines dynamic station, service, and state filters across realistic workloads", () => {
    const select = (
      stationId: "all" | string,
      service: "all" | "dine-in" | "takeaway" | "delivery",
      state: "all" | "accepted" | "preparing" | "ready",
    ) =>
      filterKitchenWorkspaceOrders(multiStationOrders, {
        stationId,
        service,
        state,
      });

    expect(select("all", "all", "all")).toHaveLength(9);
    expect(select("a", "all", "all")).toHaveLength(3);
    expect(select("b", "all", "all")).toHaveLength(4);
    expect(select("c", "all", "all")).toHaveLength(2);
    expect(select("a", "dine-in", "all")).toHaveLength(1);
    expect(select("b", "all", "preparing")).toHaveLength(1);
    expect(select("all", "takeaway", "accepted")).toHaveLength(1);
    expect(select("all", "delivery", "ready")).toHaveLength(2);
  });

  it("sorts five tickets by authoritative queue timestamps in both directions", () => {
    const ages = [21, 18, 14, 7, 2];
    const queueNow = Date.UTC(2026, 7, 9, 10, 30);
    const tickets = multiStationOrders.slice(0, 5).map((order, index) => ({
      ...order,
      createdAt: new Date(queueNow - ages[index] * 60_000).toISOString(),
    }));

    expect(sortKitchenWorkspaceOrders([...tickets].reverse(), "oldest").map((order) => order.id))
      .toEqual(["order-1", "order-2", "order-3", "order-4", "order-5"]);
    expect(sortKitchenWorkspaceOrders(tickets, "newest").map((order) => order.id))
      .toEqual(["order-5", "order-4", "order-3", "order-2", "order-1"]);
  });

  it("sorts after station, service, and state filters and re-sorts realtime arrivals", () => {
    const filtered = filterKitchenWorkspaceOrders(multiStationOrders, {
      stationId: "b",
      service: "dine-in",
      state: "accepted",
    });
    expect(sortKitchenWorkspaceOrders(filtered, "oldest").map((order) => order.id))
      .toEqual(["order-5"]);

    const newestArrival = {
      ...multiStationOrders[4],
      id: "realtime-order",
      createdAt: "2026-08-09T12:00:00.000Z",
    };
    expect(sortKitchenWorkspaceOrders([...multiStationOrders, newestArrival], "oldest").at(-1)?.id)
      .toBe("realtime-order");
    expect(sortKitchenWorkspaceOrders([...multiStationOrders, newestArrival], "newest")[0].id)
      .toBe("realtime-order");
  });

  it("renders one sorted card grid instead of Kanban columns and a stats sidebar", () => {
    const renderedPage = page.slice(page.indexOf("return (", page.indexOf("export function KitchenDashboardPage")));

    expect(renderedPage).toContain('className="kd-order-grid"');
    expect(renderedPage).toContain("visibleOrders.map");
    expect(renderedPage).toContain("sortKitchenWorkspaceOrders(filteredOrders, sortDirection)");
    expect(renderedPage).not.toContain("<KanbanCol");
    expect(renderedPage).not.toContain('className="kd-sidebar"');
  });

  it("uses one accessible sort dropdown that preserves its selected direction", () => {
    expect(page).toContain('useState<KitchenSortDirection>("oldest")');
    expect(page).toContain('aria-haspopup="menu"');
    expect(page).toContain("aria-expanded={sortMenuOpen}");
    expect(page).toContain('role="menuitemradio"');
    expect(page).toContain("aria-checked={selected}");
    expect(page).toContain('document.addEventListener("pointerdown", closeWhenOutside)');
    expect(page).toContain('event.key !== "Escape"');
    expect(page).toContain("Sort: {sortDirection");
    expect(page).not.toContain('className="kd-sort-btn"');
  });

  it("keeps service, state, station, and search controls in the compact queue controls", () => {
    for (const label of ["Service", "Dine-in", "Takeaway", "Delivery", "State", "Preparing", "Ready", "Station"]) {
      expect(page).toContain(label);
    }
    expect(page).toContain("setServiceFilter(value)");
    expect(page).toContain("setStateFilter(value)");
    expect(page).toContain("setSelectedStationId(event.target.value)");
    expect(page).toContain('aria-label="Search orders"');
    expect(page).toContain("Kitchen: {stationLabel}");
    expect(page).toContain('dashboardContext.assignedStation?.name ?? "Station not assigned"');
    expect(page).toContain('<option value="all">All Stations</option>');
    expect(page).not.toContain('"Main Kitchen"');
    expect(page).not.toContain('"Beverages"');
  });

  it("keeps every canonical station card actionable from All Stations", () => {
    expect(page).toContain("function resolveActionStationId(order: KitchenOrder)");
    expect(page).toContain("order.stationProgress[0]?.stationId");
    expect(page).toContain("resolveActionStationId(order) !== null");
    expect(page).not.toContain('selectedStationId !== "all";\n\n  const totalActive');
    expect(page).not.toContain('showStation={selectedStationId === "all"}');
    expect(page).not.toContain('className="kd-card-station"');
    expect(page).not.toContain('className="kd-card-source"');
    expect(page).not.toContain('"Kitchen order"');
    expect(page).toContain("const totalActive = visibleOrders.length");
  });

  it("cleans stale closed tickets and prevents duplicate kitchen actions", () => {
    expect(page).toContain("const actionLocksRef = useRef<Set<string>>(new Set())");
    expect(page).toContain("if (actionLocksRef.current.has(ticketKey)) return;");
    expect(page).toContain("actionLocksRef.current.add(ticketKey);");
    expect(page).toContain("actionLocksRef.current.delete(ticketKey);");
    expect(page).toContain("function isTerminalKitchenError(error: unknown)");
    expect(page).toContain("Order closed\\.");
    expect(page).toContain("Batch completed\\.");
    expect(page).toContain("setOrders((p) => p.filter((o) => kitchenTicketKey(o) !== ticketKey))");
    expect(page).toContain("await refreshStationOrders(false);");
  });

  it("refreshes the kitchen queue from central order, item, table, and payment events", () => {
    expect(page).toContain("const kitchenQueueRealtimeTables = new Set");
    expect(page).toContain('"orders"');
    expect(page).toContain('"order_items"');
    expect(page).toContain('"restaurant_tables"');
    expect(page).toContain('event.type.startsWith("PAYMENT_")');
    expect(page).not.toContain('"order_invoices"');
  });

  it("accepts canonical and compatible station transition response shapes", () => {
    expect(service).toContain("isKitchenOrderStatus(row.operational_status)");
    expect(service).toContain(": row.status;");
    expect(service).toContain("isKitchenOrderStatus(operationalStatus)");
    expect(service).toContain("function transitionOrderRow(value: unknown): OrderRow | null");
    expect(service).toContain("Array.isArray(value) ? value[0] : value");
    expect(service).toContain("typeof row.total_price !== \"undefined\"");
    expect(service).toContain("typeof (row as { total?: unknown }).total !== \"undefined\"");
  });

  it("uses station batch status for queue cards instead of aggregate order status", () => {
    expect(resolveKitchenOrderStatus("preparing", "accepted", "accepted")).toBe("accepted");
    expect(resolveKitchenOrderStatus("preparing", "paid", null)).toBe("preparing");
    expect(service).toContain("stationStatusOverride: KitchenOrderStatus | null = null");
    expect(service).toContain("const stationStatus = isKitchenOrderStatus(row.status) ? row.status : null");
    expect(service).toContain("normalizeOrder(row, items, stationProgress, stationStatus)");
  });

  it("uses state-aware cards with quantity rows, instructions, and one contextual action", () => {
    expect(page).toContain("kd-order-card status-${order.status}");
    expect(page).toContain("`kd-card-timer ${timerClass}`");
    expect(page).toContain('className="kd-card-item-main"');
    expect(page).toContain('className="kd-card-instruction"');
    expect(page).toContain("Start Preparing");
    expect(page).toContain("Mark Ready");
    expect(page).toContain("Complete Station");
    expect(page).toContain('className={`kd-context-action ${order.status}`}');
  });

  it("fits four readable cards on large desktops and responds down to one column", () => {
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toContain(".kd-order-grid { grid-template-columns: 1fr; }");
  });
});
