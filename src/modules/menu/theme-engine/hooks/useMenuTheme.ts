import { useContext } from "react";
import { MenuThemeContext } from "../ThemeContext";

export function useMenuTheme() {
  const context = useContext(MenuThemeContext);
  if (!context) throw new Error("useMenuTheme must be used inside ThemeProvider.");
  return context;
}
