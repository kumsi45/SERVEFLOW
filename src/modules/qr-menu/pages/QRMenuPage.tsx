import { useState } from "react";
import { CategoryFilter } from "../components/CategoryFilter";
import { FeaturedDishes } from "../components/FeaturedDishes";
import { FoodInfoPanel } from "../components/FoodInfoPanel";
import { MenuGroup } from "../components/MenuGroup";
import { MenuSearch } from "../components/MenuSearch";
import { RestaurantHeader } from "../components/RestaurantHeader";
import { formatETBPrice } from "../components/menuPresentation";
import { useQRMenu } from "../hooks/useQRMenu";
import { PublicQrCheckoutPanel } from "../../public-qr-ordering/components/PublicQrCheckoutPanel";
import { PublicQrCartPanel } from "../../public-qr-ordering/components/PublicQrCartPanel";
import { usePublicQrCart } from "../../public-qr-ordering/hooks/usePublicQrCart";
import { usePublicQrCheckoutState } from "../../public-qr-ordering/hooks/usePublicQrCheckoutState";
import { submitPublicQrOrder } from "../../public-qr-ordering/services/publicQrOrderService";
import { isPaymentMethod } from "../../public-qr-ordering/types";
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
  const [cartVisible, setCartVisible] = useState(false);
  const [foodInfoItem, setFoodInfoItem] = useState<MenuItem>();
  const {
    restaurant,
    categories,
    groups,
    items,
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
    const customerName = checkout.customerName.trim();

    if (customerName.length < 2 || customerName.length > 30) {
      checkout.setCustomerName(customerName);
      return;
    }

    if (!isPaymentMethod(checkout.paymentMethod)) {
      return;
    }

    setSubmitError(undefined);
    setSubmitting(true);

    try {
      const order = await submitPublicQrOrder({
        restaurantSlug,
        tableNumber: checkout.tableNumber,
        customerName,
        paymentMethod: checkout.paymentMethod,
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
      <div className="qr-menu-shell">
        <div className="qr-menu-main">
          <FeaturedDishes
            items={items}
            onAddToCart={addItemToCart}
            onOpenFoodInfo={setFoodInfoItem}
          />
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
                <MenuGroup
                  group={group}
                  key={group.category.id}
                  onAddToCart={addItemToCart}
                  onOpenFoodInfo={setFoodInfoItem}
                />
              ))
            ) : (
              <div className="menu-state">
                <h2>No menu items available</h2>
                <p>Ask staff for today's specials.</p>
              </div>
            )}
          </section>
        </div>
        <aside className="qr-menu-side" aria-label="Order panel">
          {checkout.checkoutVisible && cart.items.length > 0 ? (
            <PublicQrCheckoutPanel
              customerName={checkout.customerName}
              displaySubtotal={cart.displaySubtotal}
              items={cart.items}
              paymentMethod={checkout.paymentMethod}
              submitting={submitting}
              submitError={submitError}
              tableNumber={checkout.tableNumber}
              onClose={() => checkout.setCheckoutVisible(false)}
              onCustomerNameChange={checkout.setCustomerName}
              onPaymentMethodChange={checkout.setPaymentMethod}
              onSubmit={submitOrder}
            />
          ) : (
            <PublicQrCartPanel
              items={cart.items}
              itemCount={cart.itemCount}
              displaySubtotal={cart.displaySubtotal}
              isOpen={cartVisible}
              onClose={() => setCartVisible(false)}
              onIncrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity + 1)}
              onDecrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity - 1)}
              onRemove={cart.removeItem}
              onReviewOrder={() => {
                checkout.setCheckoutVisible(true);
                setCartVisible(false);
              }}
            />
          )}
        </aside>
      </div>
      <PublicQrCartPanel
        items={cart.items}
        itemCount={cart.itemCount}
        displaySubtotal={cart.displaySubtotal}
        isFloatingOnly
        isOpen={cartVisible}
        onClose={() => setCartVisible(false)}
        onIncrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity + 1)}
        onDecrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity - 1)}
        onRemove={cart.removeItem}
        onReviewOrder={() => checkout.setCheckoutVisible(true)}
      />
      {cart.itemCount > 0 ? (
        <button
          className="floating-cart-entry"
          type="button"
          onClick={() => {
            checkout.setCheckoutVisible(false);
            setCartVisible(true);
          }}
          aria-label="Open cart"
        >
          <span aria-hidden="true">🛒</span>
          <strong>
            {cart.itemCount} {cart.itemCount === 1 ? "Item" : "Items"} •{" "}
            {formatETBPrice(cart.displaySubtotal)}
          </strong>
        </button>
      ) : null}
      {submittedOrder ? (
        <section className="public-order-confirmation" aria-label="Order confirmation">
          <h2>Order placed</h2>
          <p>Your order is {submittedOrder.status}. Total: {formatETBPrice(submittedOrder.total_price)}</p>
        </section>
      ) : null}
      <FoodInfoPanel item={foodInfoItem} onClose={() => setFoodInfoItem(undefined)} />
    </main>
  );
}
