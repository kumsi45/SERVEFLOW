import type { MenuTheme } from "./ThemeTypes";
import { isMenuTheme } from "./ThemeTypes";

export const MENU_THEME_CHANGED_EVENT = "serveflow:menu-theme-changed";
export const menuThemeStorageKey = (restaurantId: string) => `serveflow.menu-theme:${restaurantId}`;

export type MenuThemeChangedDetail = { restaurantId: string; theme: MenuTheme };

export function publishMenuThemeSelection(restaurantId: string, theme: MenuTheme) {
  if (typeof window === "undefined" || !restaurantId || !isMenuTheme(theme)) return;
  try {
    window.localStorage.setItem(menuThemeStorageKey(restaurantId), theme);
  } catch {
    // Cross-tab persistence is an enhancement; database persistence remains canonical.
  }
  window.dispatchEvent(new CustomEvent<MenuThemeChangedDetail>(MENU_THEME_CHANGED_EVENT, {
    detail: { restaurantId, theme },
  }));
}
