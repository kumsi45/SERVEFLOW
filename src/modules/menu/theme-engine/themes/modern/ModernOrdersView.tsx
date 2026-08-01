import { Children, memo, useMemo, type ReactNode } from "react";
import type { Restaurant } from "../../../../qr-menu/types";
import { ModernBottomNavigation } from "./ModernBottomNavigation";

type Props = {
  restaurant: Restaurant;
  activeOrder?: ReactNode;
  previousOrder?: ReactNode;
  kitchenStage?: "sent" | "preparing" | "ready" | "served";
  onNavigateHome: () => void;
};

function readTableNumber() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return (params.get("t") || params.get("table") || "").trim();
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7M8 12h12" /></svg>;
}

function OrdersEmptyIllustration() {
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="43" />
      <path d="M27 55h42M32 55a16 16 0 0 1 32 0M48 32v7M25 63h46" />
    </svg>
  );
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>;
}

export const ModernOrdersView = memo(function ModernOrdersView({ restaurant, activeOrder, previousOrder, kitchenStage = "sent", onNavigateHome }: Props) {
  const activeOrders = useMemo(() => Children.toArray(activeOrder), [activeOrder]);
  const previousOrders = useMemo(() => Children.toArray(previousOrder), [previousOrder]);
  const tableNumber = useMemo(readTableNumber, []);
  const activeOrderCount = activeOrders.length;

  return (
    <div className="modern-food-theme modern-orders-theme">
      <header className="modern-orders-header">
        <button type="button" onClick={onNavigateHome} aria-label="Back to menu"><BackIcon /><span>Menu</span></button>
        <div className="modern-orders-title">
          <small>{restaurant.name}</small>
          <div><h1>My Orders</h1>{tableNumber && <span>Table {tableNumber}</span>}</div>
        </div>
      </header>

      <div className="modern-orders-content">
        <section className="modern-visit-summary" aria-label="Current dining session">
          <div><small>Today's Visit</small><strong>{tableNumber ? `Table ${tableNumber}` : "Dine-in visit"}</strong></div>
          <span>{activeOrderCount} Active {activeOrderCount === 1 ? "Order" : "Orders"}</span>
        </section>

        <section className="modern-kitchen-progress" aria-label={`Kitchen progress: ${kitchenStage}`}>
          <div><small>Kitchen progress</small><strong>Updates automatically</strong></div>
          <ol>{(["sent", "preparing", "ready", "served"] as const).map((stage, index, stages) => {
            const current = stages.indexOf(kitchenStage);
            return <li className={index < current ? "done" : index === current ? "active" : ""} key={stage}><span />{stage[0].toUpperCase() + stage.slice(1)}</li>;
          })}</ol>
        </section>

        {activeOrderCount === 0 ? (
          <section className="modern-orders-empty" role="status">
            <OrdersEmptyIllustration />
            <h2>No Active Orders</h2>
            <p>Browse the menu to place your first order.</p>
            <button type="button" onClick={onNavigateHome}>Browse Menu</button>
          </section>
        ) : (
          <section className="modern-orders-section" aria-labelledby="modern-active-orders-title">
            <div className="modern-orders-section-heading">
              <div><small>Updating live</small><h2 id="modern-active-orders-title">Active Orders</h2></div>
              <span aria-label={`${activeOrderCount} active orders`}>{activeOrderCount}</span>
            </div>
            <div className="modern-active-order-list">
              {activeOrders.map((order, index) => (
                <article className="modern-active-order-card" aria-label={`Active order ${index + 1}`} key={index}>{order}</article>
              ))}
            </div>
          </section>
        )}

        <details className="modern-previous-orders">
          <summary>
            <span><small>Order history</small><strong>Previous Orders</strong></span>
            <span className="modern-previous-count">{previousOrders.length}</span>
            <ChevronIcon />
          </summary>
          <div className="modern-previous-orders-body">
            {previousOrders.length > 0
              ? previousOrders.map((order, index) => <article className="modern-previous-order-card" key={index}>{order}</article>)
              : <p className="modern-orders-section-empty">No previous orders in this visit.</p>}
          </div>
        </details>
      </div>

      <ModernBottomNavigation activePage="orders" hasActiveOrder={activeOrderCount > 0} onNavigateHome={onNavigateHome} onNavigateOrders={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
    </div>
  );
});
