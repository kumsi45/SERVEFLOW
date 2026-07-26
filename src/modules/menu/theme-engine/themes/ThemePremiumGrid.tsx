import type { ThemeRendererProps } from "../ThemeTypes";

export function ThemePremiumGrid({ children }: ThemeRendererProps) {
  return <div className="premium-grid-shell">{children}</div>;
}
