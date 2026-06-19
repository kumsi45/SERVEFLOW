import { QRMenuPage } from "../../modules/qr-menu/pages/QRMenuPage";
import { OrderingPage } from "../../modules/ordering/pages/OrderingPage";
import { KitchenPlaceholderPage } from "../../modules/staff-auth/pages/KitchenPlaceholderPage";
import { ProtectedCashierRoute } from "../../modules/staff-auth/pages/ProtectedCashierRoute";
import { StaffLoginPage } from "../../modules/staff-auth/pages/StaffLoginPage";

function resolveRoute(pathname: string) {
  const staffLoginMatch = pathname.match(/^\/staff-login\/?$/);

  if (staffLoginMatch) {
    return { name: "staff-login" as const };
  }

  const cashierMatch = pathname.match(/^\/cashier\/?$/);

  if (cashierMatch) {
    return { name: "cashier" as const };
  }

  const kitchenMatch = pathname.match(/^\/kitchen\/?$/);

  if (kitchenMatch) {
    return { name: "kitchen" as const };
  }

  const orderingMatch = pathname.match(/^\/r\/([^/]+)\/order\/?$/);

  if (orderingMatch) {
    return {
      name: "ordering" as const,
      restaurantSlug: decodeURIComponent(orderingMatch[1]),
    };
  }

  const match = pathname.match(/^\/r\/([^/]+)\/?$/);

  if (!match) {
    return { name: "not-found" as const };
  }

  return {
    name: "qr-menu" as const,
    restaurantSlug: decodeURIComponent(match[1]),
  };
}

export function AppRouter() {
  const route = resolveRoute(window.location.pathname);

  if (route.name === "ordering") {
    return <OrderingPage restaurantSlug={route.restaurantSlug} />;
  }

  if (route.name === "cashier") {
    return <ProtectedCashierRoute />;
  }

  if (route.name === "staff-login") {
    return <StaffLoginPage />;
  }

  if (route.name === "kitchen") {
    return <KitchenPlaceholderPage />;
  }

  if (route.name === "qr-menu") {
    return <QRMenuPage restaurantSlug={route.restaurantSlug} />;
  }

  return (
    <main className="route-message">
      <p>Menu link not found.</p>
    </main>
  );
}
