export type PublicQrCartItem = {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

export type AddPublicQrCartItemInput = {
  menuItemId: string;
  name: string;
  price: number;
  quantity?: number;
  notes?: string;
};

export type SubmittedPublicQrOrder = {
  order_id: string;
  display_number?: string | null;
  dining_session_display_number?: string | null;
  invoice_id?: string | null;
  invoice_display_number?: string | null;
  kitchen_ticket_number?: string | null;
  invoice_number?: number | null;
  invoice_status?: "pending" | "paid" | "cancelled" | string | null;
  invoice_total?: number;
  status: string;
  total_price: number;
  table_number?: string | null;
  customer_name?: string | null;
  payment_method?: PublicQrPaymentMethod | null;
  created_at: string;
  session_action?: "created" | "appended";
  appended_at?: string | null;
  added_total?: number;
  items_added?: PublicQrSessionItem[];
};

export type PublicQrSessionItem = {
  id: string;
  invoice_id?: string | null;
  invoice_status?: string | null;
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  kitchen_status?: string | null;
  appended_at?: string | null;
  created_at?: string | null;
};

export type PublicQrOrderInvoice = {
  id: string;
  display_number?: string | null;
  kitchen_ticket_number?: string | null;
  invoice_number: number;
  status: "pending" | "paid" | "cancelled" | string;
  total_price: number;
  payment_method?: PublicQrPaymentMethod | null;
  paid_at?: string | null;
  locked_at?: string | null;
  created_at?: string | null;
};

export type PublicQrOrderSession = {
  order_id: string;
  display_number?: string | null;
  dining_session_display_number?: string | null;
  status: string;
  total_price: number;
  table_number?: string | null;
  customer_name?: string | null;
  payment_method?: PublicQrPaymentMethod | null;
  created_at: string;
  payment_verified_at?: string | null;
  items: PublicQrSessionItem[];
  invoices: PublicQrOrderInvoice[];
};

export type SmartQrPortalState = {
  mode: "available" | "customer" | "waiter" | "occupied";
  restaurant_id: string;
  restaurant_name: string;
  table_number: number | string;
  order_id?: string | null;
  display_number?: string | null;
  dining_session_display_number?: string | null;
  status?: string;
  total_price?: number;
  subtotal?: number;
  vat_amount?: number;
  service_charge_amount?: number;
  discount_amount?: number;
  grand_total?: number;
  created_at?: string;
  items?: PublicQrSessionItem[];
  invoices?: PublicQrOrderInvoice[];
};

export const PUBLIC_QR_PAYMENT_METHODS = [
  "Cash",
  "Telebirr",
  "CBE Birr",
  "Mobile Banking",
  "Bank Transfer",
  "Card",
] as const;

export type PublicQrPaymentMethod = (typeof PUBLIC_QR_PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PublicQrPaymentMethod {
  return PUBLIC_QR_PAYMENT_METHODS.includes(value as PublicQrPaymentMethod);
}
