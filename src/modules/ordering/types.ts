export type OrderingRestaurant = {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
};

export type OrderingCategory = {
  id: string;
  restaurant_id: string;
  name: string;
};

export type OrderingMenuItem = {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  available: boolean;
};

export type OrderingMenuData = {
  restaurant: OrderingRestaurant;
  categories: OrderingCategory[];
  items: OrderingMenuItem[];
};

export type CartLine = {
  menuItemId: string;
  quantity: number;
};

export type CartLineDetail = CartLine & {
  item: OrderingMenuItem;
  lineTotal: number;
};

export type SubmittedOrder = {
  order_id: string;
  status: "pending" | "preparing" | "ready" | "completed";
  total_price: number;
  created_at: string;
};
