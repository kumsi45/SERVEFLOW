import type { ThemeRendererProps } from "../ThemeTypes";

export function ThemeCoffee({ children }: ThemeRendererProps) {
  return <div className="coffee-theme-shell">{children}</div>;
}
