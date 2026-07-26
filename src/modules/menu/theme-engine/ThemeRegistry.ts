import { ThemeCoffee } from "./themes/ThemeCoffee";
import { ThemeLuxury } from "./themes/ThemeLuxury";
import { ThemeModern } from "./themes/ThemeModern";
import { ThemePremiumGrid } from "./themes/ThemePremiumGrid";
import type { MenuTheme, ThemeRegistry } from "./ThemeTypes";

export const themeRegistry = Object.freeze({
  modern: Object.freeze({
    id: "modern",
    name: "Modern",
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
    name: "Premium Luxury",
    preview: "Black and gold fine-dining menu",
    component: ThemeLuxury,
    primaryColor: "#0b0b0a",
    secondaryColor: "#d7b56d",
    background: "#11110f",
    cardStyle: "editorial",
    typography: "Cormorant Garamond, Georgia, serif",
    borderRadius: "18px",
    spacing: "spacious",
    animationPreset: "elegant",
  }),
  premium_grid: Object.freeze({
    id: "premium_grid",
    name: "Premium Grid",
    preview: "Image-first premium food grid",
    component: ThemePremiumGrid,
    primaryColor: "#3a1711",
    secondaryColor: "#d6ae58",
    background: "#fff7e8",
    cardStyle: "grid",
    typography: "Inter, system-ui, sans-serif",
    borderRadius: "20px",
    spacing: "comfortable",
    animationPreset: "subtle",
  }),
  coffee: Object.freeze({
    id: "coffee",
    name: "Brew & Bite",
    preview: "Warm premium coffee-shop menu",
    component: ThemeCoffee,
    primaryColor: "#493426",
    secondaryColor: "#aa7541",
    background: "#f8ead7",
    cardStyle: "cafe",
    typography: "Georgia, Times New Roman, serif",
    borderRadius: "20px",
    spacing: "cozy",
    animationPreset: "warm",
  }),
} satisfies ThemeRegistry);

export function getThemeDefinition(theme: MenuTheme) {
  return themeRegistry[theme];
}
