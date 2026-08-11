import { expect, test } from "@playwright/test";

const restaurantId = "11111111-1111-4111-8111-111111111111";
const waiterId = "22222222-2222-4222-8222-222222222222";
const tableId = "99999999-9999-4999-8999-999999999999";

test("assigned waiter resolves a fresh assistance alert and it stays gone after reload", async ({ page }) => {
  await page.addInitScript(({ restaurantId, waiterId }) => {
    sessionStorage.setItem("serveflow.waiter.session.v1", JSON.stringify({
      staffId: waiterId,
      userId: "33333333-3333-4333-8333-333333333333",
      displayName: "Waiter Abdi",
      username: "WT-00002",
      restaurant: { id: restaurantId, slug: "grand-royal", name: "Grand Royal", logoUrl: null, currencyCode: "ETB", currencySymbol: "Br", locale: "en-ET" },
      signedInAt: new Date().toISOString(),
    }));
  }, { restaurantId, waiterId });

  let active = true;
  await page.route("**/rest/v1/rpc/get_waiter_dashboard_tables", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      restaurant_id: restaurantId,
      restaurant_slug: "grand-royal",
      restaurant_name: "Grand Royal",
      restaurant_logo_url: null,
      waiter_staff_id: waiterId,
      waiter_display_name: "Waiter Abdi",
      current_shift: "Current Shift",
      assignment_mode: "assigned_tables",
      table_id: tableId,
      table_number: 9,
      table_label: "Table 9",
      seats: 4,
      table_active: true,
      assigned_waiter_staff_id: waiterId,
      assigned_waiter_name: "Waiter Abdi",
      table_status: "occupied",
      active_order_id: "order-9",
      active_order_status: "pending",
      active_order_source: "waiter",
      qr_customer_name: null,
      active_order_created_at: new Date().toISOString(),
    }]),
  }));
  await page.route("**/rest/v1/rpc/get_waiter_order_metrics", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/rest/v1/waiter_assistance_requests**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(active ? [{
      id: "help-9",
      order_id: "order-9",
      table_id: tableId,
      status: "pending",
      requested_at: new Date().toISOString(),
    }] : []),
  }));
  await page.route("**/rest/v1/rpc/resolve_waiter_assistance_request", (route) => {
    active = false;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ request_id: "help-9", status: "resolved", resolved_by_staff_id: waiterId }),
    });
  });

  await page.goto("/waiter/dashboard");
  await expect(page.getByText("TABLE 9 NEEDS HELP")).toBeVisible();
  await page.getByRole("button", { name: "Resolve assistance request for Table 9" }).click();
  await expect(page.getByText("TABLE 9 NEEDS HELP")).toBeHidden();
  await page.reload();
  await expect(page.getByText("TABLE 9 NEEDS HELP")).toHaveCount(0);
});
