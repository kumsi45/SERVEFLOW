import type { ReactNode } from "react";

export function FoodBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "positive" | "warning" | "danger" }) {
  return <span className={`menu-theme-food-badge ${tone}`}>{children}</span>;
}
