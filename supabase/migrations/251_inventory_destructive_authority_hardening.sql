-- Inventory V1 Security Phase 1A
-- Preserve Inventory Officer operational authority while reserving master-record
-- lifecycle transitions for active same-tenant Owners and Managers.

create or replace function public.inventory_master_lifecycle_has_access(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_staff s
    where s.restaurant_id = target_restaurant_id
      and s.user_id = auth.uid()
      and s.active = true
      and s.role::text in ('owner', 'manager')
  );
$$;

comment on function public.inventory_master_lifecycle_has_access(uuid) is
  'Active same-tenant Owner or Manager authority for Inventory master-record archive, restore, and soft-delete lifecycle transitions.';

revoke all on function public.inventory_master_lifecycle_has_access(uuid) from public, anon;
grant execute on function public.inventory_master_lifecycle_has_access(uuid) to authenticated, service_role;

create or replace function public.inventory_master_lifecycle_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'Inventory master record tenant cannot be changed.';
  end if;

  -- Trusted maintenance roles remain able to repair tenant data. Browser/API
  -- requests execute as authenticated and must pass the membership check below.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  if (
    new.status is distinct from old.status
    or old.status in ('archived', 'deleted')
    or new.status in ('archived', 'deleted')
  ) and not public.inventory_master_lifecycle_has_access(old.restaurant_id) then
    raise exception 'Inventory master lifecycle access denied.';
  end if;

  return new;
end;
$$;

comment on function public.inventory_master_lifecycle_guard() is
  'Blocks non-administrative staff from archiving, restoring, soft-deleting, or modifying inactive Inventory master records.';

revoke all on function public.inventory_master_lifecycle_guard() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_items',
    'inventory_categories',
    'inventory_units',
    'inventory_storage_locations',
    'inventory_suppliers'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_lifecycle_guard', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.inventory_master_lifecycle_guard()',
      table_name || '_lifecycle_guard',
      table_name
    );
  end loop;
end;
$$;

-- No ServeFlow application path performs physical deletes or truncation of
-- Inventory master data. Remove these unused authenticated capabilities while
-- retaining SELECT, INSERT, and UPDATE for existing RLS-controlled workflows.
revoke delete, truncate on table
  public.inventory_items,
  public.inventory_categories,
  public.inventory_units,
  public.inventory_storage_locations,
  public.inventory_suppliers
from authenticated, anon, public;
