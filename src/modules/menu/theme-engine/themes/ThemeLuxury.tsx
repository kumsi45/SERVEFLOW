import type { ThemeRendererProps } from "../ThemeTypes";

export function ThemeLuxury({ children }: ThemeRendererProps) {
  return <div className="premium-luxury-shell">{children}</div>;
}
