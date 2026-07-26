import { memo } from "react";
import { ResilientImage } from "../../../../../core/presentation/ResilientImage";
import { formatMenuPrice } from "../../../../qr-menu/components/menuPresentation";
import type { MenuItem } from "../../../../qr-menu/types";

type Props = {
  item: MenuItem;
  priority?: boolean;
  onAddToCart: (item: MenuItem) => void;
  onOpenInfo: (item: MenuItem) => void;
};

export const ModernFoodCard = memo(function ModernFoodCard({ item, priority = false, onAddToCart, onOpenInfo }: Props) {
  const imageUrl = item.effective_image_url || item.image_url;
  const initial = item.name.trim().slice(0, 1).toUpperCase() || "SF";

  return (
    <article className={`modern-food-card${item.available ? "" : " unavailable"}`}>
      <button className="modern-food-card-media" type="button" onClick={() => onOpenInfo(item)} aria-label={`View information for ${item.name}`}>
        <ResilientImage
          src={imageUrl}
          alt={item.name}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          fallback={initial}
          fallbackClassName="modern-food-image-fallback"
          fallbackLabel={`${item.name} image unavailable`}
        />
        <span className="modern-food-price">{formatMenuPrice(Number(item.price))}</span>
      </button>
      <div className="modern-food-card-copy">
        <div>
          <h3>{item.name}</h3>
          <p>{item.description?.trim() || "Description not available."}</p>
        </div>
        <div className="modern-food-card-actions">
          <button className="modern-food-info" type="button" onClick={() => onOpenInfo(item)} aria-label={`Open food information for ${item.name}`}>i</button>
          <button className="modern-food-add" type="button" disabled={!item.available} onClick={() => onAddToCart(item)} aria-label={item.available ? `Add ${item.name} to cart` : `${item.name} is unavailable`}>
            <span aria-hidden="true">+</span><span>{item.available ? "Add" : "Unavailable"}</span>
          </button>
        </div>
      </div>
    </article>
  );
});
