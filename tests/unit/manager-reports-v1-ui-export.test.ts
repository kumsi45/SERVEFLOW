import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManagerReportsCsv, managerReportsExportRows, type ManagerReportsV1Bundle } from "../../src/modules/manager/services/managerReportsV1Service";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8").replaceAll("\r\n","\n");
const page=read("src/modules/manager/pages/ManagerOperationalReportsPage.tsx");
const css=read("src/modules/manager/styles/managerOperationalReports.css");

function fixture():ManagerReportsV1Bundle{return {
  generatedAt:"2026-08-15T12:00:00Z",window:{period:"custom",rangeStart:"2026-08-10T00:00:00Z",rangeEnd:"2026-08-11T00:00:00Z",comparisonRangeStart:"2026-08-09T00:00:00Z",comparisonRangeEnd:"2026-08-10T00:00:00Z",timezone:"Africa/Nairobi"},
  financial:{generatedAt:"",definitions:{collected:"",outstanding:"",refund:"",netCollection:"",ordersCreated:""},current:{rangeStart:"",rangeEnd:"",collectedAmount:100,collectedInvoiceCount:2,outstandingAmount:20,outstandingInvoiceCount:1,refundAmount:5,refundedInvoiceCount:1,netCollection:95,subtotalAmount:90,discountAmount:2,serviceChargeAmount:4,refundedServiceChargeAmount:0,netServiceChargeAmount:4,vatAmount:8,refundedVatAmount:0,netVatAmount:8,averagePaidInvoice:50,ordersCreated:3,paymentMethods:[{paymentMethod:"Cash",collectedAmount:60,invoiceCount:1}],dataQuality:{financialHistory:"complete",taxHistory:"mixed_legacy",serviceChargeHistory:"complete",refundHistory:"complete"}},comparison:{rangeStart:"",rangeEnd:"",collectedAmount:50,collectedInvoiceCount:1,outstandingAmount:0,outstandingInvoiceCount:0,refundAmount:0,refundedInvoiceCount:0,netCollection:50,subtotalAmount:50,discountAmount:0,serviceChargeAmount:0,refundedServiceChargeAmount:0,netServiceChargeAmount:0,vatAmount:0,refundedVatAmount:0,netVatAmount:0,averagePaidInvoice:50,ordersCreated:1,paymentMethods:[],dataQuality:{financialHistory:"complete",taxHistory:"complete",serviceChargeHistory:"complete",refundHistory:"unavailable"}}},
  menu:{generatedAt:"",rangeStart:"",rangeEnd:"",comparisonRangeStart:"",comparisonRangeEnd:"",items:[{menuItemId:"1",menuItemName:"=Formula Dish",categoryId:"c",categoryName:"Food",currentStatus:"Available",currentQuantity:2,comparisonQuantity:1,quantityChange:1,quantityChangePercent:100,currentSales:30,comparisonSales:10,salesChange:20,salesChangePercent:200,currentOrders:1,comparisonOrders:1,currentOrderItemCount:1,comparisonOrderItemCount:1}],topByQuantity:[],topBySales:[],lowSelling:[],zeroRecordedSales:[],categories:[],availabilityHistoryAvailable:false,dataQuality:{historicalPriceQuality:"complete",availabilityHistoryQuality:"unavailable",itemIdentityHistoryQuality:"legacy_unknown",legacyOrderItemQuality:"complete"}},
  cashier:{generatedAt:"",rangeStart:"",rangeEnd:"",shifts:[],expenses:[],handovers:[],reconciliations:[],events:[]},
  operations:{generatedAt:"",rangeStart:"",rangeEnd:"",comparisonRangeStart:"",comparisonRangeEnd:"",kitchen:{current:{itemsCompleted:1},comparison:{},stations:[],menuItems:[],delayThresholdMinutes:25},staff:{facts:[{display_name:"Amar",role:"kitchen",orders_created:0,table_assignments:0,assistance_resolved:0,cancellations_requested:0,cashier_shifts_opened:0,payments_verified:0,expenses_recorded:0,handovers_involved:0,reconciliations_closed:0,kitchen_items_completed:3,inventory_movements:0,inventory_request_events:0}],rankingAvailable:false,scoreAvailable:false},inventory:{current:{movementCount:0},comparison:{},movements:[],requests:[]},guests:{current:{sessionsOpened:1},comparison:{},assistanceRequests:0,comparisonAssistanceRequests:0,complaints:0,comparisonComplaints:0,feedbackCount:0,comparisonFeedbackCount:0,averageFeedbackRating:null,comparisonAverageFeedbackRating:null,unresolvedAssistanceRequests:0,unresolvedComplaints:0,guestCountAvailable:false},exceptions:{native:[],manual:[]},managerRecords:{decisions:[],notes:[]},dataQuality:{inventory_history_scope:"movement_ledger_only",party_size_quality:"unavailable"},definitions:{}},
};}

describe("Manager Reports V1 final UI and exports",()=>{
  it("uses the exact nine-section information architecture",()=>{
    for(const label of ["Overview","Menu Performance","Sales & Payments","Cashier & Shifts","Kitchen","Staff Operations","Inventory","Guests & Tables","Exceptions & Incidents"]) expect(page).toContain(`label:\"${label}\"`);
    expect(page).not.toContain("Staff Performance Score"); expect(page).not.toContain("Guests served");
  });
  it("keeps the Overview concise without changing report contracts",()=>{
    expect(page).toContain('label="Average Paid Bill"');
    expect(page).toContain('note={`Across ${f.collectedInvoiceCount} paid ${f.collectedInvoiceCount===1?"bill":"bills"}`}');
    expect(page).toContain("<h2>Attention Required</h2>");
    expect(page).toContain('${openShifts.length===1?"shift requires":"shifts require"} reconciliation');
    expect(page).toContain("<h2>Manager Notes</h2>");
    expect(page).toContain('placeholder="Add note for this period..."');
    expect(page).not.toContain("A concise manager-authored note associated with this reporting period.");
    expect(page).not.toContain("<Quality");
    expect(page).not.toContain("Historical VAT");
    expect(page).not.toContain("Financial history");
    expect(page).not.toContain("Kitchen history");
    expect(page).not.toContain("Staff attribution");
    expect(page).not.toContain("History scope");
    expect(page).not.toContain("Guest identity");
    expect(page).not.toContain("Historical availability");
    expect(page).not.toContain("Incident provenance");
    expect(page).not.toContain("Average Paid Invoice");
  });
  it("reuses the R1 period contract and blocks invalid custom queries",()=>{
    expect(page).toContain("reportingPeriodWindow(period,timezone,customStart,customEnd)");
    expect(page).toContain("if(!periodResult.window)"); expect(page).toContain("setReport(null)");
  });
  it("distinguishes loading, report failure, authorization, and section-empty states",()=>{
    expect(page).toContain("Loading report…"); expect(page).toContain("Unable to load report."); expect(page).toContain("Not authorized.");
    expect(page).toContain("No shifts overlap this period."); expect(page).toContain("No operational exceptions for this period.");
  });
  it("exposes real PDF and CSV downloads without owner report calls",()=>{
    expect(page).toContain("downloadManagerReportsPdf"); expect(page).toContain("downloadManagerReportsCsv");
    expect(read("src/modules/manager/services/managerReportsV1Service.ts")).toContain('await import("jspdf")');
    expect(read("src/modules/manager/services/managerReportsV1Service.ts")).not.toContain("owner_");
  });
  it("builds bounded Excel-compatible CSV and neutralizes spreadsheet formulas",()=>{
    const report=fixture(), csv=buildManagerReportsCsv(report), rows=managerReportsExportRows(report);
    expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain("'=Formula Dish");
    expect(csv).toContain('"Amar","Chef"');
    expect(rows.some((row)=>row[0]==="Menu Performance")).toBe(true); expect(rows.some((row)=>row[0]==="Sales & Payments")).toBe(true);
  });
  it("converts report tables to mobile cards and prevents page-level overflow",()=>{
    expect(css).toContain("@media(max-width:780px)"); expect(css).toContain(".mor-table,.mor-table thead,.mor-table tbody,.mor-table tr,.mor-table td{display:block}");
    expect(css).toContain("max-width:100%"); expect(css).toContain("overflow-x:auto");
  });
  it("presents Menu Performance by quantity with a six-column table and mobile cards",()=>{
    expect(page).toContain('const rankedItems=[...menu.items].sort(byQuantity)');
    expect(page).toContain('right.currentQuantity-left.currentQuantity');
    expect(page).toContain('["Rank","Item","Qty Sold","Sales Value","Orders","Current Status"]');
    expect(page).not.toContain('["Item","Quantity","Sales value","Orders","Change","Current status"]');
    expect(page).toContain('ranking(menu.topByQuantity,byQuantity)');
    expect(page).toContain('ranking(menu.topBySales,bySales)');
    expect(page).toContain('className="mor-menu-cards"');
    expect(page).toContain('item.currentQuantity.toLocaleString()} sold');
    expect(page).toContain('[item.menuItemName,"0 sold",formatCurrency(0,currency),status(item)]');
    expect(page).not.toContain("frozen line sales");
    expect(css).toContain("@media(max-width:560px)");
    expect(css).toContain(".mor-full-menu .mor-table-wrap{display:none}");
  });
});
