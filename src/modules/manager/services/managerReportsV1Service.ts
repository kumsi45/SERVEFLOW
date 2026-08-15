import type { ReportingPeriodWindow } from "../../../core/analytics/historicalAnalytics";
import { loadManagerFinancialReport, type ManagerFinancialReport } from "./managerFinancialReportsService";
import { loadManagerCashierPeriodReport, loadManagerMenuPerformanceReport, type ManagerCashierPeriodReport, type ManagerMenuPerformanceReport } from "./managerR3ReportsService";
import { loadManagerR4OperationalReport, type ManagerR4OperationalReport } from "./managerR4ReportsService";

export type ManagerReportsV1Bundle = {
  generatedAt: string;
  window: ReportingPeriodWindow;
  financial: ManagerFinancialReport;
  menu: ManagerMenuPerformanceReport;
  cashier: ManagerCashierPeriodReport;
  operations: ManagerR4OperationalReport;
};

export async function loadManagerReportsV1(restaurantId: string, window: ReportingPeriodWindow): Promise<ManagerReportsV1Bundle> {
  const [financial, menu, cashier, operations] = await Promise.all([
    loadManagerFinancialReport(restaurantId, window),
    loadManagerMenuPerformanceReport(restaurantId, window),
    loadManagerCashierPeriodReport(restaurantId, window),
    loadManagerR4OperationalReport(restaurantId, window),
  ]);
  return { generatedAt: new Date().toISOString(), window, financial, menu, cashier, operations };
}

type ExportRow = Array<string | number | null | undefined>;
const csvCell = (value: ExportRow[number]) => {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const record = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const str = (value: unknown) => typeof value === "string" ? value : "";

export function managerReportsExportRows(report: ManagerReportsV1Bundle): ExportRow[] {
  const rows: ExportRow[] = [["Section", "Record", "Metric", "Value", "Detail"]];
  const finance = report.financial.current;
  [
    ["Collected", finance.collectedAmount], ["Outstanding", finance.outstandingAmount], ["Refunded", finance.refundAmount],
    ["Net Collection", finance.netCollection], ["VAT / Tax", finance.vatAmount], ["Discounts", finance.discountAmount],
    ["Service Charges", finance.serviceChargeAmount], ["Average Paid Invoice", finance.averagePaidInvoice], ["Orders Created", finance.ordersCreated],
  ].forEach(([label, value]) => rows.push(["Sales & Payments", "Summary", label, value, ""]));
  finance.paymentMethods.forEach((method) => rows.push(["Payment Methods", method.paymentMethod, "Collected", method.collectedAmount, `${method.invoiceCount} invoices`]));
  report.menu.items.forEach((item) => rows.push(["Menu Performance", item.menuItemName, "Quantity sold", item.currentQuantity, `${item.currentSales} sales value; ${item.currentOrders} orders; ${item.currentStatus}`]));
  report.cashier.shifts.forEach((shift) => rows.push(["Cashier & Shifts", shift.cashierName, shift.status, shift.expectedCash, `Opened ${shift.openedAt}; actual ${shift.actualCash ?? "Not Yet Reconciled"}; variance ${shift.variance ?? ""}`]));
  report.operations.kitchen.stations.forEach((value) => { const row = record(value); rows.push(["Kitchen", str(row.station_name), "Completed items", num(row.completed_items), `${num(row.avg_minutes)} average minutes; ${num(row.delayed_items)} delayed`]); });
  report.operations.staff.facts.forEach((value) => { const row = record(value); rows.push(["Staff Operations", str(row.display_name), str(row.role), num(row.orders_created) + num(row.kitchen_items_completed) + num(row.inventory_movements) + num(row.cashier_shifts_opened), "Recorded workload events; no performance score"]); });
  report.operations.inventory.movements.forEach((value) => { const row = record(value); rows.push(["Inventory Movements", str(row.item_name), str(row.movement_type), num(row.quantity), `${str(row.quantity_effect)} ${str(row.unit_name)}; ${str(row.movement_date)}`]); });
  [...report.operations.exceptions.native, ...report.operations.exceptions.manual].forEach((value) => { const row = record(value); rows.push(["Exceptions & Incidents", str(row.title) || str(row.source_type), str(row.status), str(row.severity), str(row.summary)]); });
  return rows;
}

export function buildManagerReportsCsv(report: ManagerReportsV1Bundle) {
  return `\uFEFF${managerReportsExportRows(report).map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

export function downloadManagerReportsCsv(report: ManagerReportsV1Bundle, filename = "serveflow-manager-report.csv") {
  downloadBlob(new Blob([buildManagerReportsCsv(report)], { type: "text/csv;charset=utf-8" }), filename);
}

function periodLabel(window: ReportingPeriodWindow) {
  return `${new Date(window.rangeStart).toLocaleString()} - ${new Date(window.rangeEnd).toLocaleString()} (${window.timezone})`;
}

export async function downloadManagerReportsPdf(report: ManagerReportsV1Bundle, restaurantName: string, managerName: string, filename = "serveflow-manager-report.pdf") {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const width = pdf.internal.pageSize.getWidth(); let y = 48;
  const line = (text: string, size = 10, bold = false) => {
    if (y > 790) { pdf.addPage(); y = 48; }
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text.replace(/[^\x20-\x7E]/g, " "), width - 80);
    pdf.text(lines, 40, y); y += lines.length * (size + 4);
  };
  const section = (title: string) => { y += 8; line(title, 14, true); };
  line("ServeFlow", 18, true); line(restaurantName, 13, true); line("Manager Report", 16, true);
  line(`Selected period: ${periodLabel(report.window)}`); line(`Generated: ${new Date(report.generatedAt).toLocaleString()}`); line(`Manager: ${managerName}`);
  const f = report.financial.current;
  section("Overview"); line(`Collected ${f.collectedAmount}; Outstanding ${f.outstandingAmount}; Refunds ${f.refundAmount}; Net collection ${f.netCollection}; Orders created ${f.ordersCreated}.`);
  section("Menu Performance"); report.menu.topByQuantity.slice(0, 12).forEach((row) => line(`${row.menuItemName}: ${row.currentQuantity} quantity; ${row.currentSales} sales value; ${row.currentOrders} orders.`));
  section("Sales & Payments / VAT"); line(`VAT ${f.vatAmount}; Discounts ${f.discountAmount}; Service charges ${f.serviceChargeAmount}; Average paid invoice ${f.averagePaidInvoice ?? "Unavailable"}.`); f.paymentMethods.forEach((row) => line(`${row.paymentMethod}: ${row.collectedAmount}; ${row.invoiceCount} invoices.`));
  section("Cashier & Shifts"); report.cashier.shifts.forEach((row) => line(`${row.cashierName}: ${row.status}; opening ${row.openingCash}; cash sales ${row.cashSales}; expected ${row.expectedCash}; actual ${row.actualCash ?? "Not Yet Reconciled"}; variance ${row.variance ?? "Unavailable"}.`));
  section("Kitchen"); line(`Received ${report.operations.kitchen.current.itemsReceived ?? 0}; started ${report.operations.kitchen.current.itemsStarted ?? 0}; completed ${report.operations.kitchen.current.itemsCompleted ?? 0}; average ${report.operations.kitchen.current.avgMinutes ?? "Unavailable"} min; delayed ${report.operations.kitchen.current.delayedItems ?? 0}.`);
  section("Staff Operations"); report.operations.staff.facts.forEach((value) => { const row = record(value); line(`${str(row.display_name)} (${str(row.role)}): recorded orders ${num(row.orders_created)}, kitchen completions ${num(row.kitchen_items_completed)}, inventory movements ${num(row.inventory_movements)}, cashier shifts ${num(row.cashier_shifts_opened)}.`); });
  section("Inventory"); line(`Movements ${report.operations.inventory.current.movementCount ?? 0}; received ${report.operations.inventory.current.quantityIn ?? 0}; deductions ${report.operations.inventory.current.quantityOut ?? 0}; waste/spoilage ${report.operations.inventory.current.wasteSpoilage ?? 0}. History scope: movement ledger only.`);
  section("Guests & Tables"); line(`Sessions opened ${report.operations.guests.current.sessionsOpened ?? 0}; closed ${report.operations.guests.current.sessionsClosed ?? 0}; tables served ${report.operations.guests.current.tablesServed ?? 0}; assistance ${report.operations.guests.assistanceRequests}; complaints ${report.operations.guests.complaints}. Guest count unavailable.`);
  section("Exceptions & Incidents"); [...report.operations.exceptions.native, ...report.operations.exceptions.manual].forEach((value) => { const row = record(value); line(`${str(row.title) || str(row.source_type)}: ${str(row.status)} ${str(row.severity)}. ${str(row.summary)}`); });
  section("Manager Decisions"); report.operations.managerRecords.decisions.forEach((value) => { const row = record(value); line(`${str(row.decision_type)}: ${str(row.decision_note)} (${str(row.resulting_status)}), ${str(row.created_at)}.`); });
  section("Manager Notes"); report.operations.managerRecords.notes.forEach((value) => { const row = record(value); line(`${str(row.note_date)}: ${str(row.note_text)}.`); });
  pdf.save(filename);
}
