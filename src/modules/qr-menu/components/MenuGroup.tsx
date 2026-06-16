import type { MenuGroup as MenuGroupType } from "../types";
import type { MenuItem } from "../types";
import { MenuItemCard } from "./MenuItemCard";

type MenuGroupProps = {
  group: MenuGroupType;
  onAddToCart?: (item: MenuItem) => void;
  onOpenFoodInfo?: (item: MenuItem) => void;
};

export function MenuGroup({ group, onAddToCart, onOpenFoodInfo }: MenuGroupProps) {
  return (
    <section className="menu-group">
      <div className="section-heading menu-group-heading">
        <p className="eyebrow">Menu</p>
        <h2>{group.category.name}</h2>
      </div>
      <div className="menu-items">
        {group.items.map((item) => (
          <MenuItemCard
            item={item}
            key={item.id}
            onAddToCart={onAddToCart}
            onOpenFoodInfo={onOpenFoodInfo}
          />
        ))}
      </div>
    </section>
  );
}
