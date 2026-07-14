-- Owner reports and Owner AI intelligence are never Manager capabilities.
create or replace function public.owner_can_report(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.restaurant_staff staff
    where staff.restaurant_id = target_restaurant_id
      and staff.user_id = auth.uid()
      and staff.active = true
      and staff.role::text = 'owner'
  )
$$;

revoke all on function public.owner_can_report(uuid) from public, anon;
grant execute on function public.owner_can_report(uuid) to authenticated, service_role;
