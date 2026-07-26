import { memo, useMemo, type CSSProperties } from "react";
import { formatMenuPrice } from "../../../../qr-menu/components/menuPresentation";
import type { MenuCategory, MenuGroup, MenuItem, Restaurant } from "../../../../qr-menu/types";
import { ModernBottomNavigation } from "./ModernBottomNavigation";
import { ModernFoodCard } from "./ModernFoodCard";
import "./modernFood.css";

type Props = {
  restaurant: Restaurant;
  tableNumber?: string;
  categories: readonly MenuCategory[];
  groups: readonly MenuGroup[];
  activeCategoryId: string;
  searchTerm: string;
  cartItemCount: number;
  cartSubtotal: number;
  hasActiveOrder: boolean;
  onSearchChange: (value: string) => void;
  onCategoryChange: (id: string) => void;
  onAddToCart: (item: MenuItem) => void;
  onOpenInfo: (item: MenuItem) => void;
  onOpenCart: () => void;
  onOpenOrders: () => void;
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function AllCategoriesIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="2" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="2" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="2" /><rect x="14" y="14" width="6.5" height="6.5" rx="2" /></svg>;
}

export const ModernFoodView = memo(function ModernFoodView({
  restaurant,
  tableNumber,
  categories,
  groups,
  activeCategoryId,
  searchTerm,
  cartItemCount,
  cartSubtotal,
  hasActiveOrder,
  onSearchChange,
  onCategoryChange,
  onAddToCart,
  onOpenInfo,
  onOpenCart,
  onOpenOrders,
}: Props) {
  const categoryImages = useMemo(
    () => new Map(categories.map((category) => [category.id, category.hero_image_url])),
    [categories],
  );
  const coverStyle = restaurant.cover_url
    ? ({ "--modern-cover": `url("${restaurant.cover_url}")` } as CSSProperties)
    : undefined;

  return (
    <div className="modern-food-theme" style={coverStyle}>
      <header className="modern-food-header">
        <div className="modern-food-brand-row">
          <div className="modern-food-brand">
            {restaurant.logo_url ? (
              <img src={restaurant.logo_url} alt={`${restaurant.name} logo`} loading="eager" decoding="async" />
            ) : (
              <span aria-hidden="true">{restaurant.name.slice(0, 1).toUpperCase()}</span>
            )}
            <div>
              <small>{greeting()}</small>
              <strong>{restaurant.name}</strong>
              {tableNumber && <em>Table {tableNumber}</em>}
            </div>
          </div>
          <button className="modern-header-cart" type="button" onClick={onOpenCart} aria-label={`Open cart with ${cartItemCount} items`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5h2l1.5 10h10.5l2-7H7M9 19.2h.1M17 19.2h.1" /></svg>
            {cartItemCount > 0 && <span>{cartItemCount}</span>}
          </button>
        </div>
        <label className="modern-food-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4" /><path d="m16 16 4 4" /></svg>
          <span className="modern-sr-only">Search menu</span>
          <input type="search" value={searchTerm} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search food or drinks" />
          {searchTerm && <button type="button" onClick={() => onSearchChange("")} aria-label="Clear menu search">X</button>}
        </label>
      </header>

      <nav className="modern-food-categories" aria-label="Menu categories">
        <button className={activeCategoryId === "all" ? "active" : ""} type="button" aria-current={activeCategoryId === "all" ? "page" : undefined} onClick={() => onCategoryChange("all")}>
          <span className="modern-category-icon all"><AllCategoriesIcon /></span>
          <strong>All</strong>
        </button>
        {categories.map((category) => {
          const image = categoryImages.get(category.id);
          return (
            <button className={activeCategoryId === category.id ? "active" : ""} type="button" key={category.id} aria-current={activeCategoryId === category.id ? "page" : undefined} onClick={() => onCategoryChange(category.id)}>
              <span className="modern-category-icon">
                {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : <span aria-hidden="true">{category.name.slice(0, 1).toUpperCase()}</span>}
              </span>
              <strong>{category.name}</strong>
            </button>
          );
        })}
      </nav>

      <div className="modern-food-content" id="modern-menu-home">
        {groups.length ? groups.map((group, groupIndex) => (
          <section className="modern-food-group" key={group.category.id} aria-labelledby={`modern-category-${group.category.id}`}>
            <header>
              <div><small>Freshly prepared</small><h2 id={`modern-category-${group.category.id}`}>{group.category.name}</h2></div>
              <span>{group.items.length} {group.items.length === 1 ? "item" : "items"}</span>
            </header>
            <div className="modern-food-grid">
              {group.items.map((item, index) => (
                <ModernFoodCard item={item} priority={groupIndex === 0 && index < 2} key={item.id} onAddToCart={onAddToCart} onOpenInfo={onOpenInfo} />
              ))}
            </div>
          </section>
        )) : (
          <section className="modern-food-empty" role="status">
            <span aria-hidden="true">SF</span>
            <h2>{searchTerm ? "No matching dishes" : "Menu coming soon"}</h2>
            <p>{searchTerm ? "Try another search or choose a different category." : "This restaurant has no available menu items right now."}</p>
            {searchTerm && <button type="button" onClick={() => onSearchChange("")}>Clear Search</button>}
          </section>
        )}
      </div>

      {cartItemCount > 0 && (
        <button className="modern-cart-dock" type="button" onClick={onOpenCart} aria-label={`Open cart, ${cartItemCount} items, ${formatMenuPrice(cartSubtotal)}`}>
          <span><strong>{cartItemCount}</strong><span>View Cart</span></span>
          <strong>{formatMenuPrice(cartSubtotal)}</strong>
        </button>
      )}

      <ModernBottomNavigation activePage="home" hasActiveOrder={hasActiveOrder} onNavigateHome={() => window.scrollTo({ top: 0, behavior: "smooth" })} onNavigateOrders={onOpenOrders} />
    </div>
  );
});
