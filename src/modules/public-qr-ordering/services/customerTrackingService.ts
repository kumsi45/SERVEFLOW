export type CustomerTrackingRecord = {
  restaurant_slug: string;
  session_id: string;
  order_id: string;
  invoice_id: string;
  table_number: string;
  qr_token: string;
  browser_session_token: string;
  operational_status?: string;
  payment_status?: string;
  updated_at: string;
};

const PREFIX = "serveflow.customerTracking";

function key(restaurantSlug: string) {
  return `${PREFIX}:${restaurantSlug.trim().toLowerCase()}`;
}

export function readCustomerTracking(restaurantSlug: string): CustomerTrackingRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(key(restaurantSlug)) ?? "null") as Partial<CustomerTrackingRecord> | null;
    if (!value || value.restaurant_slug !== restaurantSlug || !value.session_id || !value.order_id) return null;
    return value as CustomerTrackingRecord;
  } catch {
    return null;
  }
}

export function persistCustomerTracking(record: CustomerTrackingRecord) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(record.restaurant_slug), JSON.stringify(record));
  } catch {
    // Tracking continues in memory when browser storage is unavailable.
  }
}
