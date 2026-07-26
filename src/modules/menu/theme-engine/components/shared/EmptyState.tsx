import type { ReactNode } from "react";

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <section className="menu-theme-empty" role="status"><h2>{title}</h2><p>{message}</p>{action}</section>;
}
