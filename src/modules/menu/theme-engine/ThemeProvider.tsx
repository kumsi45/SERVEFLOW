import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Restaurant } from "../../qr-menu/types";
import { MenuThemeContext } from "./ThemeContext";
import { getThemeDefinition } from "./ThemeRegistry";
import { MENU_THEME_CHANGED_EVENT, menuThemeStorageKey, type MenuThemeChangedDetail } from "./themeEvents";
import { isMenuTheme, resolveMenuTheme, type MenuTheme } from "./ThemeTypes";

export function ThemeProvider({ restaurant, children }: { restaurant: Pick<Restaurant, "id" | "menu_theme">; children: ReactNode }) {
  const [theme, setThemeState] = useState<MenuTheme>(() => resolveMenuTheme(restaurant.menu_theme));

  useEffect(() => {
    setThemeState(resolveMenuTheme(restaurant.menu_theme));
  }, [restaurant.id, restaurant.menu_theme]);

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<MenuThemeChangedDetail>).detail;
      if (detail?.restaurantId === restaurant.id && isMenuTheme(detail.theme)) setThemeState(detail.theme);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === menuThemeStorageKey(restaurant.id) && isMenuTheme(event.newValue)) setThemeState(event.newValue);
    };
    window.addEventListener(MENU_THEME_CHANGED_EVENT, handleThemeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(MENU_THEME_CHANGED_EVENT, handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [restaurant.id]);

  const setTheme = useCallback((next: MenuTheme) => setThemeState(resolveMenuTheme(next)), []);
  const value = useMemo(() => ({ theme, definition: getThemeDefinition(theme), setTheme }), [setTheme, theme]);

  return <MenuThemeContext.Provider value={value}>{children}</MenuThemeContext.Provider>;
}
