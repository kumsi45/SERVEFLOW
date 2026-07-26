import { ThemeCoffee } from "./themes/ThemeCoffee";
import { ThemeLuxury } from "./themes/ThemeLuxury";
import { ThemeModern } from "./themes/ThemeModern";
import { ThemePremiumGrid } from "./themes/ThemePremiumGrid";
import type { MenuTheme, ThemeRegistry } from "./ThemeTypes";

export const themeRegistry = Object.freeze({
  modern: Object.freeze({
    id: "modern",
    name: "Modern Food App",
    preview: "Modern mobile-first menu preview",
    component: ThemeModern,
    primaryColor: "#1457d9",
    secondaryColor: "#12b76a",
    background: "#f7f8fb",
    cardStyle: "app",
    typography: "Inter, system-ui, sans-serif",
    borderRadius: "16px",
    spacing: "comfortable",
    animationPreset: "subtle",
  }),
  luxury: Object.freeze({
    id: "luxury",
    name: "Luxury Restaurant",
    preview: "Luxury editorial menu preview",
    component: ThemeLuxury,
    primaryColor: "#342b20",
    secondaryColor: "#c7a15a",
    background: "#f8f3ea",
    cardStyle: "editorial",
    typography: "Georgia, serif",
    borderRadius: "4px",
    spacing: "spacious",
    animationPreset: "elegant",
  }),
  premium_grid: Object.freeze({
    id: "premium_grid",
    name: "Premium Card Grid",
    preview: "Premium visual card-grid preview",
    component: ThemePremiumGrid,
    primaryColor: "#111827",
    secondaryColor: "#7c3aed",
    background: "#f3f4f6",
    cardStyle: "grid",
    typography: "Inter, system-ui, sans-serif",
    borderRadius: "20px",
    spacing: "compact",
    animationPreset: "snappy",
  }),
  coffee: Object.freeze({
    id: "coffee",
    name: "Coffee Shop",
    preview: "Warm coffee-shop menu preview",
    component: ThemeCoffee,
    primaryColor: "#5b3726",
    secondaryColor: "#d49a63",
    background: "#fff8ef",
    cardStyle: "cafe",
    typography: "Avenir, system-ui, sans-serif",
    borderRadius: "14px",
    spacing: "cozy",
    animationPreset: "warm",
  }),
} satisfies ThemeRegistry);

export function getThemeDefinition(theme: MenuTheme) {
  return themeRegistry[theme];
}
