import type { Restaurant } from "../../../../qr-menu/types";

export function RestaurantHero({ restaurant, children }: { restaurant: Restaurant; children?: React.ReactNode }) {
  return <section className="menu-theme-hero" aria-label={`${restaurant.name} menu`} style={restaurant.cover_url ? { backgroundImage: `url(${restaurant.cover_url})` } : undefined}><h1>{restaurant.name}</h1>{children}</section>;
}
