import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../core/database";
import { CategoryFilter } from "../components/CategoryFilter";
import { FoodInfoPanel } from "../components/FoodInfoPanel";
import { MenuGroup } from "../components/MenuGroup";
import { MenuSearch } from "../components/MenuSearch";
import { RestaurantHeader } from "../components/RestaurantHeader";
import { formatETBPrice } from "../components/menuPresentation";
import { useQRMenu } from "../hooks/useQRMenu";
import { logPublicQrScan } from "../services/qrMenuService";
import { PublicQrCheckoutPanel } from "../../public-qr-ordering/components/PublicQrCheckoutPanel";
import { PublicQrCartPanel } from "../../public-qr-ordering/components/PublicQrCartPanel";
import { usePublicQrCart } from "../../public-qr-ordering/hooks/usePublicQrCart";
import { usePublicQrCheckoutState } from "../../public-qr-ordering/hooks/usePublicQrCheckoutState";
import {
  fetchPublicQrOrderSession,
  submitPublicQrOrder,
} from "../../public-qr-ordering/services/publicQrOrderService";
import {
  buildPublicQrSession,
  logPublicQrContext,
} from "../../public-qr-ordering/services/publicQrContext";
import { isPaymentMethod } from "../../public-qr-ordering/types";
import type { PublicQrOrderSession, SubmittedPublicQrOrder } from "../../public-qr-ordering/types";
import type { MenuItem } from "../types";

type QRMenuPageProps = {
  restaurantSlug: string;
};

export function QRMenuPage({ restaurantSlug }: QRMenuPageProps) {
  const checkout = usePublicQrCheckoutState(restaurantSlug);
  const cart = usePublicQrCart(restaurantSlug, checkout.sessionKey);
  const [submitError, setSubmitError] = useState<string>();
  const [submittedOrder, setSubmittedOrder] = useState<SubmittedPublicQrOrder>();
  const [activeSession, setActiveSession] = useState<PublicQrOrderSession | null>(null);
  const previousActiveSessionId = useRef<string | null>(null);
  const currentSessionKeyRef = useRef(checkout.sessionKey);
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
  const publicQrSession = useMemo(
    () => buildPublicQrSession(
      checkout,
      restaurant?.id ?? null,
      activeSession?.order_id ?? null
    ),
    [
      activeSession?.order_id,
      checkout.qrToken,
      checkout.sessionKey,
      checkout.tableNumber,
      restaurant?.id,
    ]
  );

  useEffect(() => {
    currentSessionKeyRef.current = checkout.sessionKey;
  }, [checkout.sessionKey]);

  const refreshActiveSession = useCallback(async () => {
    const requestSessionKey = checkout.sessionKey;

    logPublicQrContext("QRMenuPage:session", {
      restaurantSlug,
      sessionKey: requestSessionKey,
      tableNumber: checkout.tableNumber,
      qrToken: checkout.qrToken,
    });

    if (!checkout.tableNumber || !checkout.qrToken) {
      if (currentSessionKeyRef.current === requestSessionKey) {
        setActiveSession(null);
      }
      return;
    }

    const session = await fetchPublicQrOrderSession({
      restaurantSlug,
      tableNumber: checkout.tableNumber,
      qrToken: checkout.qrToken,
    });

    if (currentSessionKeyRef.current === requestSessionKey) {
      setActiveSession(session);
    }
  }, [checkout.qrToken, checkout.sessionKey, checkout.tableNumber, restaurantSlug]);

  useEffect(() => {
    if (!checkout.tableNumberFromQr || !checkout.tableNumber || !checkout.qrToken) return;

    void logPublicQrScan({
      restaurantSlug,
      tableNumber: checkout.tableNumber,
      qrToken: checkout.qrToken,
    }).catch(() => {
      // Scan analytics must never block public ordering.
    });
  }, [checkout.qrToken, checkout.tableNumber, checkout.tableNumberFromQr, restaurantSlug]);

  useEffect(() => {
    void refreshActiveSession().catch(() => {
      setActiveSession(null);
    });
  }, [refreshActiveSession]);

  useEffect(() => {
    setActiveSession(null);
    setSubmittedOrder(undefined);
    setSubmitError(undefined);
    setCartVisible(false);
    setSubmitting(false);
    setFoodInfoItem(undefined);
    cart.clearCart();
  }, [checkout.sessionKey, restaurantSlug]);

  useEffect(() => {
    if (previousActiveSessionId.current && !activeSession) {
      cart.clearCart();
      setSubmittedOrder(undefined);
      setSubmitError(undefined);
      setCartVisible(false);
      checkout.resetCheckoutState();
    }

    previousActiveSessionId.current = activeSession?.order_id ?? null;
  }, [activeSession?.order_id]);

  useEffect(() => {
    if (!restaurant?.id || !checkout.tableNumber || !checkout.qrToken) return;

    const refresh = () => {
      void refreshActiveSession().catch(() => undefined);
    };
    const channel = supabase.channel(`public-order-session-${restaurant.id}-${checkout.sessionKey}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurant.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items", filter: `restaurant_id=eq.${restaurant.id}` }, refresh)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [checkout.qrToken, checkout.sessionKey, checkout.tableNumber, refreshActiveSession, restaurant?.id]);

  function getTableNumberValidationMessage(tableNumber: string) {
    const normalizedTableNumber = tableNumber.trim();

    if (!normalizedTableNumber) {
      return "Table number is required to place your order.";
    }

    if (!/^[0-9]+$/.test(normalizedTableNumber)) {
      return "Table number must be a whole number.";
    }

    const tableLimit = restaurant?.total_tables ?? restaurant?.table_count ?? 20;
    const numericTableNumber = Number(normalizedTableNumber);

    if (numericTableNumber < 1 || numericTableNumber > tableLimit) {
      return `Invalid table number. Please enter a table number between 1 and ${tableLimit}.`;
    }

    if (checkout.tableNumberFromQr && !checkout.qrToken) {
      return "A valid table QR code is required to place this order.";
    }

    return undefined;
  }

  function addItemToCart(item: MenuItem, quantity = 1, notes?: string) {
    setSubmittedOrder(undefined);
    cart.addItem({
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
      quantity,
      notes,
    });
  }

  async function submitOrder() {
    const tableNum = checkout.tableNumber.trim();
    const customerName = checkout.customerName.trim();
    const tableNumberValidationMessage = getTableNumberValidationMessage(tableNum);

    if (tableNumberValidationMessage) {
      setSubmitError(tableNumberValidationMessage);
      return;
    }

    if (!isPaymentMethod(checkout.paymentMethod)) {
      return;
    }

    setSubmitError(undefined);
    setSubmitting(true);
    const requestSessionKey = checkout.sessionKey;

    try {
      logPublicQrContext("QRMenuPage:submit", {
        restaurantSlug,
        publicQrSession,
      });

      const order = await submitPublicQrOrder({
        restaurantSlug,
        tableNumber: tableNum,
        qrToken: checkout.qrToken,
        customerName: customerName || undefined,
        paymentMethod: checkout.paymentMethod,
        items: cart.items,
      });

      if (currentSessionKeyRef.current === requestSessionKey) {
        setSubmittedOrder(order);
        cart.clearCart();
        await refreshActiveSession();
        checkout.resetCheckoutState();
      }
    } catch (error) {
      if (currentSessionKeyRef.current === requestSessionKey) {
        setSubmitError(error instanceof Error ? error.message : "Order could not be placed.");
      }
    } finally {
      if (currentSessionKeyRef.current === requestSessionKey) {
        setSubmitting(false);
      }
    }
  }

  if (loading) {
    return (
      <main className="qr-menu-page">
        <section className="menu-loading" aria-label="Loading menu">
          <div className="skeleton-hero" />
          <div className="skeleton-controls" />
          <div className="skeleton-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="skeleton-card" key={index} />
            ))}
          </div>
        </section>
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
      <RestaurantHeader
        restaurant={restaurant}
        tableNumber={checkout.tableNumber}
        tableNumberFromQr={checkout.tableNumberFromQr}
      />
      <div className="qr-menu-shell">
        <div className="qr-menu-main">
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
                <div className="empty-state-icon" aria-hidden="true">SF</div>
                <h2>{searchTerm ? "No matching dishes" : "No menu items available"}</h2>
                <p>
                  {searchTerm
                    ? "Try another search or browse the categories above."
                    : "Ask staff for today's specials."}
                </p>
              </div>
            )}
          </section>
        </div>
        <aside className="qr-menu-side" aria-label="Order panel">
          {checkout.checkoutVisible && cart.items.length > 0 ? (
            <PublicQrCheckoutPanel
              customerName={checkout.customerName}
              activeSession={activeSession}
              displaySubtotal={cart.displaySubtotal}
              items={cart.items}
              paymentMethod={checkout.paymentMethod}
              restaurantName={restaurant.name}
              submitting={submitting}
              submitError={submitError}
              tableNumber={checkout.tableNumber}
              tableCount={restaurant.total_tables ?? restaurant.table_count ?? 20}
              tableNumberFromQr={checkout.tableNumberFromQr}
              onClose={() => checkout.setCheckoutVisible(false)}
              onCustomerNameChange={checkout.setCustomerName}
              onTableNumberChange={checkout.setTableNumber}
              onPaymentMethodChange={checkout.setPaymentMethod}
              onSubmit={submitOrder}
            />
          ) : (
            <PublicQrCartPanel
              items={cart.items}
              activeSession={activeSession}
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
        activeSession={activeSession}
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
          <span aria-hidden="true">Cart</span>
          <strong>
            {cart.itemCount} {cart.itemCount === 1 ? "Item" : "Items"} -{" "}
            {formatETBPrice(cart.displaySubtotal)}
          </strong>
        </button>
      ) : null}
      {submittedOrder ? (
        <section className="public-order-confirmation" aria-label="Order confirmation">
          <div className="order-success-mark" aria-hidden="true">OK</div>
          <p className="eyebrow">Order sent</p>
          <h2>Order #{submittedOrder.order_id.slice(0, 8)}</h2>
          <p>{submittedOrder.session_action === "appended" ? "Your new items were added to the current order." : "Your order has been sent. Please wait while the cashier confirms your order."}</p>
          <div className="order-waiting-card" aria-live="polite">
            <span className="status-pulse" aria-hidden="true" />
            <div>
              <strong>Waiting for cashier approval...</strong>
              <span>Status: {submittedOrder.status}</span>
            </div>
          </div>
          <button className="track-order-button" type="button">
            Track Order
          </button>
          <p className="order-total-note">Total: {formatETBPrice(submittedOrder.total_price)}</p>
        </section>
      ) : null}
      <FoodInfoPanel
        item={foodInfoItem}
        onClose={() => setFoodInfoItem(undefined)}
        onAddToCart={(item, quantity, notes) => {
          addItemToCart(item, quantity, notes);
          setFoodInfoItem(undefined);
          setCartVisible(true);
        }}
      />
    </main>
  );
}
