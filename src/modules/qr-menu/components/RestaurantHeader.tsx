import type { Restaurant } from "../types";

type RestaurantHeaderProps = {
  restaurant: Restaurant;
};

export function RestaurantHeader({ restaurant }: RestaurantHeaderProps) {
  const initial = restaurant.name.charAt(0).toUpperCase();

  return (
    <header className="restaurant-header">
      <div className="restaurant-brand">
        {restaurant.logo_url ? (
          <img className="restaurant-logo" src={restaurant.logo_url} alt="" />
        ) : (
          <div className="restaurant-logo restaurant-logo-fallback">{initial}</div>
        )}
        <div>
          <p className="eyebrow">Digital Menu</p>
          <h1>{restaurant.name}</h1>
        </div>
      </div>
    </header>
  );
}
