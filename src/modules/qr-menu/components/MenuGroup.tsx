import type { MenuGroup as MenuGroupType } from "../types";
import type { MenuItem } from "../types";
import { MenuItemCard } from "./MenuItemCard";

type MenuGroupProps = {
  group: MenuGroupType;
  onAddToCart?: (item: MenuItem) => void;
};

export function MenuGroup({ group, onAddToCart }: MenuGroupProps) {
  return (
    <section className="menu-group">
      <h2>{group.category.name}</h2>
      <div className="menu-items">
        {group.items.map((item) => (
          <MenuItemCard item={item} key={item.id} onAddToCart={onAddToCart} />
        ))}
      </div>
    </section>
  );
}
