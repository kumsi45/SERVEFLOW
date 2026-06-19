import { useEffect, useState } from "react";
import { CashierDashboardPage } from "../../cashier/pages/CashierDashboardPage";
import {
  getCurrentStaffSession,
  getStoredCashierRestaurantId,
  storeCashierRestaurantId,
} from "../services/staffAuthService";
import type { StaffRestaurant, StaffRole, StaffSession } from "../types";

export function ProtectedCashierRoute() {
  const [role, setRole] = useState<StaffRole | null>(null);
  const [staffSession, setStaffSession] = useState<StaffSession | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<StaffRestaurant | null>(null);
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function checkAccess() {
      try {
        const staffSession = await getCurrentStaffSession();

        if (!staffSession) {
          window.location.replace("/staff-login");
          return;
        }

        const cashierRestaurants = staffSession.restaurants.filter(
          (restaurant) => restaurant.role === "owner" || restaurant.role === "cashier"
        );

        if (cashierRestaurants.length === 0) {
          window.location.replace("/kitchen");
          return;
        }

        const storedRestaurantId = getStoredCashierRestaurantId(staffSession.userId);
        const activeRestaurant =
          cashierRestaurants.length === 1
            ? cashierRestaurants[0]
            : cashierRestaurants.find((restaurant) => restaurant.id === storedRestaurantId) ?? null;

        if (activeRestaurant) {
          storeCashierRestaurantId(staffSession.userId, activeRestaurant.id);
        }

        if (isMounted) {
          setRole(staffSession.role);
          setStaffSession({
            ...staffSession,
            restaurants: cashierRestaurants,
          });
          setSelectedRestaurant(activeRestaurant);
        }
      } catch (accessError) {
        if (isMounted) {
          setError(accessError instanceof Error ? accessError.message : "Staff access could not be verified.");
        }
      } finally {
        if (isMounted) {
          setIsCheckingAccess(false);
        }
      }
    }

    void checkAccess();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isCheckingAccess) {
    return (
      <main className="route-message">
        <p>Checking staff access...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="route-message">
        <p>{error}</p>
      </main>
    );
  }

  if ((role === "owner" || role === "cashier") && staffSession) {
    if (!selectedRestaurant) {
      return (
        <main className="staff-login-page">
          <section className="staff-login-panel">
            <div>
              <p className="staff-login-eyebrow">ServeFlow Staff</p>
              <h1>Select Restaurant</h1>
            </div>

            {staffSession.restaurants.map((restaurant) => (
              <button
                key={restaurant.id}
                type="button"
                onClick={() => {
                  storeCashierRestaurantId(staffSession.userId, restaurant.id);
                  setSelectedRestaurant(restaurant);
                }}
              >
                {restaurant.name}
              </button>
            ))}
          </section>
        </main>
      );
    }

    return (
      <CashierDashboardPage
        restaurant={{
          id: selectedRestaurant.id,
          name: selectedRestaurant.name,
          logoUrl: null,
        }}
      />
    );
  }

  return null;
}
