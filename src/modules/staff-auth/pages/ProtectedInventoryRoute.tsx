import { useEffect, useState } from "react";
import { supabase } from "../../../core/database";
import { InventoryDashboardPage } from "../../inventory/pages/InventoryDashboardPage";
import { useStaffAuthSession } from "../hooks/useStaffAuthSession";

type Props = {
  restaurantId: string;
  section?: string;
};

type AccessState =
  | { status: "loading" }
  | { status: "unauthorized"; reason: "session" | "access" }
  | { status: "authorized"; restaurantName: string; staffName: string; staffRole: "owner" | "manager" };

export function ProtectedInventoryRoute({ restaurantId, section = "dashboard" }: Props) {
  const auth = useStaffAuthSession();
  const [access, setAccess] = useState<AccessState>({ status: "loading" });

  useEffect(() => {
    if (auth.status === "loading") return;
    if (auth.status === "unauthenticated") {
      setAccess({ status: "unauthorized", reason: "session" });
      return;
    }

    let mounted = true;
    setAccess({ status: "loading" });
    void supabase
      .from("restaurant_staff")
      .select("role,display_name,email,restaurants(id,name)")
      .eq("user_id", auth.userId!)
      .eq("restaurant_id", restaurantId)
      .eq("active", true)
      .in("role", ["owner", "manager"])
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return;
        const restaurant = Array.isArray(data?.restaurants) ? data.restaurants[0] : data?.restaurants;
        const role = data?.role === "owner" || data?.role === "manager" ? data.role : null;
        if (error || !data || !role || !restaurant?.name) {
          setAccess({ status: "unauthorized", reason: "access" });
          return;
        }
        setAccess({
          status: "authorized",
          restaurantName: restaurant.name,
          staffName: data.display_name || data.email || (role === "owner" ? "Owner" : "Manager"),
          staffRole: role,
        });
      }, () => {
        if (mounted) setAccess({ status: "unauthorized", reason: "access" });
      });
    return () => {
      mounted = false;
    };
  }, [auth.status, auth.userId, restaurantId]);

  if (access.status === "loading") {
    return <main className="route-message"><p>Opening inventory administration...</p></main>;
  }

  if (access.status === "unauthorized") {
    if (access.reason === "session") {
      window.location.replace("/staff-login");
      return null;
    }
    return <main className="route-message"><p>Inventory administration is available to owners and managers only.</p></main>;
  }

  return (
    <InventoryDashboardPage
      restaurantId={restaurantId}
      restaurantName={access.restaurantName}
      staffName={access.staffName}
      staffRole={access.staffRole}
      initialSection={section}
    />
  );
}
