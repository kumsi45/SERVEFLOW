import { useCallback, useEffect, useMemo, useState } from "react";
import { CategoryFilter } from "../../qr-menu/components/CategoryFilter";
import { FoodInfoPanel } from "../../qr-menu/components/FoodInfoPanel";
import { MenuGroup } from "../../qr-menu/components/MenuGroup";
import { MenuSearch } from "../../qr-menu/components/MenuSearch";
import { formatETBPrice } from "../../qr-menu/components/menuPresentation";
import { useQRMenu } from "../../qr-menu/hooks/useQRMenu";
import { PublicQrCartPanel } from "../../public-qr-ordering/components/PublicQrCartPanel";
import { usePublicQrCart } from "../../public-qr-ordering/hooks/usePublicQrCart";
import { getStoredWaiterSession, signOutWaiter } from "../../waiter-auth/services/waiterAuthService";
import type { MenuItem } from "../../qr-menu/types";
import type { SubmittedPublicQrOrder } from "../../public-qr-ordering/types";
import { fetchWaiterOrderSession, submitWaiterOrder, type WaiterOrderSession } from "../services/waiterOrderService";
import "../styles/waiterOrder.css";

type WaiterOrderPageProps = {
  restaurantSlug: string;
  tableNumber: string;
};

function getLatestInvoice(session: WaiterOrderSession | null) {
  return (session?.invoices ?? []).reduce<WaiterOrderSession["invoices"][number] | null>((latest, invoice) => {
    if (!latest || invoice.invoice_number > latest.invoice_number) return invoice;
    return latest;
  }, null);
}

function formatOrderLabel(session?: Pick<WaiterOrderSession, "display_number" | "dining_session_display_number" | "order_id"> | null) {
  return session?.display_number ?? session?.dining_session_display_number ?? (session?.order_id ? "Current order" : "New order");
}

function formatInvoiceLabel(order?: SubmittedPublicQrOrder | null) {
  return order?.invoice_display_number ?? (order?.invoice_number ? `Invoice ${order.invoice_number}` : "Invoice");
}

export function WaiterOrderPage({ restaurantSlug, tableNumber }: WaiterOrderPageProps) {
  const storedSession = getStoredWaiterSession(restaurantSlug);
  const menu = useQRMenu(restaurantSlug);
  const cart = usePublicQrCart(restaurantSlug, `waiter:${tableNumber}`);
  const [activeSession, setActiveSession] = useState<WaiterOrderSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [cartVisible, setCartVisible] = useState(false);
  const [foodInfoItem, setFoodInfoItem] = useState<MenuItem>();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<SubmittedPublicQrOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refreshSession = useCallback(async () => {
    const session = await fetchWaiterOrderSession(restaurantSlug, tableNumber);
    setActiveSession(session.order_id ? session : session);
    setCustomerName((current) => current || session.customer_name || "");
    setCustomerPhone((current) => current || session.customerPhone || "");
    setOrderNote((current) => current || session.orderNote || "");
  }, [restaurantSlug, tableNumber]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setSessionLoading(true);
        setSessionError(null);
        const session = await fetchWaiterOrderSession(restaurantSlug, tableNumber);
        if (!mounted) return;
        setActiveSession(session);
        setCustomerName(session.customer_name ?? "");
        setCustomerPhone(session.customerPhone ?? "");
        setOrderNote(session.orderNote ?? "");
      } catch (error) {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Waiter order screen is unavailable.";
        setSessionError(message);
        if (message.toLowerCase().includes("authentication")) {
          window.location.replace(`/waiter/${encodeURIComponent(restaurantSlug)}`);
        }
      } finally {
        if (mounted) setSessionLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [restaurantSlug, tableNumber]);

  const activeInvoice = getLatestInvoice(activeSession);
  const existingTotal = activeSession?.total_price ?? 0;
  const grandTotal = existingTotal + cart.displaySubtotal;
  const waiterName = activeSession?.waiterDisplayName ?? storedSession?.displayName ?? "Waiter";
  const restaurantName = activeSession?.restaurantName ?? menu.restaurant?.name ?? storedSession?.restaurant.name ?? "Restaurant";
  const hasActiveOrder = Boolean(activeSession?.order_id);

  function addItemToCart(item: MenuItem, quantity = 1, notes?: string) {
    setSubmittedOrder(null);
    setSubmitError(null);
    cart.addItem({
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
      quantity,
      notes,
    });
  }

  async function handleSubmitOrder() {
    if (cart.items.length === 0) {
      setSubmitError("Add at least one item before submitting.");
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      const order = await submitWaiterOrder({
        restaurantSlug,
        tableNumber,
        customerName,
        customerPhone,
        orderNote,
        items: cart.items,
      });
      setSubmittedOrder(order);
      cart.clearCart();
      await refreshSession();
      setCartVisible(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Order could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await signOutWaiter();
    } finally {
      window.location.replace(`/waiter/${encodeURIComponent(restaurantSlug)}`);
    }
  }

  if (menu.loading || sessionLoading) {
    return (
      <main className="waiter-order-page">
        <section className="waiter-order-state">Loading order screen...</section>
      </main>
    );
  }

  if (menu.error || !menu.restaurant || sessionError || !activeSession) {
    return (
      <main className="waiter-order-page">
        <section className="waiter-order-state error">
          <h1>Order screen unavailable</h1>
          <p>{sessionError || menu.error || "This table could not be opened."}</p>
          <button type="button" onClick={() => window.location.replace(`/waiter/${encodeURIComponent(restaurantSlug)}/dashboard`)}>
            Back to Tables
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="waiter-order-page">
      <header className="waiter-order-topbar">
        <button type="button" onClick={() => window.location.replace(`/waiter/${encodeURIComponent(restaurantSlug)}/dashboard`)}>
          Tables
        </button>
        <div>
          <strong>{restaurantName}</strong>
          <span>Table {tableNumber} · {waiterName}</span>
        </div>
        <button type="button" onClick={handleLogout}>Logout</button>
      </header>

      <section className="waiter-order-hero">
        <div>
          <p className="eyebrow">Waiter Order</p>
          <h1>Table {tableNumber}</h1>
          <p>{hasActiveOrder ? `Continuing ${formatOrderLabel(activeSession)}` : "Create a new customer order"}</p>
        </div>
        <div className="waiter-session-card">
          <span>{activeInvoice?.status === "paid" ? "Last bill paid" : activeInvoice?.status === "pending" ? "Pending cashier approval" : "Ready to submit"}</span>
          <strong>{formatETBPrice(grandTotal)}</strong>
          <small>{activeSession.items.length} existing · {cart.itemCount} new</small>
        </div>
      </section>

      {submittedOrder ? (
        <section className="waiter-order-success" role="status">
          <strong>{submittedOrder.session_action === "appended" ? "Items sent to cashier" : "Order sent to cashier"}</strong>
          <span>{formatInvoiceLabel(submittedOrder)} is pending payment approval.</span>
        </section>
      ) : null}

      <section className="waiter-order-shell">
        <div className="waiter-order-menu">
          <section className="menu-controls">
            <MenuSearch value={menu.searchTerm} onChange={menu.setSearchTerm} />
            <CategoryFilter
              categories={menu.categories}
              activeCategoryId={menu.activeCategoryId}
              onChange={menu.setActiveCategoryId}
            />
          </section>

          <section className="menu-content">
            {menu.groups.length > 0 ? (
              menu.groups.map((group) => (
                <MenuGroup
                  group={group}
                  key={group.category.id}
                  onAddToCart={addItemToCart}
                  onOpenFoodInfo={setFoodInfoItem}
                />
              ))
            ) : (
              <div className="menu-state">
                <h2>No matching dishes</h2>
                <p>Try a different search or category.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="waiter-submit-panel" aria-label="Waiter order cart">
          <div className="waiter-submit-heading">
            <div>
              <p className="eyebrow">{hasActiveOrder ? "Existing Session" : "New Session"}</p>
              <h2>{hasActiveOrder ? formatOrderLabel(activeSession) : "New Order"}</h2>
            </div>
            <span>Table {tableNumber}</span>
          </div>

          <label className="waiter-submit-field">
            <span>Customer Name</span>
            <input value={customerName} maxLength={80} onChange={(event) => setCustomerName(event.target.value)} placeholder="Optional" />
          </label>

          <label className="waiter-submit-field">
            <span>Customer Phone</span>
            <input value={customerPhone} maxLength={40} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Optional" />
          </label>

          <label className="waiter-submit-field">
            <span>Order Note</span>
            <textarea value={orderNote} maxLength={500} rows={3} onChange={(event) => setOrderNote(event.target.value)} placeholder="Optional note for cashier" />
          </label>

          <PublicQrCartPanel
            items={cart.items}
            activeSession={activeSession.order_id ? activeSession : null}
            itemCount={cart.itemCount}
            displaySubtotal={cart.displaySubtotal}
            onIncrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity + 1)}
            onDecrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity - 1)}
            onRemove={cart.removeItem}
            onReviewOrder={() => undefined}
          />

          <div className="waiter-submit-total">
            <span>{hasActiveOrder ? "New items" : "Subtotal"}</span>
            <strong>{formatETBPrice(cart.displaySubtotal)}</strong>
          </div>
          <div className="waiter-submit-total grand">
            <span>{hasActiveOrder ? "Session total" : "Total"}</span>
            <strong>{formatETBPrice(grandTotal)}</strong>
          </div>

          {submitError ? <p className="waiter-submit-error">{submitError}</p> : null}

          <button
            className="waiter-submit-button"
            type="button"
            disabled={submitting || cart.items.length === 0}
            onClick={handleSubmitOrder}
          >
            {submitting ? "Submitting..." : hasActiveOrder ? "Submit Added Items" : "Submit to Cashier"}
          </button>
        </aside>
      </section>

      {cart.itemCount > 0 ? (
        <button className="waiter-floating-cart" type="button" onClick={() => setCartVisible(true)}>
          {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"} · {formatETBPrice(cart.displaySubtotal)}
        </button>
      ) : null}

      <PublicQrCartPanel
        items={cart.items}
        activeSession={activeSession.order_id ? activeSession : null}
        itemCount={cart.itemCount}
        displaySubtotal={cart.displaySubtotal}
        isOpen={cartVisible}
        onClose={() => setCartVisible(false)}
        onIncrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity + 1)}
        onDecrease={(menuItemId, quantity) => cart.updateQuantity(menuItemId, quantity - 1)}
        onRemove={cart.removeItem}
        onReviewOrder={() => setCartVisible(false)}
      />

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
