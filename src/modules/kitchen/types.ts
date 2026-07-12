export type KitchenOrderStatus = "paid" | "preparing" | "ready" | "completed";
export type KitchenStationStatus = "waiting" | "preparing" | "ready" | "completed";

export type KitchenOrderItem = {
  id: string;
  orderId: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
  appendedAt?: string | null;
  kitchenStationId?: string | null;
  kitchenStationName?: string | null;
  kitchenStatus?: KitchenOrderStatus | null;
};

export type KitchenOrder = {
  id: string;
  displayNumber?: string | null;
  kitchenTicketNumber?: string | null;
  kitchenBatchKey: string | null;
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
  stationProgress: KitchenOrderStationProgress[];
};

export type KitchenRestaurant = {
  id: string;
  name: string;
};

export type KitchenStation = {
  id: string;
  name: string;
  displayColor?: string | null;
  icon?: string | null;
  active?: boolean;
};

export type KitchenOrderStationProgress = {
  stationId: string;
  stationName: string;
  stationStatus: KitchenStationStatus;
  itemCount: number;
  readyCount: number;
  completedCount: number;
  startedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
};

export type KitchenDashboardContext = {
  restaurant: KitchenRestaurant;
  role: "kitchen" | "owner";
  assignedStation: KitchenStation | null;
  stations: KitchenStation[];
};
