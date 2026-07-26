import { memo, type ReactNode } from "react";
import type { Restaurant } from "../../../../qr-menu/types";
import { ModernBottomNavigation } from "./ModernBottomNavigation";

type Props = {
  restaurant: Restaurant;
  activeOrder?: ReactNode;
  previousOrder?: ReactNode;
  onNavigateHome: () => void;
};

export const ModernOrdersView = memo(function ModernOrdersView({ restaurant, activeOrder, previousOrder, onNavigateHome }: Props) {
  const hasActiveOrder = Boolean(activeOrder);
  const hasPreviousOrder = Boolean(previousOrder);
  const hasOrders = hasActiveOrder || hasPreviousOrder;

  return (
    <div className="modern-food-theme modern-orders-theme">
      <header className="modern-orders-header">
        <button type="button" onClick={onNavigateHome} aria-label="Back to menu">Back</button>
        <div>
          <span>{restaurant.name}</span>
          <h1>My Orders</h1>
          <p>Track kitchen progress, payment, and receipts.</p>
        </div>
      </header>

      <div className="modern-orders-content">
        {!hasOrders ? (
          <section className="modern-orders-empty" role="status">
            <span aria-hidden="true">🍽️</span>
            <h2>No orders yet</h2>
            <p>Browse our menu and place your first order.</p>
            <button type="button" onClick={onNavigateHome}>Browse Menu</button>
          </section>
        ) : (
          <>
            <section className="modern-orders-section" aria-labelledby="modern-active-orders-title">
              <div className="modern-orders-section-heading">
                <div><small>Live status</small><h2 id="modern-active-orders-title">Active Orders</h2></div>
                {hasActiveOrder && <span>Updating live</span>}
              </div>
              {activeOrder ?? <p className="modern-orders-section-empty">No active orders.</p>}
            </section>

            <section className="modern-orders-section" aria-labelledby="modern-previous-orders-title">
              <div className="modern-orders-section-heading">
                <div><small>Order history</small><h2 id="modern-previous-orders-title">Previous Orders</h2></div>
              </div>
              {previousOrder ?? <p className="modern-orders-section-empty">No previous orders in this session.</p>}
              <button className="modern-reorder-placeholder" type="button" disabled title="Reorder will be available in a future release">Reorder — Coming Soon</button>
            </section>
          </>
        )}
      </div>

      <ModernBottomNavigation activePage="orders" hasActiveOrder={hasActiveOrder} onNavigateHome={onNavigateHome} onNavigateOrders={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
    </div>
  );
});
