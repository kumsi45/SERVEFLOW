-- ServeFlow Phase 8.4.4: Inventory Realtime Engine
-- Publication and read-only targeted synchronization support only.

do $$
declare
  relation_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach relation_name in array array[
      'inventory_items',
      'inventory_movements',
      'inventory_categories',
      'inventory_suppliers',
      'inventory_storage_locations',
      'inventory_units'
    ] loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = relation_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', relation_name);
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.get_inventory_current_stock_items(
  target_restaurant_id uuid,
  target_inventory_item_ids uuid[]
)
returns table(
  inventory_item_id uuid,
  item_name text,
  category_id uuid,
  category_name text,
  storage_location_id uuid,
  storage_location_name text,
  unit_id uuid,
  unit_name text,
  minimum_stock numeric,
  maximum_stock numeric,
  current_quantity numeric,
  stock_status text,
  last_movement_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select stock.*
  from public.get_inventory_current_stock(target_restaurant_id) stock
  where stock.inventory_item_id = any(coalesce(target_inventory_item_ids, array[]::uuid[]))
    and cardinality(coalesce(target_inventory_item_ids, array[]::uuid[])) between 1 and 100;
$$;

revoke all on function public.get_inventory_current_stock_items(uuid, uuid[]) from public, anon;
grant execute on function public.get_inventory_current_stock_items(uuid, uuid[]) to authenticated, service_role;

comment on function public.get_inventory_current_stock_items(uuid, uuid[]) is
  'Read-only Phase 8.4.4 projection used to refresh only inventory items affected by realtime events.';
