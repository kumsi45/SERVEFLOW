# Phase 3 Customer Ordering

Phase 3 adds authenticated customer ordering without changing the Phase 2 public
QR menu route or behavior.

## Route

- `/r/:restaurantSlug/order`

The existing Phase 2 route remains:

- `/r/:restaurantSlug`

## Backend

Customer order creation is handled by:

```sql
public.create_customer_order(target_restaurant_slug text, requested_items jsonb)
```

The RPC:

- requires an authenticated Supabase user
- requires the caller's `public.users.role` to be `customer`
- requires the caller's `restaurant_id` to match the target restaurant slug
- validates every menu item belongs to that restaurant
- rejects unavailable menu items
- calculates prices on the server
- creates a pending order and its order items in one transaction

## Frontend

The ordering module owns the cart and checkout UI. It calls the existing public
menu RPC for menu display, then calls the Phase 3 order RPC for checkout.

## Boundary

Phase 2 QR menu functionality is not modified by Phase 3.
