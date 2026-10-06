import { supabase } from "../../../core/database";

export type BusinessPaymentMethod = {
  id: string;
  restaurant_id: string;
  method_code: string;
  display_name: string;
  enabled: boolean;
  is_default: boolean;
  display_order: number;
  cash_change_limit: number | null;
};

export type BusinessPaymentAccount = {
  id: string;
  restaurant_id: string;
  payment_method_id: string;
  provider_code: string;
  business_name: string | null;
  account_name: string | null;
  account_number: string | null;
  phone_number: string | null;
  reference_format: string | null;
  qr_image_url: string | null;
  instructions: string | null;
  status: string;
  display_order: number;
  deleted_at: string | null;
};

export type PaymentConfiguration = {
  vatEnabled: boolean;
  vatPercentage: number;
  serviceChargeEnabled: boolean;
  serviceChargePercentage: number;
  methods: BusinessPaymentMethod[];
  accounts: BusinessPaymentAccount[];
};

export async function loadPaymentConfiguration(restaurantId: string): Promise<PaymentConfiguration> {
  const [restaurant, methods, accounts] = await Promise.all([
    supabase.from("restaurants")
      .select("vat_enabled,vat_percentage,service_charge_enabled,service_charge_percentage")
      .eq("id", restaurantId)
      .single(),
    supabase.from("business_payment_methods")
      .select("id,restaurant_id,method_code,display_name,enabled,is_default,display_order,cash_change_limit")
      .eq("restaurant_id", restaurantId)
      .order("display_order"),
    supabase.from("business_payment_accounts")
      .select("id,restaurant_id,payment_method_id,provider_code,business_name,account_name,account_number,phone_number,reference_format,qr_image_url,instructions,status,display_order,deleted_at")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("display_order"),
  ]);
  const failed = [restaurant, methods, accounts].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  if (!restaurant.data) throw new Error("Business payment configuration is unavailable.");

  return {
    vatEnabled: Boolean(restaurant.data.vat_enabled),
    vatPercentage: Number(restaurant.data.vat_percentage ?? 0),
    serviceChargeEnabled: Boolean(restaurant.data.service_charge_enabled),
    serviceChargePercentage: Number(restaurant.data.service_charge_percentage ?? 0),
    methods: (methods.data ?? []) as BusinessPaymentMethod[],
    accounts: (accounts.data ?? []) as BusinessPaymentAccount[],
  };
}

export async function savePaymentConfiguration(restaurantId: string, config: PaymentConfiguration) {
  const { error: financialError } = await supabase.rpc("set_restaurant_financial_settings", {
    target_restaurant_id: restaurantId,
    requested_vat_enabled: config.vatEnabled,
    requested_vat_percentage: config.vatPercentage,
    requested_service_charge_enabled: config.serviceChargeEnabled,
    requested_service_charge_percentage: config.serviceChargePercentage,
  });
  if (financialError) throw new Error(financialError.message);

  for (const method of config.methods) {
    const { error } = await supabase.from("business_payment_methods").update({
      enabled: method.enabled,
      is_default: method.is_default,
      display_order: method.display_order,
    }).eq("restaurant_id", restaurantId).eq("id", method.id);
    if (error) throw new Error(error.message);
  }

  for (const account of config.accounts) {
    const { error } = await supabase.from("business_payment_accounts").upsert({
      ...account,
      restaurant_id: restaurantId,
    }, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

export async function savePaymentAccount(restaurantId: string, account: BusinessPaymentAccount) {
  const { error } = await supabase.from("business_payment_accounts").upsert({
    ...account,
    restaurant_id: restaurantId,
  }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

export async function softDeletePaymentAccount(restaurantId: string, accountId: string) {
  const { error } = await supabase.from("business_payment_accounts").update({
    deleted_at: new Date().toISOString(),
    status: "inactive",
  }).eq("restaurant_id", restaurantId).eq("id", accountId);
  if (error) throw new Error(error.message);
}
