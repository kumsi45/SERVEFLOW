import type { Restaurant } from "../types";

type RestaurantHeaderProps = {
  restaurant: Restaurant;
  tableNumber?: string;
  tableNumberFromQr?: boolean;
};

export function RestaurantHeader({
  restaurant,
  tableNumber,
  tableNumberFromQr = false,
}: RestaurantHeaderProps) {
  const initial = restaurant.name.charAt(0).toUpperCase();
  const displayTable = tableNumber?.trim() || (tableNumberFromQr ? "your table" : "1");
  const coverStyle = restaurant.cover_url
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(13, 11, 10, 0.12), rgba(13, 11, 10, 0.68)), url("${restaurant.cover_url}")`,
      }
    : undefined;

  return (
    <header className="restaurant-header">
      <div className="restaurant-cover" aria-hidden="true">
        <div className="restaurant-cover-image" style={coverStyle} />
        <div className="restaurant-hero-glow" />
      </div>
      <div className="restaurant-brand">
        <div className="restaurant-logo-frame">
          {restaurant.logo_url ? (
            <img className="restaurant-logo" src={restaurant.logo_url} alt="" loading="eager" />
          ) : (
            <div className="restaurant-logo restaurant-logo-fallback">{initial}</div>
          )}
        </div>
        <div className="restaurant-title-block">
          <p className="eyebrow">Welcome to</p>
          <h1>{restaurant.name}</h1>
          <div className="restaurant-meta-row" aria-label="Restaurant details">
            <span className="restaurant-table">Table {displayTable}</span>
          </div>
          <p className="restaurant-location">
            Order from your table. Freshly prepared and sent straight to the cashier.
          </p>
        </div>
      </div>
    </header>
  );
}
