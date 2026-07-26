import { memo } from "react";
import { formatMenuPrice } from "../../../../qr-menu/components/menuPresentation";
import type { MenuItem } from "../../../../qr-menu/types";

type CoffeeThemeCardProps = {
  item: MenuItem;
  priority?: boolean;
  onAddToCart: (item: MenuItem) => void;
  onOpenInfo: (item: MenuItem) => void;
};

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.7v5.2M12 7.6h.01" />
    </svg>
  );
}

export const CoffeeThemeCard = memo(function CoffeeThemeCard({
  item,
  priority = false,
  onAddToCart,
  onOpenInfo,
}: CoffeeThemeCardProps) {
  const imageUrl = item.effective_image_url || item.image_url;
  const initial = item.name.trim().slice(0, 1).toUpperCase() || "SF";
  const extendedItem = item as MenuItem & {
    rating?: number | null;
    average_rating?: number | null;
  };
  const ratingValue = extendedItem.rating ?? extendedItem.average_rating;
  const rating =
    typeof ratingValue === "number" &&
    Number.isFinite(ratingValue) &&
    ratingValue > 0
      ? ratingValue
      : null;

  return (
    <article
      className={`coffee-theme-card${item.available ? "" : " unavailable"}`}
    >
      <div className="coffee-theme-card-media">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.name}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={priority ? "high" : "auto"}
          />
        ) : (
          <span
            className="coffee-theme-image-fallback"
            aria-label={`${item.name} image unavailable`}
          >
            {initial}
          </span>
        )}
      </div>

      <div className="coffee-theme-card-body">
        <h3>{item.name}</h3>
        <div className="coffee-theme-card-meta">
          <strong>{formatMenuPrice(Number(item.price))}</strong>
          {rating !== null ? (
            <span aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
              <span aria-hidden="true">★</span>
              {rating.toFixed(1)}
            </span>
          ) : null}
        </div>
        <div className="coffee-theme-card-actions">
          <button
            className="coffee-theme-info"
            type="button"
            onClick={() => onOpenInfo(item)}
            aria-label={`Open food information for ${item.name}`}
          >
            <InfoIcon />
            <span>Info</span>
          </button>
          <button
            className="coffee-theme-add"
            type="button"
            disabled={!item.available}
            onClick={() => onAddToCart(item)}
            aria-label={
              item.available
                ? `Add ${item.name} to cart`
                : `${item.name} is unavailable`
            }
          >
            <span aria-hidden="true">{item.available ? "+" : "—"}</span>
            <span>{item.available ? "Add" : "Unavailable"}</span>
          </button>
        </div>
      </div>
    </article>
  );
});
