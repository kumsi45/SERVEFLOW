import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { supabase } from "../../../core/database";
import { ManagerLayout } from "../../manager/components/ManagerLayout";
import { ManagerWorkspaceChrome } from "../../manager/components/ManagerWorkspaceChrome";
import { useStaffAuthSession } from "../hooks/useStaffAuthSession";
import type { CurrencyConfig } from "../../../core/format/currency";
import { managerPageLoaders } from "../../manager/managerPageModules";
import { clearManagerDataCache } from "../../manager/services/managerDataCache";

const ManagerDashboardPage = lazy(() => managerPageLoaders.dashboard().then((module) => ({ default: module.ManagerDashboardPage })));
const ManagerOperationsCenterPage = lazy(() => managerPageLoaders.tables().then((module) => ({ default: module.ManagerOperationsCenterPage })));
const ManagerKitchenSupervisionPage = lazy(() => managerPageLoaders.kitchen().then((module) => ({ default: module.ManagerKitchenSupervisionPage })));
const ManagerStaffOperationsPage = lazy(() => managerPageLoaders.staff().then((module) => ({ default: module.ManagerStaffOperationsPage })));
const ManagerCustomerExperiencePage = lazy(() => managerPageLoaders.customers().then((module) => ({ default: module.ManagerCustomerExperiencePage })));
const ManagerOperationalReportsPage = lazy(() => managerPageLoaders.reports().then((module) => ({ default: module.ManagerOperationalReportsPage })));
const ManagerRestaurantIntelligencePage = lazy(() => managerPageLoaders.intelligence().then((module) => ({ default: module.ManagerRestaurantIntelligencePage })));
const ManagerMenuWorkspacePage = lazy(() => managerPageLoaders.menu().then((module) => ({ default: module.ManagerMenuWorkspacePage })));
const ManagerRecipeWorkspacePage = lazy(() => managerPageLoaders.recipes().then((module) => ({ default: module.ManagerRecipeWorkspacePage })));
const ManagerInventoryWorkspacePage = lazy(() => managerPageLoaders.inventory().then((module) => ({ default: module.ManagerInventoryWorkspacePage })));

type AccessState =
  | { status: "loading" }
  | { status: "unauthorized"; reason: "session" | "access" }
  | { status: "authorized"; restaurantName: string; managerName: string; currency: CurrencyConfig };

const MANAGER_ACCESS_RECHECK_MS = 60_000;

async function loadManagerAccess(userId: string, restaurantId: string): Promise<AccessState> {
  const { data, error } = await supabase.from("restaurant_staff")
    .select("display_name,restaurants(id,name,currency_code,currency_symbol,locale)")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .eq("role", "manager")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  const restaurant = Array.isArray(data?.restaurants) ? data.restaurants[0] : data?.restaurants;
  if (error || !data || !restaurant?.name) return { status: "unauthorized", reason: "access" };
  return {
    status: "authorized",
    restaurantName: restaurant.name,
    managerName: data.display_name || "Manager",
    currency: {
      currencyCode: restaurant.currency_code,
      currencySymbol: restaurant.currency_symbol,
      locale: restaurant.locale,
    },
  };
}

export function ProtectedManagerRoute({ restaurantId, section = "dashboard", accessContext }: { restaurantId: string; section?: string; accessContext?: { restaurantName: string; managerName: string; currency: CurrencyConfig } }) {
  const authSession = useStaffAuthSession();
  const [access, setAccess] = useState<AccessState>(() => accessContext ? { status: "authorized", ...accessContext } : { status: "loading" });
  const lastAccessCheck = useRef(accessContext ? Date.now() : 0);

  useEffect(() => {
    if (authSession.status === "loading") return;
    if (authSession.status === "unauthenticated") {
      clearManagerDataCache();
      setAccess({ status: "unauthorized", reason: "session" });
      return;
    }
    if (accessContext) {
      lastAccessCheck.current = Date.now();
      setAccess({ status: "authorized", ...accessContext });
      return;
    }
    let mounted = true;
    void loadManagerAccess(authSession.userId!, restaurantId).then((next) => {
      if (!mounted) return;
      lastAccessCheck.current = Date.now();
      if (next.status === "unauthorized") clearManagerDataCache();
      setAccess(next);
    });
    return () => { mounted = false; };
  }, [accessContext, authSession.status, authSession.userId, restaurantId]);

  useEffect(() => {
    if (authSession.status !== "authenticated" || !authSession.userId) return;
    let mounted = true;
    let pending = false;
    const revalidate = () => {
      if (document.visibilityState !== "visible" || pending || Date.now() - lastAccessCheck.current < MANAGER_ACCESS_RECHECK_MS) return;
      pending = true;
      void loadManagerAccess(authSession.userId!, restaurantId).then((next) => {
        if (!mounted) return;
        lastAccessCheck.current = Date.now();
        if (next.status === "unauthorized") clearManagerDataCache();
        setAccess(next);
      }).finally(() => { pending = false; });
    };
    const intervalId = window.setInterval(revalidate, MANAGER_ACCESS_RECHECK_MS);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [authSession.status, authSession.userId, restaurantId]);

  if (access.status === "loading") return <main className="route-message"><p>Opening Manager Dashboard...</p></main>;
  if (access.status === "unauthorized") {
    if (access.reason === "session") {
      window.location.replace("/staff-login");
      return null;
    }
    return <main className="route-message"><p>Manager access is not available for this restaurant.</p></main>;
  }
  const props = { restaurantId, restaurantName: access.restaurantName, managerName: access.managerName, currency: access.currency };
  let page = <ManagerDashboardPage {...props} />;
  if (section === "tables" || section === "cashier") page = <ManagerOperationsCenterPage {...props} />;
  if (section === "staff") page = <ManagerStaffOperationsPage {...props} />;
  if (section === "kitchen") page = <ManagerKitchenSupervisionPage {...props} />;
  if (section === "customers") page = <ManagerCustomerExperiencePage {...props} />;
  if (section === "reports") page = <ManagerOperationalReportsPage {...props} />;
  if (section === "intelligence") page = <ManagerRestaurantIntelligencePage {...props} />;
  if (section === "menu") page = <ManagerMenuWorkspacePage {...props} />;
  if (section === "recipes") page = <ManagerRecipeWorkspacePage {...props} />;
  if (section === "inventory") page = <ManagerInventoryWorkspacePage {...props} />;
  return (
    <ManagerWorkspaceChrome restaurantId={restaurantId} section={section === "ai" ? "dashboard" : section}>
      <ManagerLayout key={restaurantId} restaurantId={restaurantId} restaurantName={access.restaurantName} managerName={access.managerName} section={section} currency={access.currency}>
        <Suspense fallback={<div className="ml-route-loading" role="status"><span />Opening section…</div>}>
          {page}
        </Suspense>
      </ManagerLayout>
    </ManagerWorkspaceChrome>
  );
}
