import type { MenuItem } from "../types";
import { publishedMenuImageInput, resolveMenuItemImage } from "../../../core/presentation/menuItemImage";
import { formatMenuPrice } from "./menuPresentation";

type FeaturedDishesProps = {
  items: MenuItem[];
  onAddToCart?: (item: MenuItem) => void;
  onOpenFoodInfo?: (item: MenuItem) => void;
};

function getFeaturedItems(items: MenuItem[]) {
  return items.filter((item) => item.available).slice(0, 5);
}

export function FeaturedDishes({ items, onAddToCart, onOpenFoodInfo }: FeaturedDishesProps) {
  const featuredItems = getFeaturedItems(items);

  if (featuredItems.length === 0) {
    return null;
  }

  return (
    <section className="featured-dishes" aria-labelledby="featured-dishes-title">
      <div className="section-heading">
        <p className="eyebrow">Featured</p>
        <h2 id="featured-dishes-title">Fresh from the menu</h2>
      </div>
      <div className="featured-dish-track">
        {featuredItems.map((item) => {
          const imageUrl = resolveMenuItemImage(publishedMenuImageInput(item)).url;

          return (
          <article className="featured-dish-card" key={item.id}>
            <button
              className="featured-dish-open"
              type="button"
              onClick={() => onOpenFoodInfo?.(item)}
              aria-label={`Open ${item.name}`}
            >
              <div className="featured-dish-media">
                {imageUrl ? (
                  <img src={imageUrl} alt={item.name} loading="lazy" />
                ) : (
                  <div className="featured-dish-placeholder" aria-hidden="true" />
                )}
              </div>
            </button>
            <div className="featured-dish-copy">
              <div>
                <h3>{item.name}</h3>
                {item.description ? <p>{item.description}</p> : null}
              </div>
              <div className="featured-dish-footer">
                <div>
                  <strong>{formatMenuPrice(Number(item.price))}</strong>
                </div>
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

