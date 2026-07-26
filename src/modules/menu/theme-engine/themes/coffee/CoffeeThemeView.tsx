import { memo, useMemo } from "react";
import type { MenuItem } from "../../../../qr-menu/types";
import { ModernBottomNavigation } from "../modern/ModernBottomNavigation";
import type { ModernFoodViewProps } from "../modern/ModernFoodView";
import { CoffeeThemeCard } from "./CoffeeThemeCard";
import "./coffeeTheme.css";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.7" cy="10.7" r="6.4" />
      <path d="m15.6 15.6 4.4 4.4" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 5h2l1.5 10h10.5l2-7H7M9 19.2h.1M17 19.2h.1" />
    </svg>
  );
}

export const CoffeeThemeView = memo(function CoffeeThemeView({
  restaurant,
  tableNumber,
  categories,
  groups,
  activeCategoryId,
  searchTerm,
  cartItemCount,
  hasActiveOrder,
  onSearchChange,
  onCategoryChange,
  onAddToCart,
  onOpenInfo,
  onOpenCart,
  onOpenOrders,
}: ModernFoodViewProps) {
  const menuItems = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );

  return (
    <div className="coffee-theme-view">
      <header className="coffee-theme-hero">
        <div className="coffee-theme-brand-row">
          <div className="coffee-theme-brand-copy">
            <small>Brew &amp; Bite</small>
            <h1>{restaurant.name}</h1>
            {tableNumber ? <span>Table {tableNumber}</span> : null}
          </div>
          {restaurant.logo_url ? (
            <img
              className="coffee-theme-logo"
              src={restaurant.logo_url}
              alt={`${restaurant.name} logo`}
              loading="eager"
              decoding="async"
            />
          ) : (
            <span className="coffee-theme-logo fallback" aria-hidden="true">
              {restaurant.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>

        <label className="coffee-theme-search">
          <SearchIcon />
          <span className="modern-sr-only">Search menu</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search"
          />
          {searchTerm ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear menu search"
            >
              Clear
            </button>
          ) : null}
        </label>
      </header>

      <main className="coffee-theme-menu">
        <nav className="coffee-theme-categories" aria-label="Menu categories">
          <button
            className={activeCategoryId === "all" ? "active" : ""}
            type="button"
            aria-current={activeCategoryId === "all" ? "page" : undefined}
            onClick={() => onCategoryChange("all")}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              className={activeCategoryId === category.id ? "active" : ""}
              type="button"
              key={category.id}
              aria-current={
                activeCategoryId === category.id ? "page" : undefined
              }
              onClick={() => onCategoryChange(category.id)}
            >
              {category.name}
            </button>
          ))}
        </nav>

        {menuItems.length > 0 ? (
          <section className="coffee-theme-grid" aria-label="Available menu items">
            {menuItems.map((item: MenuItem, index) => (
              <CoffeeThemeCard
                item={item}
                priority={index < 2}
                key={item.id}
                onAddToCart={onAddToCart}
                onOpenInfo={onOpenInfo}
              />
            ))}
          </section>
        ) : (
          <section className="coffee-theme-empty" role="status">
            <span aria-hidden="true">B&amp;B</span>
            <h2>{searchTerm ? "No matching treats" : "Menu coming soon"}</h2>
            <p>
              {searchTerm
                ? "Try another search or choose a different category."
                : "This restaurant has no available menu items right now."}
            </p>
            {searchTerm ? (
              <button type="button" onClick={() => onSearchChange("")}>
                Clear Search
              </button>
            ) : null}
          </section>
        )}
      </main>

      <button
        className="coffee-theme-cart"
        type="button"
        onClick={onOpenCart}
        aria-label={`Open cart with ${cartItemCount} items`}
      >
        <CartIcon />
        {cartItemCount > 0 ? <span>{cartItemCount}</span> : null}
      </button>

      <ModernBottomNavigation
        activePage="home"
        hasActiveOrder={hasActiveOrder}
        onNavigateHome={() =>
          window.scrollTo({ top: 0, behavior: "smooth" })
        }
        onNavigateOrders={onOpenOrders}
      />
    </div>
  );
});
