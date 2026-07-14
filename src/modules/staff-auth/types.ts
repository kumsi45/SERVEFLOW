export type StaffRole = "owner" | "manager" | "cashier" | "kitchen";

export type StaffRestaurant = {
  id: string;
  name: string;
  role: StaffRole;
};

export type StaffSession = {
  userId: string;
  restaurants: StaffRestaurant[];
};

export type StaffDashboard = "cashier" | "kitchen" | "manager" | "owner";

export type StaffDestination = {
  dashboard: StaffDashboard;
  restaurant: StaffRestaurant;
};
