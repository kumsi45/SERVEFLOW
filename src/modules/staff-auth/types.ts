export type StaffRole = "owner" | "manager" | "cashier" | "kitchen" | "inventory" | "inventory_officer";

export type StaffRestaurant = {
  id: string;
  name: string;
  role: StaffRole;
  displayName?: string | null;
  currencyCode?: string | null;
  currencySymbol?: string | null;
  locale?: string | null;
};

export type StaffSession = {
  userId: string;
  restaurants: StaffRestaurant[];
};

export type StaffDashboard = "cashier" | "kitchen" | "manager" | "owner" | "inventory";

export type StaffDestination = {
  dashboard: StaffDashboard;
  restaurant: StaffRestaurant;
};
