import type { ReactNode } from "react";
import type { MenuItem } from "../../../../qr-menu/types";

export function MenuCard({ item, price, badges, action }: { item: MenuItem; price: ReactNode; badges?: ReactNode; action?: ReactNode }) {
  return <article className="menu-theme-card"><div><h3>{item.name}</h3>{item.description && <p>{item.description}</p>}</div>{badges}<footer>{price}{action}</footer></article>;
}
