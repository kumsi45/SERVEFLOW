import { useMemo, useState } from "react";
import { useCart } from "../hooks/useCart";
import { useOrderingMenu } from "../hooks/useOrderingMenu";
import { submitCustomerOrder } from "../services/orderingService";
import type { SubmittedOrder } from "../types";

type OrderingPageProps = {
  restaurantSlug: string;
};

const currencyFormatter = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
});

export function OrderingPage({ restaurantSlug }: OrderingPageProps) {
  const {
    restaurant,
    categories,
    visibleItems,
    items,
    activeCategoryId,
    loading,
    error,
    setActiveCategoryId,
  } = useOrderingMenu(restaurantSlug);
  const { cartLines, cartDetails, total, addItem, decrementItem, removeItem, clearCart } =
    useCart(items);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<SubmittedOrder | null>(null);

  const cartQuantity = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.quantity, 0),
    [cartLines]
  );

  async function handleSubmitOrder() {
    setSubmitting(true);
    setCheckoutError(null);

    try {
      const order = await submitCustomerOrder(restaurantSlug, cartLines);
      setSubmittedOrder(order);
      clearCart();
    } catch (orderError) {
      setCheckoutError(
        orderError instanceof Error ? orderError.message : "Order could not be placed."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="ordering-page">
        <section className="menu-state">Loading ordering menu...</section>
      </main>
    );
  }

  if (error || !restaurant) {
    return (
      <main className="ordering-page">
        <section className="menu-state">
          <h1>Ordering unavailable</h1>
          <p>{error || "This restaurant is not accepting orders right now."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="ordering-page">
      <header className="ordering-header">
        <div>
          <p className="eyebrow">Order ahead</p>
          <h1>{restaurant.name}</h1>
        </div>
        <a href={`/r/${encodeURIComponent(restaurant.slug)}`}>View menu</a>
      </header>

      {submittedOrder ? (
        <section className="order-confirmation">
          <p className="eyebrow">Order received</p>
          <h2>Order #{submittedOrder.order_id.slice(0, 8)}</h2>
          <p>
            Status: <strong>{submittedOrder.status}</strong>
          </p>
          <p>Total: {currencyFormatter.format(submittedOrder.total_price)}</p>
        </section>
      ) : null}

      <section className="ordering-layout">
        <div className="ordering-menu">
          <div className="category-filter ordering-categories" aria-label="Menu categories">
            <button
              className={activeCategoryId === "all" ? "category-pill active" : "category-pill"}
              type="button"
              onClick={() => setActiveCategoryId("all")}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                className={
                  activeCategoryId === category.id ? "category-pill active" : "category-pill"
                }
                key={category.id}
                type="button"
                onClick={() => setActiveCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>

          <div className="ordering-items">
            {visibleItems.map((item) => (
              <article className={item.available ? "order-item" : "order-item unavailable"} key={item.id}>
                <div>
                  <div className="order-item-heading">
                    <h2>{item.name}</h2>
                    <strong>{currencyFormatter.format(Number(item.price))}</strong>
                  </div>
                  <p>{item.description || "Freshly prepared by the restaurant."}</p>
                </div>
                <button type="button" disabled={!item.available} onClick={() => addItem(item.id)}>
                  Add
                </button>
              </article>
            ))}
          </div>
        </div>

        <aside className="cart-panel" aria-label="Cart">
          <div className="cart-panel-heading">
            <h2>Cart</h2>
            <span>{cartQuantity} items</span>
          </div>

          {cartDetails.length > 0 ? (
            <div className="cart-lines">
              {cartDetails.map((line) => (
                <div className="cart-line" key={line.menuItemId}>
                  <div>
                    <strong>{line.item.name}</strong>
                    <span>{currencyFormatter.format(line.lineTotal)}</span>
                  </div>
                  <div className="quantity-controls">
                    <button type="button" onClick={() => decrementItem(line.menuItemId)}>
                      -
                    </button>
                    <span>{line.quantity}</span>
                    <button type="button" onClick={() => addItem(line.menuItemId)}>
                      +
                    </button>
                    <button type="button" onClick={() => removeItem(line.menuItemId)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-cart">Add available items to start an order.</p>
          )}

          <div className="cart-total">
            <span>Total</span>
            <strong>{currencyFormatter.format(total)}</strong>
          </div>

          {checkoutError ? <p className="checkout-error">{checkoutError}</p> : null}

          <button
            className="checkout-button"
            type="button"
            disabled={cartLines.length === 0 || submitting}
            onClick={handleSubmitOrder}
          >
            {submitting ? "Placing order..." : "Place order"}
          </button>
        </aside>
      </section>
    </main>
  );
}
