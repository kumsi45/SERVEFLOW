# Phase 1 RLS Policies

The canonical policy implementation is `supabase/migrations/001_phase1_saas_backbone.sql`.

## Isolation Rule

Tenant data is isolated by `restaurant_id`.

Every tenant-owned table has a required `restaurant_id`, and every RLS policy checks that the row belongs to the authenticated user's restaurant.

## Policy Summary

| Table | Rule |
| --- | --- |
| `restaurants` | Authenticated users may read only their own restaurant. Admins may update only their own restaurant. |
| `users` | Users may read themselves. Restaurant admins may read and update non-super-admin users in their own restaurant. Kitchen staff and customers cannot enumerate restaurant users. Super-admin assignment is service-role only. |
| `categories` | Same-restaurant users may read. Admins may manage only their own restaurant categories. |
| `menu_items` | Same-restaurant users may read. Admins may manage only their own restaurant menu items. |
| `orders` | Admin and kitchen may read same-restaurant orders. Customers may create and read only their own same-restaurant orders. Admin table updates are same-restaurant only. Kitchen status updates must use `public.update_order_status`. |
| `order_items` | Visibility follows the parent order. Customers may add items only to their own pending same-restaurant order. |

## Kitchen Status Updates

Kitchen staff do not receive broad table update permission on `orders`.

Kitchen status changes go through:

```sql
public.update_order_status(target_order_id uuid, next_status public.order_status)
```

The function checks that the caller is `admin` or `kitchen`, resolves the caller's `restaurant_id` from `auth.uid()`, and updates only the `status` column for an order in that restaurant.

## Non-Negotiable Constraint

No client-side role or route check is trusted for tenant isolation. RLS is the enforcement boundary.
