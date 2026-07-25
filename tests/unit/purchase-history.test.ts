import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterAndSortPurchaseHistory,
  mapPurchaseHistoryRow,
  purchaseHistoryCsv,
} from "../../src/modules/purchasing/services/purchaseHistoryService";
import type {
  PurchaseHistoryFilters,
  PurchaseHistoryRecord,
} from "../../src/modules/purchasing/purchaseHistoryTypes";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sql = read("supabase/migrations/184_phase8_5_4_purchase_history.sql");
const executableSql = sql.replace(/--.*$/gm, "").replace(/comment on[\s\S]*?;/gi, "");
const page = read("src/modules/purchasing/pages/PurchaseHistoryPage.tsx");
const service = read("src/modules/purchasing/services/purchaseHistoryService.ts");
const dashboard = read("src/modules/inventory/pages/InventoryDashboardPage.tsx");
const router = read("src/app/router/AppRouter.tsx");

const baseFilters: PurchaseHistoryFilters = {
  search: "", supplierId: "", status: "all", dateFrom: "", dateTo: "",
  createdByStaffId: "", sort: "newest",
};

const purchase = (
  id: string,
  patch: Partial<PurchaseHistoryRecord> = {},
): PurchaseHistoryRecord => ({
  id,
  restaurantId: "restaurant-1",
  purchaseNumber: `PO-${id.toUpperCase()}`,
  supplierId: "supplier-1",
  supplierName: "Central Foods",
  status: "draft",
  expectedDeliveryDate: "2026-07-30",
  notes: null,
  createdByStaffId: "staff-1",
  createdByName: "Manager One",
  createdAt: "2026-07-20T10:00:00Z",
  firstReceivedAt: null,
  receivedAt: null,
  receivedByNames: null,
  itemCount: 1,
  totalCost: 100,
  receivedCost: 0,
  remainingCost: 100,
  lines: [{
    id: `line-${id}`,
    inventoryItemId: "item-1",
    inventoryItemName: "Wheat Flour",
    orderedQuantity: 10,
    receivedQuantity: 0,
    remainingQuantity: 10,
    purchaseUnitId: "unit-1",
    purchaseUnitName: "kg",
    unitPrice: 10,
    lineTotal: 100,
    sortOrder: 0,
  }],
  ...patch,
});

const records = [
  purchase("alpha", { createdAt: "2026-07-20T10:00:00Z", totalCost: 100 }),
  purchase("bravo", {
    supplierId: "supplier-2", supplierName: "Fresh, Inc.", status: "partially_received",
    createdByStaffId: "staff-2", createdByName: "Owner Two",
    createdAt: "2026-07-22T10:00:00Z", totalCost: 300,
    receivedAt: "2026-07-23T08:00:00Z", receivedByNames: "Inventory Officer",
    lines: [{
      id: "line-bravo", inventoryItemId: "item-2", inventoryItemName: "Sunflower Oil",
      orderedQuantity: 20, receivedQuantity: 8, remainingQuantity: 12,
      purchaseUnitId: "unit-2", purchaseUnitName: "L", unitPrice: 15,
      lineTotal: 300, sortOrder: 0,
    }],
  }),
  purchase("charlie", {
    status: "completed", createdAt: "2026-07-24T10:00:00Z", totalCost: 50,
  }),
];

describe("Phase 8.5.4 purchase history database", () => {
  it("uses existing purchase tables through a read-only tenant function", () => {
    expect(sql).toContain("create or replace function public.get_purchase_history");
    for (const table of [
      "public.purchase_orders", "public.purchase_order_items",
      "public.purchase_order_receipts", "public.inventory_suppliers",
    ]) expect(sql).toContain(table);
    expect(sql).not.toMatch(/create table|alter table/i);
    expect(executableSql).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b|inventory_movements|current_quantity/i);
  });

  it("returns complete summary and detail fields", () => {
    for (const field of [
      "purchase_number", "supplier_name", "created_by_name", "created_at",
      "received_at", "status", "total_cost", "item_count", "received_by_names",
      "ordered_quantity", "received_quantity", "remaining_quantity",
      "purchase_unit_name", "unit_price", "line_total",
    ]) expect(sql).toContain(field);
  });

  it("enforces tenant isolation and permits active restaurant staff read-only access", () => {
    expect(sql).toContain("public.purchase_history_can_read(target_restaurant_id)");
    expect(sql).toContain("staff.restaurant_id = target_restaurant_id");
    expect(sql).toContain("staff.user_id = auth.uid()");
    expect(sql).toContain("staff.active = true");
    expect(sql).toContain("where purchase_order.restaurant_id = target_restaurant_id");
    expect(sql).toContain("grant execute on function public.purchase_history_can_read(uuid)");
    expect(sql).not.toMatch(/grant execute on function public\.(save|delete|receive|confirm)/i);
  });
});

describe("Phase 8.5.4 search, filters, sorting, and export", () => {
  it("searches by purchase number, supplier, and inventory item", () => {
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, search: "bravo" }).map((row) => row.id)).toEqual(["bravo"]);
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, search: "Fresh" }).map((row) => row.id)).toEqual(["bravo"]);
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, search: "oil" }).map((row) => row.id)).toEqual(["bravo"]);
  });

  it("filters by supplier, status, date range, and creator", () => {
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, supplierId: "supplier-2" }).map((row) => row.id)).toEqual(["bravo"]);
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, status: "completed" }).map((row) => row.id)).toEqual(["charlie"]);
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, dateFrom: "2026-07-21", dateTo: "2026-07-23" }).map((row) => row.id)).toEqual(["bravo"]);
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, createdByStaffId: "staff-2" }).map((row) => row.id)).toEqual(["bravo"]);
  });

  it("sorts newest, oldest, highest cost, and lowest cost", () => {
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, sort: "newest" }).map((row) => row.id)).toEqual(["charlie", "bravo", "alpha"]);
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, sort: "oldest" }).map((row) => row.id)).toEqual(["alpha", "bravo", "charlie"]);
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, sort: "highest_cost" }).map((row) => row.id)).toEqual(["bravo", "alpha", "charlie"]);
    expect(filterAndSortPurchaseHistory(records, { ...baseFilters, sort: "lowest_cost" }).map((row) => row.id)).toEqual(["charlie", "alpha", "bravo"]);
  });

  it("exports CSV with purchase summaries and line detail, and never PDF", () => {
    const csv = purchaseHistoryCsv([records[1]]);
    expect(csv).toContain('"Purchase Number"');
    expect(csv).toContain('"PO-BRAVO"');
    expect(csv).toContain('"Fresh, Inc."');
    expect(csv).toContain('"Sunflower Oil"');
    expect(csv).toContain('"20"');
    expect(csv).toContain('"8"');
    expect(service).toContain('type: "text/csv;charset=utf-8"');
    expect(`${page}${service}`).not.toMatch(/pdf/i);
  });

  it("maps database summaries and purchase lines", () => {
    const mapped = mapPurchaseHistoryRow({
      id: "purchase-1", restaurant_id: "restaurant-1", purchase_number: "PO-12345678",
      supplier_id: "supplier-1", supplier_name: "Central Foods", status: "completed",
      expected_delivery_date: "2026-07-30", created_by_staff_id: "staff-1",
      created_by_name: "Manager", created_at: "2026-07-20T10:00:00Z",
      received_at: "2026-07-21T10:00:00Z", received_by_names: "Officer",
      item_count: "1", total_cost: "100", received_cost: "100", remaining_cost: "0",
      lines: [{ id: "line-1", inventory_item_id: "item-1", inventory_item_name: "Flour",
        ordered_quantity: "10", received_quantity: "10", remaining_quantity: "0",
        purchase_unit_id: "unit-1", purchase_unit_name: "kg", unit_price: "10",
        line_total: "100", sort_order: 0 }],
    });
    expect(mapped).toMatchObject({ purchaseNumber: "PO-12345678", status: "completed", totalCost: 100 });
    expect(mapped.lines[0]).toMatchObject({ inventoryItemName: "Flour", orderedQuantity: 10, remainingQuantity: 0 });
  });
});

describe("Phase 8.5.4 purchase history UI", () => {
  it("shows every summary and detail field", () => {
    for (const marker of [
      "Purchase Number", "Supplier", "Created By", "Created Date", "Received Date",
      "Status", "Total Cost", "Items", "Delivery Date", "Received By", "Notes",
      "Inventory Item", "Ordered", "Received", "Remaining", "Purchase Unit",
      "Unit Price", "Line Total", "Overall Total",
    ]) expect(page).toContain(marker);
  });

  it("offers all statuses, filters, sort options, detail navigation, and CSV only", () => {
    for (const marker of [
      "Draft", "Approved", "Partially Received", "Completed", "Cancelled",
      "Search", "Supplier", "Date From", "Date To", "Created By", "Sort By",
      "Newest", "Oldest", "Highest Cost", "Lowest Cost", "View Details",
      "Back to Purchase History", "Export CSV",
    ]) expect(page).toContain(marker);
    expect(page).not.toMatch(/Edit Purchase|Delete Purchase|Receive Purchase|Save Purchase/i);
  });

  it("is routed separately from the purchasing and receiving engines", () => {
    expect(router).toContain('"purchase-history"');
    expect(dashboard).toContain('<PurchaseHistoryPage restaurantId={restaurantId} />');
    expect(dashboard).toContain('{ key: "purchase-history", label: "Purchase History" }');
  });
});
