export type KitchenOrderStatus = "paid" | "preparing" | "ready";

export type KitchenOrderItem = {
  id: string;
  orderId: string;
  name: string;
  quantity: number;
  price: number;
};

export type KitchenOrder = {
  id: string;
  status: KitchenOrderStatus;
  customerName: string | null;
  tableNumber: string | null;
  paymentMethod: string | null;
  totalPrice: number;
  createdAt: string;
  paymentVerifiedAt: string | null;
  preparationStartedAt: string | null;
  readyMarkedAt: string | null;
  items: KitchenOrderItem[];
};

export type KitchenRestaurant = {
  id: string;
  name: string;
};
