import { CategoryFilter } from "../components/CategoryFilter";
import { MenuGroup } from "../components/MenuGroup";
import { MenuSearch } from "../components/MenuSearch";
import { RestaurantHeader } from "../components/RestaurantHeader";
import { useQRMenu } from "../hooks/useQRMenu";
import { PublicQrCartPanel } from "../../public-qr-ordering/components/PublicQrCartPanel";
import { usePublicQrCart } from "../../public-qr-ordering/hooks/usePublicQrCart";
import type { MenuItem } from "../types";

type QRMenuPageProps = {
  restaurantSlug: string;
};

export function QRMenuPage({ restaurantSlug }: QRMenuPageProps) {
  const cart = usePublicQrCart();
  const {
    restaurant,
    categories,
    groups,
    activeCategoryId,
    searchTerm,
    loading,
    error,
    setActiveCategoryId,
    setSearchTerm,
  } = useQRMenu(restaurantSlug);

  function addItemToCart(item: MenuItem) {
    cart.addItem({
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
    });
  }

  if (loading) {
    return (
      <main className="qr-menu-page">
        <section className="menu-state">Loading menu...</section>
      </main>
    );
  }

  if (error || !restaurant) {
    return (
      <main className="qr-menu-page">
        <section className="menu-state">
          <h1>Menu unavailable</h1>
          <p>{error || "This restaurant menu could not be loaded."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="qr-menu-page">
      <RestaurantHeader restaurant={restaurant} />
      <section className="menu-controls">
        <MenuSearch value={searchTerm} onChange={setSearchTerm} />
        <CategoryFilter
          categories={categories}
          activeCategoryId={activeCategoryId}
          onChange={setActiveCategoryId}
        />
      </section>
      <section className="menu-content">
        {groups.length > 0 ? (
          groups.map((group) => (
            <MenuGroup group={group} key={group.category.id} onAddToCart={addItemToCart} />
          ))
        ) : (
          <div className="menu-state">No matching menu items.</div>
        )}
      </section>
      <PublicQrCartPanel
        items={cart.items}
        itemCount={cart.itemCount}
        displaySubtotal={cart.displaySubtotal}
        onIncrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity + 1)}
        onDecrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity - 1)}
        onRemove={cart.removeItem}
      />
    </main>
  );
}
