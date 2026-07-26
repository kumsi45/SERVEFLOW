import { createContext } from "react";
import type { ThemeContext } from "./ThemeTypes";

export const MenuThemeContext = createContext<ThemeContext | null>(null);
