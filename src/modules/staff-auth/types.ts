export type StaffRole = "owner" | "cashier" | "kitchen";

export type StaffRestaurant = {
  id: string;
  name: string;
  role: StaffRole;
};

export type StaffSession = {
  userId: string;
  role: StaffRole;
  restaurants: StaffRestaurant[];
};
