export type Restaurant = {
  id: string;
  name: string;
  slug: string;
  table_count?: number | null;
  total_tables?: number | null;
  logo_url?: string | null;
  cover_url?: string | null;
};

export type MenuCategory = {
  id: string;
  restaurant_id: string;
  name: string;
};

export type MenuItem = {
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
  available: boolean;
};

export type MenuGroup = {
  category: MenuCategory;
  items: MenuItem[];
};
