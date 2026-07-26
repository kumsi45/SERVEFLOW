import type { MenuTheme } from "../menu/theme-engine/ThemeTypes";
import type { MenuLocalizationMap } from "../../core/menu/menuLanguage";

export type Restaurant = {
  id: string;
  name: string;
  slug: string;
  table_count?: number | null;
  total_tables?: number | null;
  logo_url?: string | null;
  cover_url?: string | null;
  ordering_settings?: Record<string, unknown> | null;
  currency_code?: string | null;
  currency_symbol?: string | null;
  locale?: string | null;
  menu_theme?: MenuTheme | null;
};

export type MenuCategory = {
  id: string;
  restaurant_id: string;
  name: string;
  description?: string | null;
  display_order?: number | null;
  hero_image_url?: string | null;
  localizations?: MenuLocalizationMap | null;
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
  category_image_url?: string | null;
  effective_image_url?: string | null;
  available: boolean;
  localizations?: MenuLocalizationMap | null;
};

export type MenuGroup = {
  category: MenuCategory;
  items: MenuItem[];
};
