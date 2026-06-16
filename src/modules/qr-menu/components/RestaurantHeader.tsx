import type { Restaurant } from "../types";

type RestaurantHeaderProps = {
  restaurant: Restaurant;
};

export function RestaurantHeader({ restaurant }: RestaurantHeaderProps) {
  const initial = restaurant.name.charAt(0).toUpperCase();

  return (
    <header className="restaurant-header">
      <div className="restaurant-cover" aria-hidden="true">
        <div className="restaurant-cover-image" />
        <div className="restaurant-hero-glow" />
      </div>
      <div className="restaurant-brand">
        <div className="restaurant-logo-frame">
          {restaurant.logo_url ? (
            <img className="restaurant-logo" src={restaurant.logo_url} alt="" />
          ) : (
            <div className="restaurant-logo restaurant-logo-fallback">{initial}</div>
          )}
        </div>
        <div className="restaurant-title-block">
          <p className="eyebrow">Authentic Ethiopian Cuisine</p>
          <h1>{restaurant.name}</h1>
          <div className="restaurant-meta-row" aria-label="Restaurant details">
            <span className="restaurant-rating" aria-label="Rated 4.8 out of 5">
              <span aria-hidden="true">⭐⭐⭐⭐⭐</span> 4.8
            </span>
            <span className="restaurant-status">Open Now</span>
          </div>
          <p className="restaurant-tagline">Freshly prepared favorites, served with care.</p>
          <p className="restaurant-location">Addis Ababa cafe dining</p>
        </div>
      </div>
    </header>
  );
}
