import { memo } from "react";
import type { ModernMenuPage } from "./useModernMenuNavigation";

type Props = {
  activePage: ModernMenuPage;
  hasActiveOrder: boolean;
  onNavigateHome: () => void;
  onNavigateOrders: () => void;
};

function HomeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.5 10.6 8.5-7 8.5 7v9.2a1 1 0 0 1-1 1h-5.2v-6.2H9.7v6.2H4.5a1 1 0 0 1-1-1z" /></svg>;
}

function OrdersIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h10v17H7zM9.5 8h5M9.5 12h5M9.5 16h3" /></svg>;
}

export const ModernBottomNavigation = memo(function ModernBottomNavigation({ activePage, hasActiveOrder, onNavigateHome, onNavigateOrders }: Props) {
  return (
    <nav className="modern-bottom-nav" aria-label="Customer menu navigation">
      <button className={activePage === "home" ? "active" : ""} type="button" onClick={onNavigateHome} aria-current={activePage === "home" ? "page" : undefined}>
        <HomeIcon />
        <span>Home</span>
      </button>
      <button className={`${activePage === "orders" ? "active" : ""}${hasActiveOrder ? " has-order" : ""}`} type="button" onClick={onNavigateOrders} aria-current={activePage === "orders" ? "page" : undefined}>
        <OrdersIcon />
        <span>Orders</span>
        {hasActiveOrder && <em aria-label="Active order" />}
      </button>
    </nav>
  );
});
