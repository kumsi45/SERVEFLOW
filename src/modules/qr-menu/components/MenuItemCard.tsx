import type { MenuItem } from "../types";

type MenuItemCardProps = {
  item: MenuItem;
};

const currencyFormatter = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
});

export function MenuItemCard({ item }: MenuItemCardProps) {
  return (
    <article className={item.available ? "menu-item" : "menu-item unavailable"}>
      <div className="menu-item-copy">
        <div className="menu-item-heading">
          <h3>{item.name}</h3>
          <strong>{currencyFormatter.format(Number(item.price))}</strong>
        </div>
        <p>{item.description || "Freshly prepared by the restaurant."}</p>
        <span className={item.available ? "availability available" : "availability"}>
          {item.available ? "Available" : "Unavailable"}
        </span>
      </div>
      <div className="menu-item-image-wrap">
        {item.image_url ? (
          <img className="menu-item-image" src={item.image_url} alt="" loading="lazy" />
        ) : (
          <div className="menu-item-image placeholder">No image</div>
        )}
      </div>
    </article>
  );
}
