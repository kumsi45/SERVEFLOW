import { supabase } from "../../../core/database";

export type PrinterPurpose = "receipt" | "kitchen_order" | "station" | "backup" | "future" | "kds";
export type KitchenOutputMode = "single_kitchen_printer" | "station_printers" | "kds" | "kds_and_printers";
export type PaymentPolicyCode = "pay_before_kitchen" | "kitchen_before_payment" | "mixed";

export type OwnerPrinter = {
  id: string; restaurant_id: string; name: string; purpose: PrinterPurpose;
  brand: string; model: string | null; printer_type: string; paper_size: string;
  status: string; enabled: boolean; is_default: boolean; priority: number;
  backup_for_purpose: string | null; physical_location: string | null;
};
export type PrinterConnection = {
  id: string; restaurant_id: string; printer_id: string; connection_type: "usb" | "network" | "bluetooth";
  usb_vendor_id: string | null; usb_product_id: string | null; network_host: string | null;
  network_port: number | null; active: boolean;
};
export type PrinterCapability = { id: string; restaurant_id: string; printer_id: string; capability_code: string; supported: boolean; capability_value: string | null };
export type StationPrinterMapping = { id: string; restaurant_id: string; kitchen_station_id: string; printer_id: string; active: boolean };
export type BusinessPaymentMethod = { id: string; restaurant_id: string; method_code: string; display_name: string; enabled: boolean; is_default: boolean; display_order: number; cash_change_limit: number | null };
export type BusinessPaymentAccount = { id: string; restaurant_id: string; payment_method_id: string; provider_code: string; business_name: string | null; account_name: string | null; account_number: string | null; phone_number: string | null; reference_format: string | null; qr_image_url: string | null; instructions: string | null; status: string; display_order: number; deleted_at: string | null };
export type PrintingSettings = { id: string; restaurant_id: string; kitchen_output_mode: KitchenOutputMode; default_print_behaviour: "on_demand" | "automatic"; print_order_copies: number; print_receipt_copies: number };
export type DailyClosing = { id: string; restaurant_id: string; enabled: boolean; closing_time: string; timezone: string; reminder_enabled: boolean; reminder_minutes_before: number; require_cash_reconciliation: boolean };

export type PrintingPaymentConfiguration = {
  printing: PrintingSettings;
  printers: OwnerPrinter[];
  connections: PrinterConnection[];
  capabilities: PrinterCapability[];
  mappings: StationPrinterMapping[];
  paymentPolicy: PaymentPolicyCode;
  vatEnabled: boolean;
  vatPercentage: number;
  vatPriceMode: "included_in_price" | "added_after_price";
  serviceChargeEnabled: boolean;
  serviceChargePercentage: number;
  serviceChargeMode: "percentage" | "fixed_amount";
  serviceChargeFixedAmount: number;
  commissionEnabled: boolean;
  commissionPercentage: number;
  methods: BusinessPaymentMethod[];
  accounts: BusinessPaymentAccount[];
  dailyClosing: DailyClosing;
};

function required<T>(data: T | null, message: string): T {
  if (!data) throw new Error(message);
  return data;
}

export async function loadPrintingPaymentConfiguration(restaurantId: string): Promise<PrintingPaymentConfiguration> {
  const [restaurant, printing, printers, connections, capabilities, mappings, methods, accounts, closing] = await Promise.all([
    supabase.from("restaurants").select("payment_policy,vat_enabled,vat_percentage,vat_price_mode,service_charge_enabled,service_charge_percentage,service_charge_mode,service_charge_fixed_amount,commission_enabled,commission_percentage").eq("id", restaurantId).single(),
    supabase.from("business_printing_settings").select("id,restaurant_id,kitchen_output_mode,default_print_behaviour,print_order_copies,print_receipt_copies").eq("restaurant_id", restaurantId).single(),
    supabase.from("business_printers").select("id,restaurant_id,name,purpose,brand,model,printer_type,paper_size,status,enabled,is_default,priority,backup_for_purpose,physical_location").eq("restaurant_id", restaurantId).is("deleted_at", null).order("priority"),
    supabase.from("printer_connections").select("id,restaurant_id,printer_id,connection_type,usb_vendor_id,usb_product_id,network_host,network_port,active").eq("restaurant_id", restaurantId).is("deleted_at", null),
    supabase.from("printer_capabilities").select("id,restaurant_id,printer_id,capability_code,supported,capability_value").eq("restaurant_id", restaurantId),
    supabase.from("printer_station_mappings").select("id,restaurant_id,kitchen_station_id,printer_id,active").eq("restaurant_id", restaurantId).is("deleted_at", null),
    supabase.from("business_payment_methods").select("id,restaurant_id,method_code,display_name,enabled,is_default,display_order,cash_change_limit").eq("restaurant_id", restaurantId).order("display_order"),
    supabase.from("business_payment_accounts").select("id,restaurant_id,payment_method_id,provider_code,business_name,account_name,account_number,phone_number,reference_format,qr_image_url,instructions,status,display_order,deleted_at").eq("restaurant_id", restaurantId).is("deleted_at", null).order("display_order"),
    supabase.from("business_daily_closing_config").select("id,restaurant_id,enabled,closing_time,timezone,reminder_enabled,reminder_minutes_before,require_cash_reconciliation").eq("restaurant_id", restaurantId).single(),
  ]);
  const failed = [restaurant, printing, printers, connections, capabilities, mappings, methods, accounts, closing].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  const financial = required(restaurant.data as Record<string, unknown> | null, "Business financial configuration is unavailable.");
  return {
    printing: required(printing.data as PrintingSettings | null, "Printing configuration is unavailable."),
    printers: (printers.data ?? []) as OwnerPrinter[], connections: (connections.data ?? []) as PrinterConnection[],
    capabilities: (capabilities.data ?? []) as PrinterCapability[], mappings: (mappings.data ?? []) as StationPrinterMapping[],
    paymentPolicy: financial.payment_policy as PaymentPolicyCode,
    vatEnabled: Boolean(financial.vat_enabled), vatPercentage: Number(financial.vat_percentage ?? 0),
    vatPriceMode: financial.vat_price_mode as PrintingPaymentConfiguration["vatPriceMode"],
    serviceChargeEnabled: Boolean(financial.service_charge_enabled), serviceChargePercentage: Number(financial.service_charge_percentage ?? 0),
    serviceChargeMode: financial.service_charge_mode as PrintingPaymentConfiguration["serviceChargeMode"],
    serviceChargeFixedAmount: Number(financial.service_charge_fixed_amount ?? 0), commissionEnabled: Boolean(financial.commission_enabled),
    commissionPercentage: Number(financial.commission_percentage ?? 0), methods: (methods.data ?? []) as BusinessPaymentMethod[],
    accounts: (accounts.data ?? []) as BusinessPaymentAccount[], dailyClosing: required(closing.data as DailyClosing | null, "Daily closing configuration is unavailable."),
  };
}

export async function savePrintingPaymentConfiguration(restaurantId: string, config: PrintingPaymentConfiguration) {
  const writes = [
    supabase.from("restaurants").update({ payment_policy: config.paymentPolicy, vat_enabled: config.vatEnabled, vat_percentage: config.vatPercentage, vat_price_mode: config.vatPriceMode, service_charge_enabled: config.serviceChargeEnabled, service_charge_percentage: config.serviceChargePercentage, service_charge_mode: config.serviceChargeMode, service_charge_fixed_amount: config.serviceChargeFixedAmount, commission_enabled: config.commissionEnabled, commission_percentage: config.commissionPercentage }).eq("id", restaurantId),
    supabase.from("business_printing_settings").upsert({ ...config.printing, restaurant_id: restaurantId }, { onConflict: "restaurant_id" }),
    supabase.from("business_daily_closing_config").upsert({ ...config.dailyClosing, restaurant_id: restaurantId }, { onConflict: "restaurant_id" }),
  ];
  const results = await Promise.all(writes);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  for (const printer of config.printers) {
    const { error } = await supabase.rpc("save_business_printer", { target_restaurant_id: restaurantId, printer_payload: printer });
    if (error) throw new Error(error.message);
  }
  for (const connection of config.connections) {
    const { error } = await supabase.from("printer_connections").upsert({ ...connection, restaurant_id: restaurantId }, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  for (const capability of config.capabilities) {
    const { error } = await supabase.from("printer_capabilities").upsert({ ...capability, restaurant_id: restaurantId }, { onConflict: "restaurant_id,printer_id,capability_code" });
    if (error) throw new Error(error.message);
  }
  for (const mapping of config.mappings) {
    const { error } = await supabase.from("printer_station_mappings").upsert({ ...mapping, restaurant_id: restaurantId }, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  for (const method of config.methods) {
    const { error } = await supabase.from("business_payment_methods").update({ enabled: method.enabled, is_default: method.is_default, cash_change_limit: method.cash_change_limit, display_order: method.display_order }).eq("restaurant_id", restaurantId).eq("id", method.id);
    if (error) throw new Error(error.message);
  }
  for (const account of config.accounts) {
    const { error } = await supabase.from("business_payment_accounts").upsert({ ...account, restaurant_id: restaurantId }, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

export async function softDeletePaymentAccount(restaurantId: string, accountId: string) {
  const { error } = await supabase.from("business_payment_accounts").update({ deleted_at: new Date().toISOString(), status: "inactive" }).eq("restaurant_id", restaurantId).eq("id", accountId);
  if (error) throw new Error(error.message);
}
