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
