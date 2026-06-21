import { useEffect, useState } from "react";
import { KitchenDashboardPage } from "../../kitchen/pages/KitchenDashboardPage";
import { useStaffAuthSession } from "../hooks/useStaffAuthSession";
import { supabase } from "../../../core/database";
import type { KitchenRestaurant } from "../../kitchen/types";

type ProtectedKitchenRouteProps = {
  restaurantId: string;
};

type AccessState =
  | { status: "loading" }
  | { status: "unauthorized"; reason: "session" | "access" }
  | { status: "authorized"; restaurant: KitchenRestaurant };

export function ProtectedKitchenRoute({ restaurantId }: ProtectedKitchenRouteProps) {
  const authSession = useStaffAuthSession();
  const [accessState, setAccessState] = useState<AccessState>({ status: "loading" });

  useEffect(() => {
    if (authSession.status === "loading") {
      return;
    }

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
          .select("role, restaurants(id, name)")
          .eq("user_id", authSession.userId!)
          .eq("restaurant_id", restaurantId)
          .eq("active", true)
          .in("role", ["kitchen", "owner"])
          .limit(1)
          .maybeSingle();

        if (!isMounted) return;

        if (error) {
          setAccessState({ status: "unauthorized", reason: "access" });
          return;
        }

        const restaurantData = Array.isArray(data?.restaurants)
          ? data.restaurants[0]
          : data?.restaurants;

        if (!data || !restaurantData?.id || !restaurantData?.name) {
          setAccessState({ status: "unauthorized", reason: "access" });
          return;
        }

        setAccessState({
          status: "authorized",
          restaurant: {
            id: restaurantData.id,
            name: restaurantData.name,
          },
        });
      } catch {
        if (isMounted) {
          setAccessState({ status: "unauthorized", reason: "access" });
        }
      }
    }

    void checkAccess();

    return () => {
      isMounted = false;
    };
  }, [authSession.status, authSession.userId, restaurantId]);

  if (accessState.status === "loading") {
    return (
      <main className="route-message">
        <p>Checking kitchen access...</p>
      </main>
    );
  }

  if (accessState.status === "unauthorized") {
    if (accessState.reason === "session") {
      // Genuine session loss — redirect to login
      if (typeof window !== "undefined") {
        window.location.replace("/staff-login");
      }
      return null;
    }
    // Role/access denied — show message, do NOT sign out
    return (
      <main className="route-message">
        <p>Kitchen access is not available for this restaurant.</p>
      </main>
    );
  }

  return (
    <KitchenDashboardPage
      restaurantId={restaurantId}
      restaurant={accessState.restaurant}
    />
  );
}
