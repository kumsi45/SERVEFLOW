import type { MenuItem } from "../types";
import { formatETBPrice, formatUSDApproximation, getMenuItemBadge, getMenuItemRating } from "./menuPresentation";

type FeaturedDishesProps = {
  items: MenuItem[];
  onAddToCart?: (item: MenuItem) => void;
  onOpenFoodInfo?: (item: MenuItem) => void;
};

const FEATURED_NAMES = ["special tibs", "kitfo", "beyaynetu", "macchiato", "chocolate cake"];

function getFeaturedItems(items: MenuItem[]) {
  const availableItems = items.filter((item) => item.available);
  const matchedItems = FEATURED_NAMES.flatMap((name) => {
    const match = availableItems.find((item) => item.name.toLowerCase().includes(name));

    return match ? [match] : [];
  });
  const fallbackItems = availableItems.filter(
    (item) => !matchedItems.some((matchedItem) => matchedItem.id === item.id)
  );

  return [...matchedItems, ...fallbackItems].slice(0, 5);
}

export function FeaturedDishes({ items, onAddToCart, onOpenFoodInfo }: FeaturedDishesProps) {
  const featuredItems = getFeaturedItems(items);

  if (featuredItems.length === 0) {
    return null;
  }

  return (
    <section className="featured-dishes" aria-labelledby="featured-dishes-title">
      <div className="section-heading">
        <p className="eyebrow">Customer Favorites</p>
        <h2 id="featured-dishes-title">Signature picks today</h2>
      </div>
      <div className="featured-dish-track">
        {featuredItems.map((item) => {
          const badge = getMenuItemBadge(item.name);

          return (
            <article className="featured-dish-card" key={item.id}>
              <div className="featured-dish-media">
                {item.image_url ? (
                  <img src={item.image_url} alt="" loading="lazy" />
                ) : (
                  <div className="featured-dish-placeholder" aria-hidden="true" />
                )}
                {badge ? <span className="dish-badge">{badge}</span> : null}
              </div>
              <div className="featured-dish-copy">
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.description || "A house favorite prepared fresh for your table."}</p>
                </div>
                <div className="featured-dish-footer">
                  <div>
                    <strong>{formatETBPrice(Number(item.price))}</strong>
                    <span>{formatUSDApproximation(Number(item.price))}</span>
                  </div>
                  <span className="rating-pill">⭐ {getMenuItemRating(item.name)}</span>
                </div>
                <div className="featured-dish-actions">
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
                  {onAddToCart ? (
                    <button type="button" onClick={() => onAddToCart(item)}>
                      Add
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
