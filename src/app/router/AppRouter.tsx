import { useEffect, useState } from "react";
import { QRMenuPage } from "../../modules/qr-menu/pages/QRMenuPage";
import { OrderingPage } from "../../modules/ordering/pages/OrderingPage";
import { StaffLoginPage } from "../../modules/staff-auth/pages/StaffLoginPage";
import { ForgotPasswordPage } from "../../modules/staff-auth/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "../../modules/staff-auth/pages/ResetPasswordPage";
import { WaiterLoginPage } from "../../modules/waiter-auth/pages/WaiterLoginPage";
import { WaiterOrderPage } from "../../modules/waiter-order/pages/WaiterOrderPage";
import { LandingPage } from "../../modules/landing/pages/LandingPage";
import { OwnerSignupPage } from "../../modules/owner-signup/pages/OwnerSignupPage";
import { LegacyRoleRedirect, LegacyStaffRedirect, RoleNamespaceRoute, type RoleNamespace } from "./RoleNamespaceRoute";

const ROLE_SECTIONS: Record<RoleNamespace, readonly string[]> = {
  owner: ["dashboard", "orders", "menu", "staff", "reports", "settings", "analytics", "tables", "recipes"],
  manager: ["dashboard", "kitchen", "cashier", "tables", "staff", "reports", "customers", "intelligence", "ai", "recipes", "menu", "inventory"],
  waiter: ["dashboard", "tables", "orders", "dining-sessions"],
  cashier: ["dashboard", "payments", "checkout", "bills"],
  kitchen: ["dashboard", "stations", "history"],
  inventory: ["dashboard", "items", "current-stock", "movements", "stock-in", "stock-out", "adjustments", "waste", "transfers", "ledger", "movement-history", "purchase-orders", "purchase-history", "low-stock-assistant", "inventory-reports", "inventory-value", "consumption", "waste-report", "inventory-settings", "export", "help", "categories", "suppliers", "storage-locations", "units"],
  admin: ["dashboard", "restaurants", "subscriptions", "users"],
};

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

  if (/^\/setup\/review\/?$/.test(pathname)) {
    return { name: "role-namespace" as const, namespace: "owner" as RoleNamespace, section: "dashboard" };
  }

  const recipeMatch = pathname.match(/^\/(owner|manager|inventory)\/recipes\/?$/);
  if (recipeMatch) {
    return { name: "role-namespace" as const, namespace: recipeMatch[1] as RoleNamespace, section: "recipes" };
  }

  const roleNamespaceMatch = pathname.match(/^\/(owner|manager|waiter|cashier|kitchen|inventory|admin)\/([^/]+)\/?$/);
  if (roleNamespaceMatch) {
    const namespace = roleNamespaceMatch[1] as RoleNamespace;
    const section = roleNamespaceMatch[2];
    if (ROLE_SECTIONS[namespace].includes(section)) return { name: "role-namespace" as const, namespace, section };
  }

  if (/^\/staff(?:\/.*)?\/?$/.test(pathname)) return { name: "legacy-staff" as const };

  const cashierMatch = pathname.match(/^\/cashier\/([^/]+)\/?$/);
  if (cashierMatch) {
    return { name: "legacy-cashier" as const, restaurantId: decodeURIComponent(cashierMatch[1]) };
  }

  const kitchenMatch = pathname.match(/^\/kitchen\/([^/]+)\/?$/);
  if (kitchenMatch) {
    return { name: "legacy-kitchen" as const, restaurantId: decodeURIComponent(kitchenMatch[1]) };
  }

  const waiterMatch = pathname.match(/^\/waiter\/([^/]+)\/?$/);
  if (waiterMatch) {
    return { name: "waiter" as const, restaurantSlug: decodeURIComponent(waiterMatch[1]) };
  }

  const waiterDashboardMatch = pathname.match(/^\/waiter\/([^/]+)\/dashboard\/?$/);
  if (waiterDashboardMatch) {
    return { name: "legacy-waiter-dashboard" as const, restaurantSlug: decodeURIComponent(waiterDashboardMatch[1]) };
  }

  const waiterOrderMatch = pathname.match(/^\/waiter\/([^/]+)\/order\/([^/]+)\/?$/);
  if (waiterOrderMatch) {
    return {
      name: "waiter-order" as const,
      restaurantSlug: decodeURIComponent(waiterOrderMatch[1]),
      tableNumber: decodeURIComponent(waiterOrderMatch[2]),
    };
  }

  const ownerMatch = pathname.match(/^\/owner\/([^/]+)\/?$/);
  if (ownerMatch) {
    return { name: "legacy-owner" as const, restaurantId: decodeURIComponent(ownerMatch[1]) };
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
  const [locationKey,setLocationKey]=useState(()=>window.location.pathname+window.location.search);
  useEffect(()=>{const update=()=>setLocationKey(window.location.pathname+window.location.search);window.addEventListener("popstate",update);return()=>window.removeEventListener("popstate",update)},[]);
  const route = resolveRoute(locationKey.split("?")[0]);

  if (route.name === "home") {
    return <LandingPage />;
  }

  if (route.name === "sign-up") {
    return <OwnerSignupPage />;
  }

  if (route.name === "ordering") {
    const params = new URLSearchParams(window.location.search);
    if ((params.get("t") || params.get("table")) && params.get("qr")) {
      const menuPath = `/r/${encodeURIComponent(route.restaurantSlug)}${window.location.search}`;
      window.history.replaceState({}, "", menuPath);
      return <QRMenuPage restaurantSlug={route.restaurantSlug} />;
    }

    return <OrderingPage restaurantSlug={route.restaurantSlug} />;
  }

  if (route.name === "role-namespace") {
    return <RoleNamespaceRoute namespace={route.namespace} section={route.section} />;
  }

  if (route.name === "legacy-staff") {
    return <LegacyStaffRedirect />;
  }

  if (route.name === "legacy-cashier") {
    return <LegacyRoleRedirect role="cashier" restaurantId={route.restaurantId} />;
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

  if (route.name === "legacy-kitchen") {
    return <LegacyRoleRedirect role="kitchen" restaurantId={route.restaurantId} />;
  }

  if (route.name === "waiter") {
    return <WaiterLoginPage restaurantSlug={route.restaurantSlug} />;
  }

  if (route.name === "legacy-waiter-dashboard") {
    window.sessionStorage.setItem("serveflow.waiter.restaurant-slug", route.restaurantSlug);
    window.location.replace("/waiter/dashboard");
    return null;
  }

  if (route.name === "waiter-order") {
    return <WaiterOrderPage restaurantSlug={route.restaurantSlug} tableNumber={route.tableNumber} />;
  }

  if (route.name === "legacy-owner") {
    return <LegacyRoleRedirect role="owner" restaurantId={route.restaurantId} />;
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
