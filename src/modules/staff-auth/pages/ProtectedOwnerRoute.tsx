import { useEffect, useState } from "react";
import { OwnerDashboardPage } from "../../owner/pages/OwnerDashboardPage";
import { useStaffAuthSession } from "../hooks/useStaffAuthSession";
import { supabase } from "../../../core/database";

type ProtectedOwnerRouteProps = {
  restaurantId: string;
};

type AccessState =
  | { status: "loading" }
  | { status: "unauthorized"; reason: "session" | "access" }
  | { status: "authorized"; restaurantName: string; ownerName: string };

export function ProtectedOwnerRoute({ restaurantId }: ProtectedOwnerRouteProps) {
  const authSession = useStaffAuthSession();
  const [accessState, setAccessState] = useState<AccessState>({ status: "loading" });

  useEffect(() => {
    if (authSession.status === "loading") return;

    if (authSession.status === "unauthenticated") {
      setAccessState({ status: "unauthorized", reason: "session" });
      return;
    }

    let isMounted = true;
    setAccessState({ status: "loading" });

    async function checkAccess() {
      try {
        const { data, error } = await supabase
          .from("restaurant_staff")
          .select("role, display_name, restaurants(id, name)")
          .eq("user_id", authSession.userId!)
          .eq("restaurant_id", restaurantId)
          .eq("active", true)
          .eq("role", "owner")
          .limit(1)
          .maybeSingle();

        if (!isMounted) return;
        if (error) { setAccessState({ status: "unauthorized", reason: "access" }); return; }

        const restaurantData = Array.isArray(data?.restaurants) ? data.restaurants[0] : data?.restaurants;
        if (!data || !restaurantData?.name) { setAccessState({ status: "unauthorized", reason: "access" }); return; }

        setAccessState({
          status: "authorized",
          restaurantName: restaurantData.name,
          ownerName: (data as { display_name?: string | null }).display_name || "Owner",
        });
      } catch {
        if (isMounted) setAccessState({ status: "unauthorized", reason: "access" });
      }
    }

    void checkAccess();
    return () => { isMounted = false; };
  }, [authSession.status, authSession.userId, restaurantId]);

  if (accessState.status === "loading") {
    return <main className="route-message"><p>Loading owner dashboard...</p></main>;
  }

  if (accessState.status === "unauthorized") {
    if (accessState.reason === "session") {
      window.location.replace("/staff-login");
      return null;
    }
    return <main className="route-message"><p>Owner access is not available for this restaurant.</p></main>;
  }

  return (
    <OwnerDashboardPage
      restaurantId={restaurantId}
      restaurantName={accessState.restaurantName}
      ownerName={accessState.ownerName}
    />
  );
}
