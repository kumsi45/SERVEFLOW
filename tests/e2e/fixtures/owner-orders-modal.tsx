import React from "react";
import { createRoot } from "react-dom/client";
import { OwnerOrdersView } from "../../../src/modules/owner/components/orders/OwnerOrdersView";
import { buildOwnerOrdersReadModel } from "../../../src/modules/owner/services/ownerOrdersReadModel";
import "../../../src/modules/owner/styles/ownerDashboard.css";

const orders = buildOwnerOrdersReadModel({
  restaurantId: "modal-fixture",
  orders: [
    {
      id: "order-modal",
      restaurant_id: "modal-fixture",
      display_number: "#MODAL-1",
      table_id: "table-1",
      table_number: "1",
      dining_session_status: "open",
      customer_name: "Fixture Guest",
      order_source: "waiter",
      created_by_waiter_id: "waiter-1",
      operational_status: "ready",
      payment_method: null,
      total_price: 125780.5,
      created_at: "2026-09-06T10:00:00.000Z",
      completed_at: null,
      table_released_at: null,
    },
  ],
  items: [
    {
      id: "item-1",
      restaurant_id: "modal-fixture",
      order_id: "order-modal",
      quantity: 1,
    },
  ],
  invoices: [],
  staff: [
    {
      id: "waiter-1",
      restaurant_id: "modal-fixture",
      display_name: "Fixture Waiter",
      role: "waiter",
    },
  ],
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OwnerOrdersView
      orders={orders}
      loading={false}
      financialAvailable
      formatMoney={(value) => `ETB ${value.toLocaleString("en", { minimumFractionDigits: 2 })}`}
    />
  </React.StrictMode>,
);
