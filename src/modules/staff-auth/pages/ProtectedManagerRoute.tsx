import { useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import { ManagerDashboardPage } from "../../manager/pages/ManagerDashboardPage";
import { useStaffAuthSession } from "../hooks/useStaffAuthSession";

type AccessState =
  | { status: "loading" }
  | { status: "unauthorized"; reason: "session" | "access" }
  | { status: "authorized"; restaurantName: string; managerName: string };

export function ProtectedManagerRoute({ restaurantId }: { restaurantId: string }) {
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
      .select("display_name,restaurants(id,name)")
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
        else setAccess({ status: "authorized", restaurantName: restaurant.name, managerName: data.display_name || "Manager" });
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
  return <ManagerDashboardPage restaurantName={access.restaurantName} managerName={access.managerName} />;
}
