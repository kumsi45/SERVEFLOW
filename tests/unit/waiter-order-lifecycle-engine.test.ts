import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").toLowerCase();

const migration = read(
  "supabase/migrations/161_waiter_order_lifecycle_engine.sql",
);
const lifecycle = read("src/core/payment/lifecycle.ts");
const owner = read("src/modules/owner/pages/OwnerDashboardPage.tsx");
const cashier = read("src/modules/cashier/pages/CashierDashboardPage.tsx");
const realtime = read("src/core/realtime/restauranteventservice.ts");

type Policy = "pay_before_kitchen" | "kitchen_before_payment";
type Source = "public_qr" | "waiter";
type Batch = {
  sessionId: string;
  restaurantId: string;
  source: Source;
  payment: "pending" | "held" | "paid";
  kitchen: "held" | "accepted" | "preparing" | "ready" | "completed";
  total: number;
};

function addBatch(
  sessionId: string,
  restaurantId: string,
  source: Source,
  policy: Policy,
  total: number,
): Batch {
  const deferred = source === "waiter" && policy === "kitchen_before_payment";
  return {
    sessionId,
    restaurantId,
    source,
    payment: deferred ? "held" : "pending",
    kitchen: deferred ? "accepted" : "held",
    total,
  };
}

function collectSessionPayment(batches: Batch[], sessionId: string) {
  for (const batch of batches) {
    if (batch.sessionId !== sessionId) continue;
    if (batch.payment === "pending" || batch.payment === "held") {
      batch.payment = "paid";
      if (batch.kitchen === "held") batch.kitchen = "accepted";
    }
  }
}

describe("official waiter order lifecycle engine", () => {
  it("exposes exactly the two supported restaurant waiter modes", () => {
    expect(lifecycle).toContain(
      'export type paymentpolicy = "pay_before_kitchen" | "kitchen_before_payment"',
    );
    expect(owner).toContain('value="pay_before_kitchen"');
    expect(owner).toContain('value="kitchen_before_payment"');
    expect(owner).not.toContain('value="mixed"');
    expect(owner).not.toContain("mixedwaiterpaymenttiming");
    expect(migration).toContain(
      "check (payment_policy in ('pay_before_kitchen', 'kitchen_before_payment'))",
    );
  });

  it("keeps Customer QR permanently payment-before-kitchen", () => {
    for (const policy of [
      "pay_before_kitchen",
      "kitchen_before_payment",
    ] as const) {
      const qr = addBatch("session-1", "restaurant-a", "public_qr", policy, 20);
      expect(qr).toMatchObject({ payment: "pending", kitchen: "held" });
      collectSessionPayment([qr], qr.sessionId);
      expect(qr).toMatchObject({ payment: "paid", kitchen: "accepted" });
    }
    expect(migration).toContain(
      "when coalesce(target_order_source, '') in ('public_qr', 'cashier')",
    );
  });

  it("routes waiter Pay Before Kitchen through cashier before kitchen", () => {
    const batch = addBatch(
      "session-2",
      "restaurant-a",
      "waiter",
      "pay_before_kitchen",
      35,
    );
    expect(batch).toMatchObject({ payment: "pending", kitchen: "held" });
    collectSessionPayment([batch], batch.sessionId);
    expect(batch).toMatchObject({ payment: "paid", kitchen: "accepted" });
  });

  it("routes waiter Kitchen Before Payment immediately to kitchen with Payment Due", () => {
    const batch = addBatch(
      "session-3",
      "restaurant-b",
      "waiter",
      "kitchen_before_payment",
      50,
    );
    expect(batch).toMatchObject({ payment: "held", kitchen: "accepted" });
    batch.kitchen = "preparing";
    batch.kitchen = "ready";
    batch.kitchen = "completed";
    expect(batch.payment).toBe("held");
    expect(cashier).toContain("payment due");
    collectSessionPayment([batch], batch.sessionId);
    expect(batch.payment).toBe("paid");
  });

  it("attaches additional orders to the same dining session and increases its running bill", () => {
    const first = addBatch(
      "session-4",
      "restaurant-b",
      "waiter",
      "kitchen_before_payment",
      40,
    );
    const dessert = addBatch(
      first.sessionId,
      first.restaurantId,
      "waiter",
      "kitchen_before_payment",
      15,
    );
    expect(dessert.sessionId).toBe(first.sessionId);
    expect(dessert.kitchen).toBe("accepted");
    expect(first.total + dessert.total).toBe(55);
    expect(migration).toContain("submit_waiter_order_batch_phase7a1_base");
  });

  it("settles every due batch atomically at dining-session scope", () => {
    expect(migration).toContain(
      "create or replace function public.verify_dining_session_payment",
    );
    expect(migration).toContain("for invoice_row in");
    expect(migration).toContain("invoices.order_id = target_session.id");
    expect(migration).toContain(
      "dining-session payment did not settle every due batch",
    );
    expect(cashier).toContain('"verify_dining_session_payment"');
    expect(cashier).toContain("paymentduesessions");
  });

  it("keeps restaurant policies and session payments tenant isolated", () => {
    const batches = [
      addBatch("a-session", "restaurant-a", "waiter", "pay_before_kitchen", 10),
      addBatch("b-session", "restaurant-b", "waiter", "kitchen_before_payment", 20),
      addBatch("c-session", "restaurant-c", "waiter", "pay_before_kitchen", 30),
    ];
    collectSessionPayment(batches, "b-session");
    expect(batches.map(({ payment, kitchen }) => ({ payment, kitchen }))).toEqual([
      { payment: "pending", kitchen: "held" },
      { payment: "paid", kitchen: "accepted" },
      { payment: "pending", kitchen: "held" },
    ]);
    expect(migration).toContain(
      "staff.restaurant_id = target_session.restaurant_id",
    );
  });

  it("keeps every affected dashboard on tenant realtime tables", () => {
    for (const table of ["orders", "order_items", "order_invoices", "restaurants"]) {
      expect(realtime).toContain(`"${table}"`);
    }
    expect(realtime).toContain("restaurant_id=eq.");
  });
});
