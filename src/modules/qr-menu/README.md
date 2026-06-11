# QR Menu

Phase 2 public QR digital menu.

## Scope

Allowed:

- Public route `/r/:restaurantSlug`.
- Read-only Supabase access to `restaurants`, `categories`, and `menu_items`.
- Restaurant header, category filter, search, grouped menu display, and mobile-first UI.

Blocked:

- Cart.
- Checkout.
- Ordering workflow.
- Kitchen dashboard.
- Admin dashboard.
- Authentication flows.
- Payment logic.

## Structure

- `pages` contains the public menu page.
- `components` contains QR menu UI pieces.
- `hooks` contains page data state.
- `services` contains read-only Supabase access and grouping logic.
