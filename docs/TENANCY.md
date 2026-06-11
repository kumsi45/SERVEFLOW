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

No tenant-facing workflows are implemented in Phase 1.
