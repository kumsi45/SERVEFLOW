import { memo, useMemo, type CSSProperties } from "react";
import type { MenuItem } from "../../../../qr-menu/types";
import { ModernBottomNavigation } from "../modern/ModernBottomNavigation";
import type { ModernFoodViewProps } from "../modern/ModernFoodView";
import { PremiumGridCard } from "./PremiumGridCard";
import "./premiumGrid.css";

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

export const PremiumGridView = memo(function PremiumGridView({
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
  const heroStyle = restaurant.cover_url
    ? ({
        "--premium-grid-cover": `url("${restaurant.cover_url}")`,
      } as CSSProperties)
    : undefined;

  return (
    <div className="premium-grid-view" style={heroStyle}>
      <header className="premium-grid-hero">
        <div className="premium-grid-hero-shade" aria-hidden="true" />
        <div className="premium-grid-brand">
          {restaurant.logo_url ? (
            <img
              src={restaurant.logo_url}
              alt={`${restaurant.name} logo`}
              loading="eager"
              decoding="async"
            />
          ) : (
            <span aria-hidden="true">
              {restaurant.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <small>Welcome to</small>
            <h1>{restaurant.name}</h1>
            {tableNumber ? <em>Table {tableNumber}</em> : null}
          </div>
        </div>

        <button
          className="premium-grid-cart"
          type="button"
          onClick={onOpenCart}
          aria-label={`Open cart with ${cartItemCount} items`}
        >
          <CartIcon />
          {cartItemCount > 0 ? <span>{cartItemCount}</span> : null}
        </button>

        <label className="premium-grid-search">
          <SearchIcon />
          <span className="modern-sr-only">Search menu</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search our menu"
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

      <main className="premium-grid-menu">
        <nav className="premium-grid-categories" aria-label="Menu categories">
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

        <div
          className="premium-grid-results-heading"
          aria-live="polite"
          aria-atomic="true"
        >
          <div>
            <small>Freshly prepared</small>
            <h2>
              {activeCategoryId === "all"
                ? "Our Menu"
                : categories.find(
                    (category) => category.id === activeCategoryId,
                  )?.name || "Our Menu"}
            </h2>
          </div>
          <span>
            {menuItems.length} {menuItems.length === 1 ? "dish" : "dishes"}
          </span>
        </div>

        {menuItems.length > 0 ? (
          <section
            className="premium-grid-items"
            aria-label="Available menu items"
          >
            {menuItems.map((item: MenuItem, index) => (
              <PremiumGridCard
                item={item}
                priority={index < 2}
                key={item.id}
                onAddToCart={onAddToCart}
                onOpenInfo={onOpenInfo}
              />
            ))}
          </section>
        ) : (
          <section className="premium-grid-empty" role="status">
            <span aria-hidden="true">SF</span>
            <h2>{searchTerm ? "No matching dishes" : "Menu coming soon"}</h2>
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
