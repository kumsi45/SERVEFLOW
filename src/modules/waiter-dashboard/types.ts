export type WaiterTableStatus =
  | "available"
  | "occupied"
  | "qr_ordering"
  | "reserved"
  | "needs_attention";

export type WaiterDashboardTable = {
  restaurantId: string;
  restaurantSlug: string;
  restaurantName: string;
  restaurantLogoUrl: string | null;
  waiterStaffId: string;
  waiterDisplayName: string;
  currentShift: string;
  assignmentMode: "assigned_tables" | "all_tables";
  tableId: string;
  tableNumber: number;
  tableLabel: string | null;
  seats: number;
  tableActive: boolean;
  assignedWaiterStaffId: string | null;
  assignedWaiterName: string | null;
  tableStatus: WaiterTableStatus;
  activeOrderId: string | null;
  activeOrderStatus: string | null;
  activeOrderSource: string | null;
  qrCustomerName: string | null;
  activeOrderCreatedAt: string | null;
};

export type WaiterDashboardSummary = {
  restaurantId: string;
  restaurantSlug: string;
  restaurantName: string;
  restaurantLogoUrl: string | null;
  waiterStaffId: string;
  waiterDisplayName: string;
  currentShift: string;
  assignmentMode: "assigned_tables" | "all_tables";
};

export type WaiterSessionInvoice = {
  id: string;
  displayNumber: string;
  status: string;
  kitchenStatus: string;
  total: number;
  createdAt: string;
  creatorName: string | null;
  items: Array<{ id: string; name: string; quantity: number; price: number; kitchenStatus: string }>;
};

export type WaiterSessionDetail = {
  orderId: string;
  sessionNumber: string;
  openedAt: string;
  customerName: string | null;
  source: string;
  creatorName: string | null;
  total: number;
  invoices: WaiterSessionInvoice[];
};

export type WaiterTableMetric = {
  total: number;
  invoiceCount: number;
  sessionNumber: string;
  invoiceNumbers: string[];
};
