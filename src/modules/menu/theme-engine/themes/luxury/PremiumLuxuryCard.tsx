import { memo } from "react";
import { ResilientImage } from "../../../../../core/presentation/ResilientImage";
import { publishedMenuImageInput, resolveMenuItemImage } from "../../../../../core/presentation/menuItemImage";
import { formatMenuPrice } from "../../../../qr-menu/components/menuPresentation";
import type { MenuItem } from "../../../../qr-menu/types";

type Props = {
  item: MenuItem;
  priority?: boolean;
  onAddToCart: (item: MenuItem) => void;
  onOpenInfo: (item: MenuItem) => void;
};

export const PremiumLuxuryCard = memo(function PremiumLuxuryCard({ item, priority = false, onAddToCart, onOpenInfo }: Props) {
  const image = resolveMenuItemImage(publishedMenuImageInput(item));
  const imageUrl = image.url;
  const initial = item.name.trim().slice(0, 1).toUpperCase() || "SF";

  return (
    <article className={`premium-luxury-card${item.available ? "" : " unavailable"}`}>
      <button className="premium-luxury-card-image" type="button" onClick={() => onOpenInfo(item)} aria-label={`View details for ${item.name}`}>
        <ResilientImage
          src={imageUrl}
          alt={item.name}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          fallback={initial}
          fallbackClassName="premium-luxury-image-fallback"
          fallbackLabel={`${item.name} image unavailable`}
          itemId={item.id}
          resolvedSource={image.source}
        />
        <span className="premium-luxury-card-price">{formatMenuPrice(Number(item.price))}</span>
      </button>
      <div className="premium-luxury-card-body">
        <div><h3>{item.name}</h3><p>{item.description?.trim() || "Description not available."}</p></div>
        <div className="premium-luxury-card-actions">
          <button className="premium-luxury-info" type="button" onClick={() => onOpenInfo(item)} aria-label={`Open food information for ${item.name}`}>Info</button>
          <button className="premium-luxury-add" type="button" disabled={!item.available} onClick={() => onAddToCart(item)} aria-label={item.available ? `Add ${item.name} to cart` : `${item.name} is unavailable`}>
            {item.available ? "Add to Cart" : "Unavailable"}
          </button>
        </div>
      </div>
    </article>
  );
});
