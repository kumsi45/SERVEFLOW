# SERVEFLOW Tenancy

Tenant isolation belongs in `src/core/tenants`, `src/core/permissions`, `src/core/database`, `src/core/guards`, and Supabase RLS.

## Tenant Model

`restaurant_id` is the single source of truth.

Every private tenant-owned row must include `restaurant_id`. Every authenticated database request must resolve the user's restaurant from `public.users` using `auth.uid()`.

## Enforcement

Tenant isolation is enforced at the database layer through RLS, not by frontend routes or UI state.

The SQL implementation lives in `supabase/migrations/001_phase1_saas_backbone.sql`.

## Request Behavior

1. User authenticates through Supabase Auth.
2. `auth.uid()` identifies the current user.
3. RLS helper functions resolve the user's `restaurant_id` and role.
4. Policies compare requested rows against the user's restaurant.
5. Cross-restaurant reads and writes are denied.

## Browser tenant isolation

The browser never treats a route, slug, localStorage value, or mutable module variable as authorization. Protected routes intersect the requested `restaurant_id` with active `restaurant_staff` membership under the tab's authenticated JWT. Active restaurant choices use `sessionStorage` keys scoped by role and therefore cannot cross tabs.

Each staff tab has its own Supabase auth storage namespace. Customer QR tracking, carts, checkouts, active-session markers, and waiter offline queues include the restaurant slug or restaurant ID in their key. Realtime filters always use the authorized restaurant ID passed by the protected route.

Waiter login resolves the username inside the requested restaurant, authenticates that exact user, then revalidates `staff_id`, `user_id`, `restaurant_id`, `role = waiter`, and `active = true` with the authenticated JWT before creating a waiter session.
