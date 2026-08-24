-- Inventory V1 freeze: internal default-data seeding must never be directly
-- callable by an ordinary authenticated session. initialize_inventory and
-- repair_inventory_defaults remain the authorization-checking entry points.

revoke all on function public.seed_inventory_default_master_data(uuid)
  from public, anon, authenticated;
grant execute on function public.seed_inventory_default_master_data(uuid)
  to service_role;

-- The no-argument repair function checks auth.role()='service_role' internally,
-- but its catalog grant should match that contract as defense in depth.
revoke all on function public.repair_inventory_defaults()
  from public, anon, authenticated;
grant execute on function public.repair_inventory_defaults()
  to service_role;
