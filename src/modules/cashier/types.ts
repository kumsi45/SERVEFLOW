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
  displayNumber?: string | null;
  invoiceId?: string | null;
  invoiceDisplayNumber?: string | null;
  kitchenTicketNumber?: string | null;
  invoiceSource?: string | null;
  invoiceCreatorName?: string | null;
  invoiceKitchenStatus?: string | null;
  invoiceNumber?: number | null;
  invoiceStatus?: "pending" | "verified" | "paid" | "rejected" | "cancelled" | "refunded" | string | null;
  invoicePaidAt?: string | null;
  invoiceLockedAt?: string | null;
  invoiceVerifiedAt?: string | null;
  invoiceVerifiedBy?: string | null;
  invoiceVerifiedByName?: string | null;
  invoiceRejectedAt?: string | null;
  invoiceRejectionReason?: string | null;
  invoiceRetryRequestedAt?: string | null;
  referenceNumber?: string | null;
  transactionId?: string | null;
  screenshotUrl?: string | null;
  diningSessionId?: string | null;
  diningSessionDisplayNumber?: string | null;
  diningSessionStatus?: "open" | "closed" | "abandoned" | "expired" | "checked_out" | string | null;
  orderBatchId?: string | null;
  status: CashierOrderStatus;
  customerName: string | null;
  customerPhone?: string | null;
  tableNumber: string | null;
  orderSource?: string | null;
  waiterName?: string | null;
  orderNote?: string | null;
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
