import type { MenuItem } from "../types";
import { formatETBPrice, formatUSDApproximation, getMenuItemBadge, getMenuItemRating } from "./menuPresentation";

type MenuItemCardProps = {
  item: MenuItem;
  onAddToCart?: (item: MenuItem) => void;
  onOpenFoodInfo?: (item: MenuItem) => void;
};

export function MenuItemCard({ item, onAddToCart, onOpenFoodInfo }: MenuItemCardProps) {
  const badge = getMenuItemBadge(item.name);

  return (
    <article className={item.available ? "menu-item" : "menu-item unavailable"}>
      <div className="menu-item-image-wrap">
        {item.image_url ? (
          <img className="menu-item-image" src={item.image_url} alt="" loading="lazy" />
        ) : (
          <div className="menu-item-image placeholder" aria-hidden="true" />
        )}
        {badge ? <span className="dish-badge">{badge}</span> : null}
      </div>
      <div className="menu-item-copy">
        <div className="menu-item-heading">
          <div>
            <h3>{item.name}</h3>
            <div className="menu-item-rating">
              <span aria-hidden="true">⭐</span> {getMenuItemRating(item.name)}
            </div>
          </div>
          <div className="menu-item-price">
            <strong>{formatETBPrice(Number(item.price))}</strong>
            <span>{formatUSDApproximation(Number(item.price))}</span>
          </div>
        </div>
        <p>{item.description || "Freshly prepared by the restaurant."}</p>
        <div className="menu-item-footer">
          <span className={item.available ? "availability available" : "availability"}>
            {item.available ? "Available today" : "Unavailable"}
          </span>
          <span className="restaurant-chip">House menu</span>
        </div>
        {onAddToCart ? (
          <div className="menu-item-actions">
            {onOpenFoodInfo ? (
              <button
                className="food-info-icon-button"
                type="button"
                onClick={() => onOpenFoodInfo(item)}
                aria-label={`Open food information for ${item.name}`}
              >
                i
              </button>
            ) : null}
            <button
              className="menu-item-cart-button"
              type="button"
              onClick={() => onAddToCart(item)}
              disabled={!item.available}
            >
              Add
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
