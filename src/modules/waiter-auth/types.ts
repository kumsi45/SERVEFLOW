export type WaiterRestaurant = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  currencyCode?: string | null;
  currencySymbol?: string | null;
  locale?: string | null;
  tableStatus?: {
    total: number;
    available: number;
    occupied: number;
    other: number;
  } | null;
};

export type WaiterSession = {
  staffId: string;
  userId: string;
  username?: string;
  displayName: string;
  restaurant: WaiterRestaurant;
  signedInAt: string;
};

export type WaiterTerminalContext = WaiterRestaurant;

export type WaiterTerminalProfile = {
  staffId: string;
  employeeId: string;
  displayName: string;
  role: "Waiter";
  shift: string | null;
};
