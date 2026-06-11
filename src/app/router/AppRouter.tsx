import { QRMenuPage } from "../../modules/qr-menu/pages/QRMenuPage";
import { OrderingPage } from "../../modules/ordering/pages/OrderingPage";

function resolveRoute(pathname: string) {
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

  if (route.name === "qr-menu") {
    return <QRMenuPage restaurantSlug={route.restaurantSlug} />;
  }

  return (
    <main className="route-message">
      <p>Menu link not found.</p>
    </main>
  );
}
