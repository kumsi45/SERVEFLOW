import type { MenuItem } from "../types";
import { formatETBPrice } from "./menuPresentation";
import { NutritionSummary } from "./NutritionSummary";

type MenuItemCardProps = {
  item: MenuItem;
  categoryName?: string;
  onAddToCart?: (item: MenuItem) => void;
  onOpenFoodInfo?: (item: MenuItem) => void;
};

export function MenuItemCard({
  item,
  categoryName = "House menu",
  onAddToCart,
  onOpenFoodInfo,
}: MenuItemCardProps) {
  const imageUrl = item.effective_image_url || item.image_url;

  return (
    <article
      className={item.available ? "menu-item" : "menu-item unavailable"}
      role={onOpenFoodInfo ? "button" : undefined}
      tabIndex={onOpenFoodInfo ? 0 : undefined}
      onClick={() => onOpenFoodInfo?.(item)}
      onKeyDown={(event) => {
        if (!onOpenFoodInfo || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpenFoodInfo(item);
      }}
    >
      <div className="menu-item-image-wrap">
        {imageUrl ? (
          <img className="menu-item-image" src={imageUrl} alt={item.name} loading="lazy" />
        ) : (
          <div className="menu-item-image placeholder" aria-hidden="true" />
        )}
      </div>
      <div className="menu-item-copy">
        <div className="menu-item-heading">
          <div>
            <h3>{item.name}</h3>
          </div>
          <div className="menu-item-price">
            <strong>{formatETBPrice(Number(item.price))}</strong>
          </div>
        </div>
        {item.description ? <p>{item.description}</p> : null}
        <NutritionSummary item={item} compact />
        <div className="menu-item-footer">
          <span className={item.available ? "availability available" : "availability"}>
            {item.available ? "Available today" : "Unavailable"}
          </span>
          <span className="restaurant-chip">{categoryName}</span>
        </div>
        {onAddToCart ? (
          <div className="menu-item-actions">
            {onOpenFoodInfo ? (
              <button
                className="food-info-icon-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenFoodInfo(item);
                }}
                aria-label={`Open food information for ${item.name}`}
              >
                i
              </button>
            ) : null}
            <button
              className="menu-item-cart-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAddToCart(item);
              }}
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
