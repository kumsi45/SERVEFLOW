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
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  kitchen_status?: string | null;
  appended_at?: string | null;
  created_at?: string | null;
};

export type PublicQrOrderSession = {
  order_id: string;
  status: string;
  total_price: number;
  table_number?: string | null;
  customer_name?: string | null;
  payment_method?: PublicQrPaymentMethod | null;
  created_at: string;
  payment_verified_at?: string | null;
  items: PublicQrSessionItem[];
};

export const PUBLIC_QR_PAYMENT_METHODS = [
  "Cash",
  "Telebirr",
  "CBE Birr",
  "Mobile Banking",
  "Chapa",
  "Credit/Debit Card",
] as const;

export type PublicQrPaymentMethod = (typeof PUBLIC_QR_PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PublicQrPaymentMethod {
  return PUBLIC_QR_PAYMENT_METHODS.includes(value as PublicQrPaymentMethod);
}
