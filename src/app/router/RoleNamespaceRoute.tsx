import { lazy, Suspense, useEffect, useState } from "react";
import { canAccessInventory } from "../../core/permissions/inventoryAccess";
import { canReadRecipes } from "../../core/permissions/recipeAccess";
import { getCurrentStaffSession } from "../../modules/staff-auth/services/staffAuthService";
import { getActiveWaiterSession } from "../../modules/waiter-auth/services/waiterAuthService";

const ProtectedCashierRoute = lazy(() => import("../../modules/staff-auth/pages/ProtectedCashierRoute").then((module) => ({ default: module.ProtectedCashierRoute })));
const ProtectedKitchenRoute = lazy(() => import("../../modules/staff-auth/pages/ProtectedKitchenRoute").then((module) => ({ default: module.ProtectedKitchenRoute })));
const ProtectedManagerRoute = lazy(() => import("../../modules/staff-auth/pages/ProtectedManagerRoute").then((module) => ({ default: module.ProtectedManagerRoute })));
const ProtectedOwnerRoute = lazy(() => import("../../modules/staff-auth/pages/ProtectedOwnerRoute").then((module) => ({ default: module.ProtectedOwnerRoute })));
const ProtectedInventoryRoute = lazy(() => import("../../modules/staff-auth/pages/ProtectedInventoryRoute").then((module) => ({ default: module.ProtectedInventoryRoute })));
const WaiterDashboardPage = lazy(() => import("../../modules/waiter-dashboard/pages/WaiterDashboardPage").then((module) => ({ default: module.WaiterDashboardPage })));
const RecipeManagementPage = lazy(() => import("../../modules/recipes/pages/RecipeManagementPage").then((module) => ({ default: module.RecipeManagementPage })));

export type RoleNamespace = "owner" | "manager" | "waiter" | "cashier" | "kitchen" | "inventory" | "admin";

type State =
  | { status: "loading" }
  | { status: "authorized"; role: "owner" | "manager" | "cashier" | "kitchen" | "inventory" | "inventory_officer"; restaurantId: string }
  | { status: "waiter"; restaurantSlug: string }
  | { status: "unavailable" };

function dashboardPath(role: string) {
  if (role === "inventory_officer") return "/inventory/dashboard";
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

      const roleMatch = session.restaurants.filter((restaurant) =>
        namespace === "inventory"
          ? canAccessInventory(restaurant.role)
          : restaurant.role === namespace,
      );
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
  if (state.status === "waiter") return <Suspense fallback={<main className="route-message"><p>Opening workspace...</p></main>}><WaiterDashboardPage restaurantSlug={state.restaurantSlug} /></Suspense>;
  if (state.status === "authorized") {
    return <Suspense fallback={<main className="route-message"><p>Opening workspace...</p></main>}>
      {section === "recipes" && state.role === "manager"
        ? <ProtectedManagerRoute restaurantId={state.restaurantId} section={section} />
        : section === "recipes" && canReadRecipes(state.role)
        ? <RecipeManagementPage restaurantId={state.restaurantId} role={state.role} />
        : namespace === "inventory" ? <ProtectedInventoryRoute restaurantId={state.restaurantId} section={section} />
        : state.role === "owner" ? <ProtectedOwnerRoute restaurantId={state.restaurantId} section={section} />
        : state.role === "manager" ? <ProtectedManagerRoute restaurantId={state.restaurantId} section={section} />
        : state.role === "cashier" ? <ProtectedCashierRoute restaurantId={state.restaurantId} section={section} />
        : <ProtectedKitchenRoute restaurantId={state.restaurantId} />}
    </Suspense>;
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
