# Phase 1 Supabase Integration Audit

This audit covers the Phase 1 SaaS backbone only.

No QR menu, ordering workflow, kitchen dashboard, admin dashboard, or UI feature is included.

## Environment Setup

Use local environment files copied from:

- `.env.example`
- `.env.local.example`

Required variables:

```txt
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Do not commit real Supabase keys.

For `@supabase/supabase-js`, the URL must be the Supabase project base URL. Do not include `/rest/v1/` in `VITE_SUPABASE_URL`.

## Supabase Client

The singleton client lives in:

- `src/core/database/supabaseClient.ts`

It:

- uses `@supabase/supabase-js`
- reads Vite environment variables
- throws explicit errors when required variables are missing
- exports one reusable `supabase` instance through `src/core/database/index.ts`

## Migration Validation

Migration reviewed:

- `supabase/migrations/001_phase1_saas_backbone.sql`
- `supabase/migrations/002_phase1_security_corrections.sql`

| Area | Status | Notes |
| --- | --- | --- |
| Tables | SAFE | Required core tables exist: `restaurants`, `users`, `categories`, `menu_items`, `orders`, `order_items`. |
| Enums | SAFE | `user_role` and `order_status` model the required role/status values. |
| Indexes | SAFE | Tenant and relationship indexes exist for common RLS/filter paths. |
| Constraints | SAFE | Prices and quantities are checked. Tenant-owned child rows use same-restaurant composite foreign keys. |
| Foreign keys | SAFE | Auth users, restaurants, categories, menu items, orders, and users are relationally connected. |
| Tenant helpers | SAFE | Helper functions resolve current user's restaurant and role from `auth.uid()`. |
| Role assumptions | SAFE | `super_admin` exists but is intentionally not granted client-side cross-tenant access. Platform operations require future audited service-role functions. |
| Auth profile creation | SAFE | Browser clients cannot create arbitrary profiles. Profile creation must use a controlled backend onboarding path or a context-aware trigger. |

## RLS Audit

| Table | Status | Reason |
| --- | --- | --- |
| `restaurants` | SAFE | Authenticated users can read only their own restaurant. Admin updates are restricted to the same restaurant. No client insert/delete policy exists. |
| `users` | SAFE | Users can read themselves. Only restaurant admins can read/update same-restaurant users. Kitchen staff and customers cannot enumerate restaurant users. |
| `categories` | SAFE | Same-restaurant read access and admin-only same-restaurant management are enforced. |
| `menu_items` | SAFE | Same-restaurant read access and admin-only same-restaurant management are enforced. |
| `orders` | SAFE | Tenant and customer isolation are enforced. Inserts require `customer` role and `customer_user_id = auth.uid()`. Kitchen status updates use a narrow RPC. |
| `order_items` | SAFE | Visibility follows the parent order. Inserts require `customer` role and a customer-owned pending same-restaurant order. |

## Tenant Isolation Audit

| Requirement | Status | Notes |
| --- | --- | --- |
| `restaurant_id` is the single tenant identifier | SAFE | Every tenant-owned table includes `restaurant_id`. |
| Tenant rows enforce `restaurant_id` | SAFE | Required `restaurant_id` fields and same-restaurant composite foreign keys prevent cross-tenant child relationships. |
| Isolation happens at database level | SAFE | RLS policies compare row `restaurant_id` to the authenticated user's restaurant. |
| Frontend is not trusted for security | SAFE | Policies resolve tenant context from `auth.uid()` and `public.users`, not UI state. |
| Customer order isolation | SAFE | `orders.customer_user_id` ties customer visibility to `auth.uid()`. |
| Cross-restaurant access | SAFE | No authenticated policy grants cross-restaurant access. |

## Recommended Fixes Before Production

1. Add deployment-time SQL validation against the real Supabase development project before production use.
2. Implement service-role onboarding functions in a later approved backend task.
3. Keep super-admin cross-tenant operations behind audited server-side functions only.

## Final Readiness Assessment

PHASE 1 SECURITY APPROVED
