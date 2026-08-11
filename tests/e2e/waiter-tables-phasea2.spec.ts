import { expect, test, type Page } from "@playwright/test";

const restaurantId = "11111111-1111-4111-8111-111111111111";
const waiterId = "22222222-2222-4222-8222-222222222222";

function row(number: number, orderId: string | null = null) {
  return {
    restaurant_id: restaurantId,
    restaurant_slug: "grand-royal",
    restaurant_name: "Grand Royal",
    restaurant_logo_url: null,
    waiter_staff_id: waiterId,
    waiter_display_name: "Waiter Abdi",
    current_shift: "Current Shift",
    assignment_mode: "assigned_tables",
    table_id: `table-${number}`,
    table_number: number,
    table_label: null,
    seats: 4,
    table_active: true,
    assigned_waiter_staff_id: waiterId,
    assigned_waiter_name: "Waiter Abdi",
    table_status: orderId ? "occupied" : "available",
    active_order_id: orderId,
    active_order_status: orderId ? "paid" : null,
    active_order_source: orderId ? "waiter" : null,
    qr_customer_name: null,
    active_order_created_at: orderId ? new Date(Date.now() - number * 60_000).toISOString() : null,
  };
}

const assignedRows = [
  row(2),
  row(8, "active-order"),
  row(5, "ready-order"),
  row(3, "bill-order"),
  row(11),
  row(12),
];

const metrics = [
  { order_id: "active-order", total: 800, invoice_count: 1, session_number: "S-8", invoice_numbers: ["I-8"], ready_item_count: 0, item_count: 2, bill_requested_at: null, billing_started_at: null, payment_verified_at: null },
  { order_id: "ready-order", total: 1250, invoice_count: 1, session_number: "S-5", invoice_numbers: ["I-5"], ready_item_count: 2, item_count: 3, bill_requested_at: null, billing_started_at: null, payment_verified_at: null },
  { order_id: "bill-order", total: 600, invoice_count: 1, session_number: "S-3", invoice_numbers: ["I-3"], ready_item_count: 0, item_count: 1, bill_requested_at: new Date().toISOString(), billing_started_at: null, payment_verified_at: null },
];

const table5Detail = {
  order_id: "ready-order",
  session_number: "S-5",
  opened_at: new Date(Date.now() - 12 * 60_000).toISOString(),
  operational_status: "serving",
  dining_session_status: "open",
  bill_requested_at: null,
  billing_started_at: null,
  payment_verified_at: null,
  customer_name: "Guest",
  waiter_name: "Waiter Abdi",
  creator_name: "Waiter Abdi",
  source: "waiter",
  total: 1260,
  invoices: [
    {
      id: "invoice-ready",
      display_number: "I-5",
      status: "paid",
      total: 1260,
      created_at: new Date().toISOString(),
      creator_name: "Waiter Abdi",
      source: "waiter",
      items: [
        { id: "burger-line", name: "Burger", quantity: 2, price: 430, kitchen_status: "preparing" },
        { id: "coffee-line", name: "Coffee", quantity: 1, price: 200, kitchen_status: "ready" },
        { id: "tea-line", name: "Tea", quantity: 1, price: 200, kitchen_status: "preparing" },
      ],
    },
  ],
};

async function prepare(page: Page, rows = assignedRows) {
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
  let tableRequests = 0;
  let cancellationRequests: Array<Record<string, unknown>> = [];
  await page.route("**/rest/v1/rpc/get_waiter_dashboard_tables", (route) => {
    tableRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await page.route("**/rest/v1/rpc/get_waiter_order_metrics", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(metrics) }));
  await page.route("**/rest/v1/rpc/get_waiter_session_detail", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(table5Detail) }));
  await page.route("**/rest/v1/rpc/get_waiter_session_batches", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
      { item_id: "burger-line", created_at: table5Detail.opened_at, appended_at: null },
      { item_id: "coffee-line", created_at: table5Detail.opened_at, appended_at: null },
      { item_id: "tea-line", created_at: table5Detail.opened_at, appended_at: null },
    ]) }));
  await page.route("**/rest/v1/rpc/get_waiter_transfer_policy", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ allowed: true, reason: null }) }));
  await page.route("**/rest/v1/rpc/get_waiter_item_notes", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/rest/v1/rpc/get_waiter_ordering_policy", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ allowed: true, reason: null }) }));
  await page.route("**/rest/v1/order_invoices**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "invoice-ready", payment_status: "paid" }]) }));
  await page.route("**/rest/v1/order_cancellation_requests**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cancellationRequests) }));
  await page.route("**/rest/v1/rpc/request_waiter_cancellation", async (route) => {
    const payload = route.request().postDataJSON() as { target_order_id: string; target_order_item_id: string | null; cancellation_reason: string; cancellation_note: string | null };
    cancellationRequests = [
      {
        id: "cancel-request-1",
        order_id: payload.target_order_id,
        order_item_id: payload.target_order_item_id,
        request_scope: payload.target_order_item_id ? "item" : "order",
        reason: payload.cancellation_reason,
        note: payload.cancellation_note,
        status: "pending_review",
        requested_at: new Date().toISOString(),
        current_order_status: "serving",
        current_kitchen_status: "preparing",
        current_payment_status: "paid",
      },
    ];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ request_id: "cancel-request-1", status: "pending_review" }) });
  });
  await page.route("**/rest/v1/rpc/request_waiter_final_bill", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "null" }));
  await page.route("**/rest/v1/waiter_assistance_requests**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/rest/v1/rpc/record_waiter_logout", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204, body: "" }));
  return () => tableRequests;
}

test("assigned tables render as a prioritized compact operational grid", async ({ page }) => {
  const requests = await prepare(page);
  await page.goto("/waiter/dashboard");
  await expect(page.locator(".a2-table")).toHaveCount(6);
  await expect.poll(() => requests()).toBe(1);
  await expect(page.locator(".a2-heading")).toContainText("My Tables6");
  const labels = await page.locator(".a2-table").evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label")));
  expect(labels).toEqual([
    "Table 5, Ready",
    "Table 3, Bill",
    "Table 8, Active",
    "Table 2, Free",
    "Table 11, Free",
    "Table 12, Free",
  ]);
  await expect(page.locator(".a2-grid")).not.toContainText("Waiter Abdi");
  await expect(page.locator(".a2-grid")).not.toContainText("Tap table");
  await page.getByRole("button", { name: /^Ready/ }).click();
  await expect(page.locator(".a2-table")).toHaveCount(1);
  await page.getByRole("button", { name: /^All/ }).click();
  await expect(page.locator(".a2-table")).toHaveCount(6);
});

test("free and active cards keep their existing one-tap destinations without reload", async ({ page }) => {
  await prepare(page);
  let documents = 0;
  page.on("request", (request) => { if (request.resourceType() === "document") documents += 1; });
  await page.goto("/waiter/dashboard");
  const initialDocuments = documents;
  await page.getByRole("button", { name: "Table 8, Active" }).click();
  await expect(page.locator(".a4-session-header")).toContainText("TABLE 8");
  await page.locator(".a4-session-header").getByRole("button").first().click();
  await page.getByRole("button", { name: "Table 2, Free" }).click();
  await expect(page).toHaveURL(/\/waiter\/grand-royal\/order\/2$/);
  expect(documents).toBe(initialDocuments);
});

test("zero authoritative rows show the assignment empty state and logout remains immediate", async ({ page }) => {
  await prepare(page, []);
  await page.goto("/waiter/dashboard");
  await expect(page.getByText("No tables assigned")).toBeVisible();
  await expect(page.getByText("Ask your manager for a table assignment.")).toBeVisible();
  await expect(page.locator(".a2-table")).toHaveCount(0);
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("button", { name: "Waiter Login" })).toBeVisible();
});

test("table grid uses four, three, and two columns across required tablet and mobile widths", async ({ page }) => {
  await prepare(page);
  for (const [width, height, columns] of [[1024, 768, 4], [768, 1024, 3], [390, 844, 2]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/waiter/dashboard");
    await expect(page.locator(".a2-table")).toHaveCount(6);
    const actual = await page.locator(".a2-grid").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    expect(actual).toBe(columns);
  }
});

test("active table A4 shows simple order, kitchen ready state, total, and bill confirmation", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/waiter/dashboard");
  await page.getByRole("button", { name: "Table 5, Ready" }).click();

  await expect(page.locator(".a4-session-header")).toContainText("TABLE 5");
  await expect(page.locator(".a4-table-hero")).toContainText("READY");
  await expect(page.locator(".a4-panel").filter({ hasText: "ORDER" })).toContainText("2 x Burger");
  await expect(page.locator(".a4-panel").filter({ hasText: "ORDER" })).toContainText("1 x Coffee");
  await expect(page.locator(".a4-panel").filter({ hasText: "ORDER" })).toContainText("1 x Tea");
  await expect(page.locator(".a4-ready-box")).toContainText("Coffee x1");
  await expect(page.locator(".a4-ready-box")).toContainText("READY");
  await expect(page.locator(".a4-total")).toContainText("Br 1,260");
  await expect(page.locator(".a4-session")).not.toContainText("Kitchen Batches");
  await expect(page.locator(".a4-session")).not.toContainText("Dining Session");

  const columns = await page.locator(".a4-columns").evaluate((grid) =>
    getComputedStyle(grid).gridTemplateColumns.split(" ").length,
  );
  expect(columns).toBe(1);

  await page.getByRole("button", { name: "REQUEST BILL" }).click();
  await expect(page.locator(".a4-bill-confirm")).toContainText("TABLE 5");
  await expect(page.locator(".a4-bill-confirm")).toContainText("Br 1,260");
  await page.getByRole("button", { name: "REQUEST", exact: true }).click();
  await expect(page.locator(".w92-notice")).toContainText("BILL REQUESTED");
});

test("active table A4 requests cancellation without removing order state", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/waiter/dashboard");
  await page.getByRole("button", { name: "Table 5, Ready" }).click();

  await page.getByRole("button", { name: "MORE" }).click();
  await page.locator(".a4-more-items article", { hasText: "Burger x2" }).getByRole("button", { name: "Request Cancellation" }).click();
  await expect(page.locator(".a4-cancel-modal")).toContainText("Request Cancellation");
  await page.getByRole("button", { name: "Request Cancellation" }).last().click();

  await expect(page.locator(".w92-notice")).toContainText("Cancellation Requested");
  await page.getByRole("button", { name: "MORE" }).click();
  const burgerRow = page.locator(".a4-more-items article", { hasText: "Burger x2" });
  await expect(burgerRow).toContainText("Cancellation Requested");
  await expect(burgerRow.getByRole("button", { name: "Requested" })).toBeDisabled();
  await expect(page.locator(".a4-total")).toContainText("Br 1,260");
  await expect(page.locator(".a4-order-panel")).toContainText("2 x Burger");

  await page.reload();
  await page.getByRole("button", { name: "Table 5, Ready" }).click();
  await page.getByRole("button", { name: "MORE" }).click();
  await expect(page.locator(".a4-more-items article", { hasText: "Burger x2" })).toContainText("Cancellation Requested");
});

test("active table A4 stays readable across requested responsive sizes", async ({ page }) => {
  await prepare(page);
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [1024, 768],
    [768, 1024],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/waiter/dashboard");
    await page.getByRole("button", { name: "Table 5, Ready" }).click();
    await expect(page.locator(".a4-session-header")).toContainText("TABLE 5");
    await expect(page.locator(".a4-actions")).toBeVisible();
    const geometry = await page.locator(".a4-session").evaluate((node) => {
      const columns = document.querySelector(".a4-columns");
      const actions = document.querySelector(".a4-actions");
      return {
        horizontalOverflow: node.scrollWidth > node.clientWidth + 1,
        actionHeight: actions?.getBoundingClientRect().height ?? 0,
        columnCount: columns
          ? getComputedStyle(columns).gridTemplateColumns.split(" ").length
          : 0,
      };
    });
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.actionHeight).toBeGreaterThanOrEqual(width <= 520 ? 54 : 56);
    expect(geometry.columnCount).toBe(1);
    await page.locator(".a4-session-header").getByRole("button").first().click();
  }
});
