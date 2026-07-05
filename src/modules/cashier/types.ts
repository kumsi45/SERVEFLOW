export type CashierOrderStatus = "pending_payment" | "paid" | "preparing" | "ready" | "completed" | "cancelled";

export type CashierOrderItem = {
  id: string;
  orderId: string;
  invoiceId?: string | null;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
  appendedAt?: string | null;
  kitchenStatus?: string | null;
};

export type CashierOrder = {
  id: string;
  invoiceId?: string | null;
  invoiceNumber?: number | null;
  invoiceStatus?: "pending" | "paid" | "cancelled" | string | null;
  invoicePaidAt?: string | null;
  invoiceLockedAt?: string | null;
  status: CashierOrderStatus;
  customerName: string | null;
  tableNumber: string | null;
  paymentMethod: string | null;
  totalPrice: number;
  createdAt: string;
  paymentVerifiedAt: string | null;
  items: CashierOrderItem[];
};

export type CashierRestaurant = {
  id: string;
  name: string;
  logoUrl: string | null;
};
