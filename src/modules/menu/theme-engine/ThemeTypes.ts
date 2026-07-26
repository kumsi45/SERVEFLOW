import type { ComponentType, ReactNode } from "react";
import type { MenuLanguage } from "../../../core/menu/menuLanguage";
import type { PublicQrCartItem, PublicQrOrderSession, SubmittedPublicQrOrder } from "../../public-qr-ordering/types";
import type { MenuCategory, MenuItem, Restaurant } from "../../qr-menu/types";

export const MENU_THEMES = ["modern", "luxury", "premium_grid", "coffee"] as const;

export type MenuTheme = (typeof MENU_THEMES)[number];
export type ThemeCardStyle = "app" | "editorial" | "grid" | "cafe";
export type ThemeAnimationPreset = "subtle" | "elegant" | "snappy" | "warm";

export type ThemeConfig = {
  primaryColor: string;
  secondaryColor: string;
  background: string;
  cardStyle: ThemeCardStyle;
  typography: string;
  borderRadius: string;
  spacing: string;
  animationPreset: ThemeAnimationPreset;
};

export type ThemeCartSnapshot = {
  items: readonly PublicQrCartItem[];
  itemCount: number;
  subtotal: number;
  visible: boolean;
};

export type ThemeOrderSnapshot = {
  activeSession: PublicQrOrderSession | null;
  submittedOrder: SubmittedPublicQrOrder | null;
};

export type ThemeRendererProps = {
  restaurant: Restaurant;
  categories: readonly MenuCategory[];
  menu: readonly MenuItem[];
  cart: ThemeCartSnapshot;
  order: ThemeOrderSnapshot;
  theme: MenuTheme;
  language?: MenuLanguage;
  children?: ReactNode;
};

export type ThemeDefinition = ThemeConfig & {
  id: MenuTheme;
  name: string;
  preview: string;
  component: ComponentType<ThemeRendererProps>;
};

export type ThemeRegistry = Readonly<Record<MenuTheme, Readonly<ThemeDefinition>>>;

export type ThemeContext = {
  theme: MenuTheme;
  definition: Readonly<ThemeDefinition>;
  setTheme: (theme: MenuTheme) => void;
};

export function isMenuTheme(value: unknown): value is MenuTheme {
  return typeof value === "string" && MENU_THEMES.includes(value as MenuTheme);
}

export function resolveMenuTheme(value: unknown): MenuTheme {
  return isMenuTheme(value) ? value : "modern";
}
