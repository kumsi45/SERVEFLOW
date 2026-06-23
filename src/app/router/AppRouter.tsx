import { QRMenuPage } from "../../modules/qr-menu/pages/QRMenuPage";
import { OrderingPage } from "../../modules/ordering/pages/OrderingPage";
import { ProtectedCashierRoute } from "../../modules/staff-auth/pages/ProtectedCashierRoute";
import { ProtectedKitchenRoute } from "../../modules/staff-auth/pages/ProtectedKitchenRoute";
import { ProtectedOwnerRoute } from "../../modules/staff-auth/pages/ProtectedOwnerRoute";
import { StaffLoginPage } from "../../modules/staff-auth/pages/StaffLoginPage";
import { ForgotPasswordPage } from "../../modules/staff-auth/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "../../modules/staff-auth/pages/ResetPasswordPage";
import { LandingPage } from "../../modules/landing/pages/LandingPage";
import { OwnerSignupPage } from "../../modules/owner-signup/pages/OwnerSignupPage";

function resolveRoute(pathname: string) {
  if (pathname === "/" || pathname === "") {
    return { name: "home" as const };
  }

  const signupMatch = pathname.match(/^\/sign-up\/?$/);
  if (signupMatch) {
    return { name: "sign-up" as const };
  }

  const staffLoginMatch = pathname.match(/^\/staff-login\/?$/);

  if (staffLoginMatch) {
    return { name: "staff-login" as const };
  }

  const forgotPasswordMatch = pathname.match(/^\/forgot-password\/?$/);

  if (forgotPasswordMatch) {
    return { name: "forgot-password" as const };
  }

  const resetPasswordMatch = pathname.match(/^\/reset-password\/?$/);

  if (resetPasswordMatch) {
    return { name: "reset-password" as const };
  }

  const cashierMatch = pathname.match(/^\/cashier\/([^/]+)\/?$/);
  if (cashierMatch) {
    return { name: "cashier" as const, restaurantId: decodeURIComponent(cashierMatch[1]) };
  }

  const kitchenMatch = pathname.match(/^\/kitchen\/([^/]+)\/?$/);
  if (kitchenMatch) {
    return { name: "kitchen" as const, restaurantId: decodeURIComponent(kitchenMatch[1]) };
  }

  const ownerMatch = pathname.match(/^\/owner\/([^/]+)\/?$/);
  if (ownerMatch) {
    return { name: "owner" as const, restaurantId: decodeURIComponent(ownerMatch[1]) };
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

  if (route.name === "home") {
    return <LandingPage />;
  }

  if (route.name === "sign-up") {
    return <OwnerSignupPage />;
  }

  if (route.name === "ordering") {
    return <OrderingPage restaurantSlug={route.restaurantSlug} />;
  }

  if (route.name === "cashier") {
    return <ProtectedCashierRoute restaurantId={route.restaurantId} />;
  }

  if (route.name === "staff-login") {
    return <StaffLoginPage />;
  }

  if (route.name === "forgot-password") {
    return <ForgotPasswordPage />;
  }

  if (route.name === "reset-password") {
    return <ResetPasswordPage />;
  }

  if (route.name === "kitchen") {
    return <ProtectedKitchenRoute restaurantId={route.restaurantId} />;
  }

  if (route.name === "owner") {
    return <ProtectedOwnerRoute restaurantId={route.restaurantId} />;
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
