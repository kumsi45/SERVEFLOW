import { useState } from "react";
import { CategoryFilter } from "../components/CategoryFilter";
import { MenuGroup } from "../components/MenuGroup";
import { MenuSearch } from "../components/MenuSearch";
import { RestaurantHeader } from "../components/RestaurantHeader";
import { useQRMenu } from "../hooks/useQRMenu";
import { PublicQrCheckoutPanel } from "../../public-qr-ordering/components/PublicQrCheckoutPanel";
import { PublicQrCartPanel } from "../../public-qr-ordering/components/PublicQrCartPanel";
import { usePublicQrCart } from "../../public-qr-ordering/hooks/usePublicQrCart";
import { usePublicQrCheckoutState } from "../../public-qr-ordering/hooks/usePublicQrCheckoutState";
import { submitPublicQrOrder } from "../../public-qr-ordering/services/publicQrOrderService";
import type { SubmittedPublicQrOrder } from "../../public-qr-ordering/types";
import type { MenuItem } from "../types";

type QRMenuPageProps = {
  restaurantSlug: string;
};

export function QRMenuPage({ restaurantSlug }: QRMenuPageProps) {
  const cart = usePublicQrCart(restaurantSlug);
  const checkout = usePublicQrCheckoutState(restaurantSlug);
  const [submitError, setSubmitError] = useState<string>();
  const [submittedOrder, setSubmittedOrder] = useState<SubmittedPublicQrOrder>();
  const [submitting, setSubmitting] = useState(false);
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
    setSubmittedOrder(undefined);
    cart.addItem({
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
    });
  }

  async function submitOrder() {
    setSubmitError(undefined);
    setSubmitting(true);

    try {
      const order = await submitPublicQrOrder({
        restaurantSlug,
        tableNumber: checkout.tableNumber,
        customerName: checkout.customerName,
        items: cart.items,
      });

      setSubmittedOrder(order);
      cart.clearCart();
      checkout.resetCheckoutState();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Order could not be placed.");
    } finally {
      setSubmitting(false);
    }
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
        onReviewOrder={() => checkout.setCheckoutVisible(true)}
      />
      {submittedOrder ? (
        <section className="public-order-confirmation" aria-label="Order confirmation">
          <h2>Order placed</h2>
          <p>
            Your order is {submittedOrder.status}. Total:{" "}
            {new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(
              submittedOrder.total_price
            )}
          </p>
        </section>
      ) : null}
      {checkout.checkoutVisible && cart.items.length > 0 ? (
        <PublicQrCheckoutPanel
          customerName={checkout.customerName}
          displaySubtotal={cart.displaySubtotal}
          items={cart.items}
          submitting={submitting}
          submitError={submitError}
          tableNumber={checkout.tableNumber}
          onCustomerNameChange={checkout.setCustomerName}
          onSubmit={submitOrder}
        />
      ) : null}
    </main>
  );
}
