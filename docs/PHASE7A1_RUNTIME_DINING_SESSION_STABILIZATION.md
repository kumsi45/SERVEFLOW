# Phase 7A.1 — Runtime Realtime and Dining Session Stabilization

## Root causes

1. The central realtime stream subscribed to `dining_sessions`, but this database has no such relation; session state is stored on `orders`. Several real stream tables also existed outside `supabase_realtime`, causing missing or errored delivery.
2. `submit_waiter_order_batch` intentionally created a new invoice for every appended batch. The customer RPC inherited the same per-batch invoice behavior.
3. Appended waiter items were written as `held`; the kitchen queue and start RPC also required invoice payment state. Consequently a valid operational batch could be absent from the canonical station queue.
4. Kitchen lifecycle reconciliation already existed on `order_items`, but missing queue events and payment-gated item transitions prevented the trigger from producing timely canonical order updates.

## Runtime event trace

```text
order/order_item/order_invoice transaction
  -> supabase_realtime (restaurant_id or restaurants.id filter)
  -> RestaurantEventService payload tenant check
  -> role consumer debounce/incremental handler
  -> canonical RPC refresh / React state
  -> Cashier, Kitchen, Owner, Manager or Customer UI
```

## Corrections

- Removed the nonexistent `dining_sessions` binding.
- Published every real table consumed by `RestaurantEventService`.
- Reused the oldest pending invoice in an open order/dining session.
- Kept each append as a distinct `appended_at` kitchen batch while moving its items to the same invoice.
- Released new items to legacy kitchen state `paid`, which is the database value mapped to canonical operational `Accepted` and is independent from `order_invoices.payment_status`.
- Removed payment predicates from the canonical station queue and kitchen start authorization.
- Preserved the existing item-trigger reconciliation of `orders.operational_status`.

## Automated validation

- Remote migrations 144 and 145 are applied.
- Customer route reached realtime `connected`.
- Offline/online browser transition recovered to `connected` without refresh.
- Production build and regression suite pass.

## Manual acceptance still required

The Coffee -> Pizza -> Burger customer and waiter mutations require a disposable authenticated restaurant/table fixture. They were not injected into the occupied production Table 9. Verify one open order/session, one invoice, three distinct `appended_at` batches, and immediate cross-role lifecycle updates before assigning full production readiness.
