import { memo } from "react";
import { publishedMenuImageInput, resolveMenuItemImage } from "../../../core/presentation/menuItemImage";
import type { MenuItem } from "../types";
import { formatMenuPrice } from "./menuPresentation";

type MenuItemCardProps = {
  item: MenuItem;
  categoryName?: string;
  onAddToCart?: (item: MenuItem) => void;
  onOpenFoodInfo?: (item: MenuItem) => void;
};

export const MenuItemCard = memo(function MenuItemCard({
  item,
  onAddToCart,
  onOpenFoodInfo,
}: MenuItemCardProps) {
  const image = resolveMenuItemImage(publishedMenuImageInput(item));
  const imageUrl = image.url;

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
          <img className="menu-item-image" src={imageUrl} alt={item.name} loading="lazy" decoding="async" />
        ) : (
          <div className="menu-item-image placeholder" aria-hidden="true" />
        )}
      </div>

      <div className="menu-item-copy">
        <div className="menu-item-heading">
          <div>
            <h3>{item.name}</h3>
            {item.description ? <p>{item.description}</p> : null}
          </div>
          <div className="menu-item-price">
            <strong>{formatMenuPrice(Number(item.price))}</strong>
          </div>
        </div>

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
          {onAddToCart ? (
            <button
              className="menu-item-cart-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAddToCart(item);
              }}
              disabled={!item.available}
            >
              {item.available ? "Add" : "Unavailable"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
});

