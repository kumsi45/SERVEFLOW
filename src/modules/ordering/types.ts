export type OrderingRestaurant = {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  cover_url?: string | null;
};

export type OrderingCategory = {
  id: string;
  restaurant_id: string;
  name: string;
  description?: string | null;
  display_order?: number | null;
  hero_image_url?: string | null;
};

export type OrderingMenuItem = {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description?: string | null;
  ingredients?: string[] | null;
  allergens?: string[] | null;
  preparation_time_minutes?: number | null;
  spice_level?: number | null;
  dietary_tags?: string[] | null;
  calories?: number | null;
  protein_g?: number | null;
  carbohydrates_g?: number | null;
  fat_g?: number | null;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
  price: number;
  image_url?: string | null;
  category_image_url?: string | null;
  effective_image_url?: string | null;
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
  status: "pending" | "pending_payment" | "paid" | "preparing" | "ready" | "completed" | "cancelled";
  total_price: number;
  created_at: string;
  session_action?: "created" | "appended";
};
