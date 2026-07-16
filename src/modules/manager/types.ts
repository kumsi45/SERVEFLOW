export type ManagerRestaurant = {
  id: string;
  name: string;
  logoUrl: string | null;
  currentShift: string;
};

export type ManagerKpis = {
  activeDiningSessions: number;
  kitchenWaiting: number;
  kitchenPreparing: number;
  awaitingCashier: number;
  staffOnDuty: number;
  occupiedTables: number;
};

export type ManagerLiveMetrics = {
  revenueToday: number;
  revenueThisShift: number;
  ordersToday: number;
  ordersPending: number;
  ordersPreparing: number;
  ordersReady: number;
  ordersCompleted: number;
  ordersCancelled: number;
  pendingPayments: number;
  paymentDueAmount: number;
  refunds: number;
  averageCollectionMinutes: number;
  cashCollected: number;
  cardPayments: number;
  mobilePayments: number;
  digitalCollected: number;
  paymentMethodTotals: Record<string, number>;
  averageOrder: number;
};

export type ManagerFloorTableStatus =
  | "available"
  | "occupied"
  | "qr_ordering"
  | "waiting"
  | "kitchen_delay"
  | "waiting_pickup"
  | "waiting_payment"
  | "long_session"
  | "inactive";

export type ManagerKitchenStatus =
  "idle" | "waiting" | "preparing" | "ready" | "completed";
export type ManagerCashierStatus =
  "open" | "waiting_payment" | "billing" | "paid" | "none";
export type ManagerOperationAlertType =
  | "waiting"
  | "kitchen_delay"
  | "waiting_payment"
  | "waiting_pickup"
  | "long_session";

export type ManagerOperationAlert = {
  type: ManagerOperationAlertType;
  label: string;
  minutes: number;
};

export type ManagerFloorTable = {
  id: string;
  number: number;
  label: string;
  seats: number | null;
  active: boolean;
  status: ManagerFloorTableStatus;
  activeOrderId: string | null;
  activeOrderStatus: string | null;
  activeOrderSource: string | null;
  customerName: string | null;
  openedAt: string | null;
  assignedWaiterName: string | null;
  runningBill: number;
  sessionDurationMinutes: number | null;
  kitchenStatus: ManagerKitchenStatus;
  cashierStatus: ManagerCashierStatus;
  itemCount: number;
  readyItemCount: number;
  invoiceCount: number;
  alerts: ManagerOperationAlert[];
};

export type ManagerDashboardSnapshot = {
  restaurant: ManagerRestaurant;
  kpis: ManagerKpis;
  liveMetrics: ManagerLiveMetrics;
  floorTables: ManagerFloorTable[];
  notifications: string[];
};
