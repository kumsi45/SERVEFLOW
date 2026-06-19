export type CashierOrderStatus = "pending_payment" | "paid";

export type CashierOrderItem = {
  id: string;
  orderId: string;
  name: string;
  quantity: number;
  price: number;
};

export type CashierOrder = {
  id: string;
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
