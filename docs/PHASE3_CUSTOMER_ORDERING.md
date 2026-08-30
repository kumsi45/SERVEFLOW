# Historical Phase 3 Customer Ordering

This document records an obsolete authenticated generic-order proposal. It is
not a supported ServeFlow V1 order-entry method.

## Route

- `/r/:restaurantSlug/order`

The existing Phase 2 route remains:

- `/r/:restaurantSlug`

## Current V1 Contract

Restaurant customers order through canonical restaurant/table QR authority:

```sql
public.create_public_qr_order(...)
```

The supported flow validates the restaurant slug, table number, QR token, and
browser/session context server-side before creating the table session, order,
items, and invoice.

`public.create_customer_order(text,jsonb)` is a fail-closed compatibility
tombstone. It is not takeaway, delivery, or tableless ordering.

## Frontend

The ordering module owns the cart and checkout UI. It calls
`submitPublicQrCustomerOrder`, which invokes the canonical Customer QR RPC.

## Boundary

ServeFlow V1 order entry is limited to Customer QR, Waiter, and Cashier flows.
Takeaway and delivery require separate future architecture phases.
