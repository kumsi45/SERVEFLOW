-- Remove legacy broad table grants. Assignment mutations are authorized only
-- through the canonical SECURITY DEFINER RPCs introduced by migration 245.

revoke all on table public.restaurant_table_waiter_assignments from public, anon, authenticated;
grant select on table public.restaurant_table_waiter_assignments to authenticated;

