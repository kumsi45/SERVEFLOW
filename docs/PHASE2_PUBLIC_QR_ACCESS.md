# Phase 2 Public QR Menu Access

The public QR menu uses a controlled Supabase RPC instead of weakening table RLS.

## RPC

```sql
public.get_public_qr_menu(target_restaurant_slug text)
```

## Security Model

- The function receives one restaurant slug.
- The database resolves that slug to exactly one `restaurant_id`.
- Categories and menu items are filtered by that resolved `restaurant_id`.
- The function returns only public menu fields.
- The function does not expose users, orders, order items, roles, or tenant-private data.
- The function grants execute access to `anon` and `authenticated`.
- Existing Phase 1 table RLS policies remain unchanged.

## Why RPC

The QR menu is public, but the core tenant tables remain protected by RLS. A `SECURITY DEFINER` RPC gives anonymous visitors a narrow read-only path that cannot perform broad table scans from the client.

## Data Flow

1. `/r/:restaurantSlug` extracts the slug.
2. The frontend calls `get_public_qr_menu`.
3. The function resolves `restaurant_slug -> restaurant_id`.
4. The function returns the matching restaurant, categories, and menu items.
5. The frontend groups and renders the menu.

## Scope

This is read-only public menu access only.

No ordering, cart, checkout, kitchen dashboard, admin dashboard, authentication, or payment logic is included.
