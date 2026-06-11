export type Restaurant = {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
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
  price: number;
  image_url?: string | null;
  available: boolean;
};

export type MenuGroup = {
  category: MenuCategory;
  items: MenuItem[];
};
