import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import { ManagerLayout } from "../../manager/components/ManagerLayout";
import { ManagerWorkspaceChrome } from "../../manager/components/ManagerWorkspaceChrome";
import { useStaffAuthSession } from "../hooks/useStaffAuthSession";
import type { CurrencyConfig } from "../../../core/format/currency";

const ManagerDashboardPage = lazy(() => import("../../manager/pages/ManagerDashboardPage").then((module) => ({ default: module.ManagerDashboardPage })));
const ManagerOperationsCenterPage = lazy(() => import("../../manager/pages/ManagerOperationsCenterPage").then((module) => ({ default: module.ManagerOperationsCenterPage })));
const ManagerKitchenSupervisionPage = lazy(() => import("../../manager/pages/ManagerKitchenSupervisionPage").then((module) => ({ default: module.ManagerKitchenSupervisionPage })));
const ManagerStaffOperationsPage = lazy(() => import("../../manager/pages/ManagerStaffOperationsPage").then((module) => ({ default: module.ManagerStaffOperationsPage })));
const ManagerCustomerExperiencePage = lazy(() => import("../../manager/pages/ManagerCustomerExperiencePage").then((module) => ({ default: module.ManagerCustomerExperiencePage })));
const ManagerOperationalReportsPage = lazy(() => import("../../manager/pages/ManagerOperationalReportsPage").then((module) => ({ default: module.ManagerOperationalReportsPage })));
const ManagerAiOperationsPage = lazy(() => import("../../manager/pages/ManagerAiOperationsPage").then((module) => ({ default: module.ManagerAiOperationsPage })));

type AccessState =
  | { status: "loading" }
  | { status: "unauthorized"; reason: "session" | "access" }
  | { status: "authorized"; restaurantName: string; managerName: string; currency: CurrencyConfig };

export function ProtectedManagerRoute({ restaurantId, section = "dashboard" }: { restaurantId: string; section?: string }) {
  const authSession = useStaffAuthSession();
  const [access, setAccess] = useState<AccessState>({ status: "loading" });

  useEffect(() => {
    if (authSession.status === "loading") return;
    if (authSession.status === "unauthenticated") {
      setAccess({ status: "unauthorized", reason: "session" });
      return;
    }
    let mounted = true;
    void supabase.from("restaurant_staff")
      .select("display_name,restaurants(id,name,currency_code,currency_symbol,locale)")
      .eq("user_id", authSession.userId!)
      .eq("restaurant_id", restaurantId)
      .eq("role", "manager")
      .eq("active", true)
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return;
        const restaurant = Array.isArray(data?.restaurants) ? data.restaurants[0] : data?.restaurants;
        if (error || !data || !restaurant?.name) setAccess({ status: "unauthorized", reason: "access" });
        else setAccess({
          status: "authorized",
          restaurantName: restaurant.name,
          managerName: data.display_name || "Manager",
          currency: {
            currencyCode: restaurant.currency_code,
            currencySymbol: restaurant.currency_symbol,
            locale: restaurant.locale,
          },
        });
      });
    return () => { mounted = false; };
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
  if (section === "ai") page = <ManagerAiOperationsPage {...props} />;
  return (
    <ManagerWorkspaceChrome restaurantId={restaurantId} section={section}>
      <ManagerLayout restaurantName={access.restaurantName} managerName={access.managerName} section={section}>
        <Suspense fallback={<main className="route-message"><p>Loading manager module...</p></main>}>
          {page}
        </Suspense>
      </ManagerLayout>
    </ManagerWorkspaceChrome>
  );
}
