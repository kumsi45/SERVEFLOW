import { memo, useMemo, type CSSProperties } from "react";
import { ResilientImage } from "../../../../../core/presentation/ResilientImage";
import { formatMenuPrice } from "../../../../qr-menu/components/menuPresentation";
import { ModernBottomNavigation } from "../modern/ModernBottomNavigation";
import type { ModernFoodViewProps } from "../modern/ModernFoodView";
import { PremiumLuxuryCard } from "./PremiumLuxuryCard";
import "./premiumLuxury.css";

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></svg>;
}

function CartIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5h2l1.5 10h10.5l2-7H7M9 19.2h.1M17 19.2h.1" /></svg>;
}

export const PremiumLuxuryView = memo(function PremiumLuxuryView({
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
}: ModernFoodViewProps) {
  const categoryImages = useMemo(
    () => new Map(categories.map((category) => [category.id, category.hero_image_url])),
    [categories],
  );
  const heroStyle = restaurant.cover_url
    ? ({ "--luxury-cover": `url("${restaurant.cover_url}")` } as CSSProperties)
    : undefined;

  return (
    <div className="premium-luxury-view" style={heroStyle}>
      <header className="premium-luxury-hero">
        <div className="premium-luxury-topbar">
          <div className="premium-luxury-brand">
            <ResilientImage
              src={restaurant.logo_url}
              alt={`${restaurant.name} logo`}
              loading="eager"
              decoding="async"
              fallback={restaurant.name.slice(0, 1).toUpperCase()}
              fallbackClassName="premium-luxury-logo-fallback"
            />
            <strong>{restaurant.name}</strong>
          </div>
          <button type="button" className="premium-luxury-cart" onClick={onOpenCart} aria-label={`Open cart with ${cartItemCount} items`}>
            <CartIcon />{cartItemCount > 0 && <span>{cartItemCount}</span>}
          </button>
        </div>

        <label className="premium-luxury-search">
          <SearchIcon />
          <span className="modern-sr-only">Search menu</span>
          <input type="search" value={searchTerm} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search our menu" />
          {searchTerm && <button type="button" onClick={() => onSearchChange("")} aria-label="Clear menu search">Clear</button>}
        </label>

        <div className="premium-luxury-hero-copy">
          <small>Premium dining</small>
          <h1>Menu <em>Experience</em></h1>
          {tableNumber && <span>Table {tableNumber}</span>}
        </div>
      </header>

      <div className="premium-luxury-menu-panel">
        <div className="premium-luxury-menu-heading"><div><small>Curated selection</small><h2>Menu</h2></div><span>{groups.reduce((total, group) => total + group.items.length, 0)} dishes</span></div>

        <nav className="premium-luxury-categories" aria-label="Menu categories">
          <button className={activeCategoryId === "all" ? "active" : ""} type="button" aria-current={activeCategoryId === "all" ? "page" : undefined} onClick={() => onCategoryChange("all")}><span>All</span></button>
          {categories.map((category) => {
            const image = categoryImages.get(category.id);
            return <button className={activeCategoryId === category.id ? "active" : ""} type="button" key={category.id} aria-current={activeCategoryId === category.id ? "page" : undefined} onClick={() => onCategoryChange(category.id)}>
              <ResilientImage
                src={image}
                alt=""
                loading="lazy"
                decoding="async"
                fallback={category.name.slice(0, 1).toUpperCase()}
                fallbackClassName="premium-luxury-category-fallback"
              />
              <span>{category.name}</span>
            </button>;
          })}
        </nav>

        <div className="premium-luxury-menu-content">
          {groups.length > 0 ? groups.map((group, groupIndex) => (
            <section className="premium-luxury-group" key={group.category.id} aria-labelledby={`luxury-category-${group.category.id}`}>
              <header><div><small>Chef's selection</small><h2 id={`luxury-category-${group.category.id}`}>{group.category.name}</h2></div><span>{group.items.length}</span></header>
              <div className="premium-luxury-grid">
                {group.items.map((item, index) => <PremiumLuxuryCard key={item.id} item={item} priority={groupIndex === 0 && index < 2} onAddToCart={onAddToCart} onOpenInfo={onOpenInfo} />)}
              </div>
            </section>
          )) : (
            <section className="premium-luxury-empty" role="status"><span aria-hidden="true">SF</span><h2>{searchTerm ? "No matching dishes" : "Menu unavailable"}</h2><p>{searchTerm ? "Try another search or category." : "There are no available dishes right now."}</p>{searchTerm && <button type="button" onClick={() => onSearchChange("")}>Clear Search</button>}</section>
          )}
        </div>
      </div>

      {cartItemCount > 0 && <button className="premium-luxury-cart-dock" type="button" onClick={onOpenCart} aria-label={`Open cart, ${cartItemCount} items, ${formatMenuPrice(cartSubtotal)}`}><span><strong>{cartItemCount}</strong>View Cart</span><strong>{formatMenuPrice(cartSubtotal)}</strong></button>}

      <ModernBottomNavigation activePage="home" hasActiveOrder={hasActiveOrder} onNavigateHome={() => window.scrollTo({ top: 0, behavior: "smooth" })} onNavigateOrders={onOpenOrders} />
    </div>
  );
});
