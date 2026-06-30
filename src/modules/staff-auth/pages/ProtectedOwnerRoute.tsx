import { useEffect, useState } from "react";
import { OwnerDashboardPage } from "../../owner/pages/OwnerDashboardPage";
import { RestaurantSetupWizardPage } from "../../setup-wizard/pages/RestaurantSetupWizardPage";
import { useStaffAuthSession } from "../hooks/useStaffAuthSession";
import { supabase } from "../../../core/database";

type ProtectedOwnerRouteProps = {
  restaurantId: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AccessState =
  | { status: "loading" }
  | { status: "unauthorized"; reason: "session" | "access" }
  | { status: "authorized"; restaurantId: string; restaurantName: string; ownerName: string; setupCompleted: boolean };

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
        let resolvedRestaurantId = restaurantId;

        if (!UUID_PATTERN.test(restaurantId)) {
          const { data: restaurantRow, error: restaurantError } = await supabase
            .from("restaurants")
            .select("id")
            .eq("slug", restaurantId)
            .limit(1)
            .maybeSingle();

          if (restaurantError || !restaurantRow?.id) {
            if (isMounted) setAccessState({ status: "unauthorized", reason: "access" });
            return;
          }

          resolvedRestaurantId = restaurantRow.id;
        }

        const { data, error } = await supabase
          .from("restaurant_staff")
          .select("role, display_name, restaurants(id, name, setup_status)")
          .eq("user_id", authSession.userId!)
          .eq("restaurant_id", resolvedRestaurantId)
          .eq("active", true)
          .eq("role", "owner")
          .limit(1)
          .maybeSingle();

        if (!isMounted) return;
        if (error) { setAccessState({ status: "unauthorized", reason: "access" }); return; }

        const restaurantData = Array.isArray(data?.restaurants) ? data.restaurants[0] : data?.restaurants;
        if (!data || !restaurantData?.name) { setAccessState({ status: "unauthorized", reason: "access" }); return; }
        const setupStatus = restaurantData.setup_status && typeof restaurantData.setup_status === "object"
          ? restaurantData.setup_status as { completed?: unknown }
          : {};

        setAccessState({
          status: "authorized",
          restaurantId: resolvedRestaurantId,
          restaurantName: restaurantData.name,
          ownerName: (data as { display_name?: string | null }).display_name || "Owner",
          setupCompleted: setupStatus.completed === true,
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

  if (!accessState.setupCompleted) {
    return (
      <RestaurantSetupWizardPage
        restaurantId={accessState.restaurantId}
        restaurantName={accessState.restaurantName}
        onFinished={() => {
          setAccessState((current) => current.status === "authorized" ? { ...current, setupCompleted: true } : current);
        }}
      />
    );
  }

  return (
    <OwnerDashboardPage
      restaurantId={accessState.restaurantId}
      restaurantName={accessState.restaurantName}
      ownerName={accessState.ownerName}
    />
  );
}
