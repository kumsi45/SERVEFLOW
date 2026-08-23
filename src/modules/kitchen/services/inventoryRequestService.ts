import { supabase } from "../../../core/database";

export type InventoryRequestStatus = "pending" | "accepted" | "issued" | "delivered" | "rejected" | "unable_to_fulfill";
export type InventoryUrgency = "normal" | "high" | "critical";
export type InventoryRequest = { id:string; restaurantId:string; inventoryItemId:string|null; stationId:string|null; itemName:string; quantity:number; unit:string; urgency:InventoryUrgency; comment:string|null; status:InventoryRequestStatus; rejectionReason:string|null; requestedAt:string; reviewedAt:string|null; acceptedAt:string|null; rejectedAt:string|null; issuedAt:string|null; issuedQuantity:number|null; deliveredAt:string|null; confirmedAt:string|null; unableToFulfillAt:string|null; unableToFulfillReason:string|null; stationName:string|null; requesterName:string|null; reviewerName:string|null; fulfillerName:string|null; issuerName:string|null; confirmerName:string|null; unableToFulfillByName:string|null };
export type InventoryItem = { id:string; name:string; unit:string; currentQuantity:number; reorderLevel:number; active:boolean; supplierName?:string|null;supplierLeadDays?:number };
export type InventoryIntelligence={id:string;name:string;unit:string;currentQuantity:number;reorderLevel:number;supplierName:string|null;supplierLeadDays:number;dailyConsumption:number;weeklyConsumption:number;monthlyConsumption:number;remainingHours:number|null;suggestedReorderAt:string|null;movement:"fast"|"slow"|"normal"|"no_history";health:"critical"|"low"|"normal"|"healthy";supplierReminder:boolean;kitchenDemand:number};

type StaffName = {display_name?:string|null}|{display_name?:string|null}[]|null;
type RequestRow = { id:string;restaurant_id:string;inventory_item_id:string|null;station_id:string|null;item_name:string;quantity:number|string;unit:string;urgency:InventoryUrgency;comment:string|null;status:InventoryRequestStatus;rejection_reason:string|null;requested_at:string;reviewed_at:string|null;accepted_at:string|null;rejected_at:string|null;issued_at:string|null;issued_quantity:number|string|null;delivered_at:string|null;confirmed_at:string|null;unable_to_fulfill_at:string|null;unable_to_fulfill_reason:string|null;station?:{name?:string|null}|{name?:string|null}[]|null;requester?:StaffName;reviewer?:StaffName;fulfiller?:StaffName;issuer?:StaffName;confirmer?:StaffName;unable_actor?:StaffName };
const one=<T,>(value:T|T[]|null|undefined)=>Array.isArray(value)?value[0]??null:value??null;
export async function loadInventoryRequests(restaurantId:string){const {data,error}=await supabase.from("kitchen_inventory_requests").select("id,restaurant_id,inventory_item_id,station_id,item_name,quantity,unit,urgency,comment,status,rejection_reason,requested_at,reviewed_at,accepted_at,rejected_at,issued_at,issued_quantity,delivered_at,confirmed_at,unable_to_fulfill_at,unable_to_fulfill_reason,station:kitchen_stations!kitchen_requests_station_restaurant_fk(name),requester:restaurant_staff!kitchen_requests_requester_restaurant_fk(display_name),reviewer:restaurant_staff!kitchen_requests_reviewer_restaurant_fk(display_name),fulfiller:restaurant_staff!kitchen_requests_fulfiller_restaurant_fk(display_name),issuer:restaurant_staff!kitchen_requests_issuer_restaurant_fk(display_name),confirmer:restaurant_staff!kitchen_requests_confirmer_restaurant_fk(display_name),unable_actor:restaurant_staff!kitchen_requests_unable_actor_restaurant_fk(display_name)").eq("restaurant_id",restaurantId).order("requested_at",{ascending:false}).limit(200);if(error)throw new Error(error.message);return ((data??[]) as RequestRow[]).map(row=>({id:row.id,restaurantId:row.restaurant_id,inventoryItemId:row.inventory_item_id,stationId:row.station_id,itemName:row.item_name,quantity:Number(row.quantity),unit:row.unit,urgency:row.urgency,comment:row.comment,status:row.status,rejectionReason:row.rejection_reason,requestedAt:row.requested_at,reviewedAt:row.reviewed_at,acceptedAt:row.accepted_at,rejectedAt:row.rejected_at,issuedAt:row.issued_at,issuedQuantity:row.issued_quantity==null?null:Number(row.issued_quantity),deliveredAt:row.delivered_at,confirmedAt:row.confirmed_at,unableToFulfillAt:row.unable_to_fulfill_at,unableToFulfillReason:row.unable_to_fulfill_reason,stationName:one(row.station)?.name??null,requesterName:one(row.requester)?.display_name??null,reviewerName:one(row.reviewer)?.display_name??null,fulfillerName:one(row.fulfiller)?.display_name??null,issuerName:one(row.issuer)?.display_name??null,confirmerName:one(row.confirmer)?.display_name??null,unableToFulfillByName:one(row.unable_actor)?.display_name??null}));}
export async function loadInventoryItems(restaurantId:string){const {data,error}=await supabase.from("inventory_items").select("id,name,unit,current_quantity,reorder_level,active").eq("restaurant_id",restaurantId).eq("active",true).order("name");if(error)throw new Error(error.message);return (data??[]).map(row=>({id:row.id,name:row.name,unit:row.unit,currentQuantity:Number(row.current_quantity),reorderLevel:Number(row.reorder_level),active:row.active})) as InventoryItem[];}
export async function createInventoryRequest(restaurantId:string,input:{itemName:string;quantity:number;unit:string;urgency:InventoryUrgency;stationId?:string|null;comment?:string;inventoryItemId?:string|null}){const {error}=await supabase.rpc("create_kitchen_inventory_request",{target_restaurant_id:restaurantId,target_item_name:input.itemName,target_quantity:input.quantity,target_unit:input.unit,target_urgency:input.urgency,target_station_id:input.stationId??null,target_comment:input.comment??null,target_inventory_item_id:input.inventoryItemId??null});if(error)throw new Error(error.message);}

export type KitchenStockReceipt = {
  id: string;
  itemName: string;
  issuedQuantity: number;
  unit: string;
  stationId: string | null;
  stationName: string | null;
  storageLocationName: string | null;
  requestedAt: string;
  issuedAt: string | null;
  issuedByName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  status: "issued" | "delivered" | "rejected" | "unable_to_fulfill";
};

type KitchenStockReceiptRow = {
  request_id: string;
  item_name: string;
  issued_quantity: number | string | null;
  unit: string;
  station_id: string | null;
  station_name: string | null;
  storage_location_name: string | null;
  requested_at: string;
  issued_at: string | null;
  issued_by_name: string | null;
  confirmed_at: string | null;
  confirmed_by_name: string | null;
  request_status: KitchenStockReceipt["status"];
};

export function partitionKitchenStockReceipts(receipts: KitchenStockReceipt[]) {
  return {
    pending: receipts.filter((receipt) => receipt.status === "issued"),
    history: receipts.filter((receipt) => receipt.status !== "issued"),
  };
}

export async function loadKitchenStockReceipts(restaurantId: string) {
  const { data, error } = await supabase.rpc("get_kitchen_stock_receipts", {
    target_restaurant_id: restaurantId,
    target_history_limit: 40,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as KitchenStockReceiptRow[]).map((row) => ({
    id: row.request_id,
    itemName: row.item_name,
    issuedQuantity: Number(row.issued_quantity),
    unit: row.unit,
    stationId: row.station_id,
    stationName: row.station_name,
    storageLocationName: row.storage_location_name,
    requestedAt: row.requested_at,
    issuedAt: row.issued_at,
    issuedByName: row.issued_by_name,
    confirmedAt: row.confirmed_at,
    confirmedByName: row.confirmed_by_name,
    status: row.request_status,
  })) as KitchenStockReceipt[];
}

export function kitchenReceiptErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/already confirmed|not awaiting/i.test(message)) return "This request was already confirmed.";
  if (/access denied|permission|not authorized/i.test(message)) return "You do not have access to this request.";
  if (/not found|no longer/i.test(message)) return "This request is no longer available.";
  return "Unable to confirm receipt. Try again.";
}

export async function confirmKitchenStockReceipt(restaurantId: string, requestId: string) {
  const { error } = await supabase.rpc("confirm_kitchen_inventory_request_receipt", {
    target_restaurant_id: restaurantId,
    target_request_id: requestId,
  });
  if (error) throw new Error(error.message);
}
export async function processInventoryRequest(restaurantId:string,requestId:string,action:"accept"|"reject",reason?:string){const {error}=await supabase.rpc("process_kitchen_inventory_request",{target_restaurant_id:restaurantId,target_request_id:requestId,target_action:action,target_rejection_reason:reason??null});if(error)throw new Error(error.message);}

export function inventoryRequestStatusLabel(status:InventoryRequestStatus){if(status==="pending")return "Pending Review";if(status==="accepted")return "Awaiting Inventory";if(status==="issued")return "Issued · Awaiting Kitchen Confirmation";if(status==="delivered")return "Fulfilled";if(status==="rejected")return "Rejected";return "Unable to Fulfill";}
export async function loadInventoryIntelligence(restaurantId:string){const {data,error}=await supabase.rpc("get_inventory_intelligence",{target_restaurant_id:restaurantId});if(error)throw new Error(error.message);if(data&&typeof data==="object"&&!Array.isArray(data)&&"error" in data)throw new Error(String((data as {error:unknown}).error));return (Array.isArray(data)?data:[]).map((row:Record<string,unknown>)=>({id:String(row.id),name:String(row.name),unit:String(row.unit),currentQuantity:Number(row.current_quantity),reorderLevel:Number(row.reorder_level),supplierName:row.supplier_name?String(row.supplier_name):null,supplierLeadDays:Number(row.supplier_lead_days),dailyConsumption:Number(row.daily_consumption),weeklyConsumption:Number(row.weekly_consumption),monthlyConsumption:Number(row.monthly_consumption),remainingHours:row.remaining_hours==null?null:Number(row.remaining_hours),suggestedReorderAt:row.suggested_reorder_at?String(row.suggested_reorder_at):null,movement:String(row.movement) as InventoryIntelligence["movement"],health:String(row.health) as InventoryIntelligence["health"],supplierReminder:Boolean(row.supplier_reminder),kitchenDemand:Number(row.kitchen_demand)})) as InventoryIntelligence[];}
export async function saveInventoryItem(restaurantId:string,input:{id?:string|null;name:string;unit:string;currentQuantity:number;reorderLevel:number;supplierName?:string;supplierLeadDays?:number}){const {error}=await supabase.rpc("upsert_inventory_item",{target_restaurant_id:restaurantId,target_item_id:input.id??null,target_name:input.name,target_unit:input.unit,target_current_quantity:input.currentQuantity,target_reorder_level:input.reorderLevel,target_supplier_name:input.supplierName??null,target_supplier_lead_days:input.supplierLeadDays??1});if(error)throw new Error(error.message);}
