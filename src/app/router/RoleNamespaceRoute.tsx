import { useEffect, useState } from "react";
import { ProtectedCashierRoute } from "../../modules/staff-auth/pages/ProtectedCashierRoute";
import { ProtectedKitchenRoute } from "../../modules/staff-auth/pages/ProtectedKitchenRoute";
import { ProtectedManagerRoute } from "../../modules/staff-auth/pages/ProtectedManagerRoute";
import { ProtectedOwnerRoute } from "../../modules/staff-auth/pages/ProtectedOwnerRoute";
import { ProtectedInventoryRoute } from "../../modules/staff-auth/pages/ProtectedInventoryRoute";
import { getCurrentStaffSession } from "../../modules/staff-auth/services/staffAuthService";
import { getActiveWaiterSession } from "../../modules/waiter-auth/services/waiterAuthService";
import { WaiterDashboardPage } from "../../modules/waiter-dashboard/pages/WaiterDashboardPage";

export type RoleNamespace = "owner" | "manager" | "waiter" | "cashier" | "kitchen" | "inventory" | "admin";

type State =
  | { status: "loading" }
  | { status: "authorized"; role: "owner" | "manager" | "cashier" | "kitchen" | "inventory"; restaurantId: string }
  | { status: "waiter"; restaurantSlug: string }
  | { status: "unavailable" };

function dashboardPath(role: string) {
  return role === "owner" || role === "cashier" || role === "kitchen" || role === "inventory" || role === "waiter" || role === "manager" || role === "admin"
    ? `/${role}/dashboard`
    : "/staff-login";
}

export function RoleNamespaceRoute({ namespace, section }: { namespace: RoleNamespace; section: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let mounted = true;
    async function resolve() {
      if (namespace === "waiter") {
        const waiter = getActiveWaiterSession();
        if (waiter) {
          if (mounted) setState({ status: "waiter", restaurantSlug: waiter.restaurant.slug });
          return;
        }
      }

      const session = await getCurrentStaffSession();
      if (!mounted) return;
      if (!session || session.restaurants.length === 0) {
        window.location.replace("/staff-login");
        return;
      }

      const roleMatch = session.restaurants.filter((restaurant) => restaurant.role === namespace);
      if (roleMatch.length === 0) {
        window.location.replace(dashboardPath(session.restaurants[0].role));
        return;
      }

      const savedRestaurantId = window.sessionStorage.getItem(`serveflow.active-restaurant:${namespace}`);
      const restaurant = roleMatch.find((candidate) => candidate.id === savedRestaurantId) ?? roleMatch[0];
      window.sessionStorage.setItem(`serveflow.active-restaurant:${namespace}`, restaurant.id);
      setState({ status: "authorized", role: restaurant.role, restaurantId: restaurant.id });
    }
    void resolve().catch(() => { if (mounted) setState({ status: "unavailable" }); });
    return () => { mounted = false; };
  }, [namespace]);

  if (state.status === "loading") return <main className="route-message"><p>Opening workspace…</p></main>;
  if (state.status === "waiter") return <WaiterDashboardPage restaurantSlug={state.restaurantSlug} />;
  if (state.status === "authorized") {
    if (state.role === "owner") return <ProtectedOwnerRoute restaurantId={state.restaurantId} section={section} />;
    if (state.role === "manager") return <ProtectedManagerRoute restaurantId={state.restaurantId} section={section} />;
    if (state.role === "cashier") return <ProtectedCashierRoute restaurantId={state.restaurantId} section={section} />;
    if (state.role === "inventory") return <ProtectedInventoryRoute restaurantId={state.restaurantId} />;
    return <ProtectedKitchenRoute restaurantId={state.restaurantId} />;
  }
  return <main className="route-message"><p>This role workspace is not configured for this account.</p></main>;
}

export function LegacyRoleRedirect({ restaurantId, role }: { restaurantId: string; role: "owner" | "cashier" | "kitchen" }) {
  window.sessionStorage.setItem(`serveflow.active-restaurant:${role}`, restaurantId);
  window.location.replace(`/${role}/dashboard`);
  return null;
}

export function LegacyStaffRedirect() {
  const [message, setMessage] = useState("Resolving your workspace…");
  useEffect(() => {
    let mounted = true;
    void getCurrentStaffSession().then((session) => {
      if (!session?.restaurants[0]) { window.location.replace("/staff-login"); return; }
      const restaurant = session.restaurants[0];
      window.sessionStorage.setItem(`serveflow.active-restaurant:${restaurant.role}`, restaurant.id);
      window.location.replace(dashboardPath(restaurant.role));
    }).catch(() => { if (mounted) setMessage("Unable to resolve this workspace."); });
    return () => { mounted = false; };
  }, []);
  return <main className="route-message"><p>{message}</p></main>;
}
