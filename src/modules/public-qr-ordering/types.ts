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
  created_at: string;
};
