import { useMenuTheme } from "./hooks/useMenuTheme";
import type { ThemeRendererProps } from "./ThemeTypes";
import "./themeEngine.css";

export function ThemeRenderer(props: ThemeRendererProps) {
  const { theme, definition } = useMenuTheme();
  const Component = definition.component;
  return <Component {...props} theme={theme} />;
}
