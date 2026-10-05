import { createRoot } from "react-dom/client";
import { OwnerSettingsPage } from "../../../src/modules/owner/components/settings/OwnerSettingsPage";
import "../../../src/modules/owner/styles/ownerDashboard.css";

createRoot(document.getElementById("fixture")!).render(
  <div className="od-root">
    <main className="od-main">
      <OwnerSettingsPage
        restaurantId="11111111-1111-4111-8111-111111111111"
        fallbackRestaurantName="Fixture Restaurant"
        config={{
          id: "11111111-1111-4111-8111-111111111111",
          name: "Fixture Restaurant",
          total_tables: 12,
          profile: { restaurant_type: "Restaurant", timezone: "Africa/Nairobi" },
          business_hours: {},
          branding: {},
          currency_code: "ETB",
          currency_symbol: "Br",
        }}
        onSettingsChanged={async () => undefined}
      />
    </main>
  </div>,
);
