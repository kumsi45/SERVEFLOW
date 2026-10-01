import { describe, expect, it, vi } from "vitest";
vi.mock('../../src/core/database', () => ({ supabase: { rpc: vi.fn() } }));
import { supabase } from '../../src/core/database';
import { loadOwnerCashierReport, loadOwnerInventoryReport, parseOwnerCashierReport, parseOwnerInventoryReport } from "../../src/modules/owner/services/ownerReportDetails";

// This is the exact `resolved - 'anchorTime'` period shape returned by the deployed V2 RPCs.
const period = { key:"today",currentStart:"2026-09-29T00:00:00Z",currentEnd:"2026-09-29T12:00:00Z",requestedEnd:"2026-09-30T00:00:00Z",comparisonStart:"2026-09-28T00:00:00Z",comparisonEnd:"2026-09-28T12:00:00Z",timezone:"Africa/Nairobi",timezoneSource:"restaurant",completeness:"in_progress",comparisonAlignment:"elapsed",comparisonCapped:false,granularity:"hour",durationSecondsEqual:true,boundarySemantics:"half_open_absolute_timestamps" };
const quality = { state:"available",periodCompleteness:"in_progress",history:"modern",attribution:"complete",legacyCount:0,unknownAttributionCount:0,excludedCount:0,limitations:[] };

describe("Owner report detail contracts",()=>{
  it.each([loadOwnerInventoryReport, loadOwnerCashierReport])("keeps missing RPC errors distinct from an empty report", async load => {
    const error = { code: 'PGRST202', message: 'Function not found in schema cache' };
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error } as never);
    await expect(load('tenant', 'today', null, null)).rejects.toMatchObject({ message: 'We couldn’t retrieve this report. Try again.', cause: error });
  });
  it("parses inventory quantities with their units and movement-count summaries",()=>{
    const report=parseOwnerInventoryReport({contractVersion:"owner_inventory_report_v2",period,summary:{receivedMovementCount:1,deductedMovementCount:1,wasteMovementCount:1,movementCount:2,requestCount:1},movements:{items:[{id:"m1",itemName:"Oil",movementType:"stock_out",quantity:1.5,direction:"out",unit:"L",reason:null,recordedAt:"2026-09-29T10:00:00Z"}],nextCursor:{at:"2026-09-29T10:00:00Z",id:"m1"}},requests:{items:[],nextCursor:null},waste:{items:[],nextCursor:null},quality});
    expect(report.summary.receivedMovementCount).toBe(1);
    expect(report.movements[0]).toMatchObject({quantity:1.5,unit:"L",direction:"out"});
    expect(report.next.movements).toEqual({at:"2026-09-29T10:00:00Z",id:"m1"});
  });

  it.each([
    ["inventory", parseOwnerInventoryReport, { contractVersion:"owner_inventory_report_v2", period, summary:{receivedMovementCount:0,deductedMovementCount:0,wasteMovementCount:0,movementCount:0,requestCount:0}, movements:{items:[],nextCursor:null},requests:{items:[],nextCursor:null},waste:{items:[],nextCursor:null},quality:{...quality,state:"no_activity",periodCompleteness:null} }],
    ["cashier", parseOwnerCashierReport, { contractVersion:"owner_cashier_report_v2", period, summary:{openShifts:0,shiftsRequiringReconciliation:0,recordedVariance:0,handoverCount:0}, shifts:{items:[],nextCursor:null},handovers:{items:[],nextCursor:null},quality:{...quality,state:"no_activity",periodCompleteness:null} }],
  ] as const)("accepts the deployed %s no_activity response", (_name, parse, response) => {
    const report = parse(response);
    expect(report.period).toMatchObject({ requestedPeriod: "today", completeness: "in_progress", granularity: "hour" });
    expect(report.quality.state).toBe("no_activity");
  });

  it("takes a deployed no_activity inventory payload through the RPC service without an error", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { contractVersion:"owner_inventory_report_v2", period, summary:{receivedMovementCount:0,deductedMovementCount:0,wasteMovementCount:0,movementCount:0,requestCount:0},movements:{items:[],nextCursor:null},requests:{items:[],nextCursor:null},waste:{items:[],nextCursor:null},quality:{...quality,state:"no_activity",periodCompleteness:null} }, error: null } as never);
    await expect(loadOwnerInventoryReport("restaurant-id", "today", null, null)).resolves.toMatchObject({ quality:{state:"no_activity"}, movements:[], requests:[], waste:[] });
  });

  it("takes a deployed no_activity cashier payload through the RPC service without an error", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { contractVersion:"owner_cashier_report_v2", period, summary:{openShifts:0,shiftsRequiringReconciliation:0,recordedVariance:0,handoverCount:0},shifts:{items:[],nextCursor:null},handovers:{items:[],nextCursor:null},quality:{...quality,state:"no_activity",periodCompleteness:null} }, error: null } as never);
    await expect(loadOwnerCashierReport("restaurant-id", "today", null, null)).resolves.toMatchObject({ quality:{state:"no_activity"}, shifts:[], handovers:[] });
  });

  it("sends the V2 parameter names and null initial cursor exactly", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: {contractVersion:"owner_inventory_report_v2",period,summary:{receivedMovementCount:0,deductedMovementCount:0,wasteMovementCount:0,movementCount:0,requestCount:0},movements:{items:[],nextCursor:null},requests:{items:[],nextCursor:null},waste:{items:[],nextCursor:null},quality:{...quality,state:"no_activity"}}, error: null } as never);
    await loadOwnerInventoryReport("restaurant-id", "today", null, null);
    expect(supabase.rpc).toHaveBeenCalledWith("get_owner_report_inventory_v2", { target_restaurant_id:"restaurant-id", requested_period:"today", custom_start_date:null, custom_end_date:null, detail_section:"initial", cursor_at:null, cursor_id:null, page_size:50 });
  });

  it("preserves unavailable cash values as null and rejects malformed detail",()=>{
    const report=parseOwnerCashierReport({contractVersion:"owner_cashier_report_v2",period,summary:{openShifts:1,shiftsRequiringReconciliation:0,recordedVariance:0,handoverCount:0},shifts:{items:[{id:"s1",cashierName:"Cashier",openedAt:"2026-09-29T08:00:00Z",closedAt:null,actualCash:null,variance:null,reconciliationStatus:"open"}],nextCursor:null},handovers:{items:[],nextCursor:null},quality});
    expect(report.shifts[0].actualCash).toBeNull();
    expect(()=>parseOwnerCashierReport({...report,contractVersion:"wrong"})).toThrow("Cashier report is unavailable");
  });
});
