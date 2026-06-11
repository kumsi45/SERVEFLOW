# SERVEFLOW Security Model

Phase 1 establishes the backend SaaS security layer only.

## Source Of Truth

`restaurant_id` is the tenant boundary and the single source of truth for tenant isolation.

The frontend may carry a selected restaurant slug or route value later, but it must never be trusted as the authority for data access.

## Tenant Resolution

Every authenticated request resolves tenant context from the database:

1. Supabase authenticates the user and exposes `auth.uid()`.
2. The system reads `public.users.restaurant_id` for `auth.uid()`.
3. RLS compares row `restaurant_id` to the authenticated user's `restaurant_id`.
4. If the IDs do not match, the database denies access.

Restaurant slugs are useful for routing and public lookup later, but tenant-owned private data must always be filtered and enforced by `restaurant_id`.

## Role Permission Matrix

| Role | Restaurant data | Menu data | Orders | Users | Platform data |
| --- | --- | --- | --- | --- | --- |
| `customer` | Own restaurant only | Read available same-restaurant data when exposed by approved flows | Create/read own same-restaurant orders | Read self | None |
| `kitchen` | Own restaurant only | Read same-restaurant data | Read same-restaurant orders and update status only through `public.update_order_status` | Read self only | None |
| `admin` | Own restaurant only | Manage same-restaurant categories and menu items | Read/update same-restaurant orders | Manage same-restaurant users | None |
| `super_admin` | No client-side cross-tenant access in Phase 1 | No client-side cross-tenant access in Phase 1 | No client-side cross-tenant access in Phase 1 | No client-side cross-tenant access in Phase 1 | Future audited service-role operations only |

## Super Admin Boundary

The `super_admin` role exists in the schema so identity and role assignment are future-proof.

It does not grant unrestricted client access across restaurants. Cross-tenant platform operations must be implemented later through audited server-side service-role functions, never direct browser queries.

## Security Corrections

### Users Table Hardening

Customers and kitchen staff can read only their own `public.users` row.

Restaurant admins can read and update users only when `users.restaurant_id` matches the admin's own `restaurant_id`.

Restaurant admins cannot update `super_admin` rows or promote users to `super_admin`. Super-admin assignment remains service-role only.

Risk reduced: non-admin users cannot enumerate staff or customers in the same restaurant.

### Customer Order Security

Order creation requires:

- authenticated Supabase session
- `customer` role
- matching `restaurant_id`
- `customer_user_id = auth.uid()`
- initial `status = 'pending'`

Order item creation requires a matching customer-owned pending order in the same restaurant.

Risk reduced: customers cannot create orders or order items for another user, another restaurant, or a non-pending order.

Phase 3 browser checkout uses:

```sql
public.create_customer_order(target_restaurant_slug text, requested_items jsonb)
```

The function validates the authenticated customer profile, restaurant membership,
menu item ownership, availability, and server-side prices before creating a
pending order.

### Kitchen Update Safety

Kitchen staff do not have direct table update permission for `orders`.

Kitchen status changes must use:

```sql
public.update_order_status(target_order_id uuid, next_status public.order_status)
```

This RPC updates only `orders.status` and only for orders in the caller's restaurant.

Risk reduced: kitchen users cannot modify pricing, tenant ownership, customer ownership, or other order fields.

### User Profile Creation Strategy

`public.users` records must be created only through controlled backend paths.

Recommended strategy:

1. Use a service-role backend onboarding function for restaurant creation, admin assignment, staff invites, and customer attachment to a restaurant.
2. Do not allow browser clients to insert arbitrary `public.users` rows.
3. Use database triggers only when the restaurant context is already safely known. Plain Auth signup does not know the tenant by itself.
4. Keep `super_admin` assignment service-role only and audited.

Risk reduced: attackers cannot self-assign roles, attach themselves to another restaurant, or create unauthorized tenant profiles from the client.

## Final Security Verdict

PHASE 1 SECURITY APPROVED

## Folder Mapping

| Area | Future responsibility |
| --- | --- |
| `src/core/auth` | Auth session contracts and user identity integration. |
| `src/core/tenants` | Tenant resolution contracts and restaurant context rules. |
| `src/core/permissions` | Role permission mapping and phase access rules. |
| `src/core/database` | Supabase client boundaries and database access conventions. |
| `src/core/guards` | Tenant, role, and phase guard contracts. |
| `supabase/migrations` | Schema, constraints, indexes, functions, and RLS policies. |
| `supabase/policies` | Human-readable RLS policy documentation. |

No UI, feature route, QR menu, ordering workflow, kitchen dashboard, admin dashboard, or frontend component belongs in this phase.
