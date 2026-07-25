-- ServeFlow Phase 8.2.8: inventory default master data seed.
-- Seeds reusable restaurant-scoped master data only.
-- Does not create items, suppliers, recipes, purchases, stock, menu, or movement data.

alter table public.inventory_units add column if not exists plural_name text;
alter table public.inventory_units add column if not exists abbreviation text;
alter table public.inventory_units add column if not exists active boolean not null default true;

comment on column public.inventory_units.plural_name is
  'Plural display name for reusable inventory units.';
comment on column public.inventory_units.abbreviation is
  'Short display abbreviation for reusable inventory units.';
comment on column public.inventory_units.active is
  'True when the unit is active for default setup and selection.';

create or replace function public.seed_inventory_default_master_data(target_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_categories integer := 0;
  inserted_units integer := 0;
  inserted_locations integer := 0;
begin
  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not exists (select 1 from public.restaurants where id = target_restaurant_id) then
    raise exception 'Restaurant not found.';
  end if;

  with defaults(name, sort_order) as (
    values
      ('Vegetables', 10),
      ('Fruits', 20),
      ('Meat', 30),
      ('Poultry', 40),
      ('Seafood', 50),
      ('Dairy', 60),
      ('Dry Goods', 70),
      ('Spices', 80),
      ('Bakery', 90),
      ('Beverages', 100),
      ('Frozen Foods', 110),
      ('Cleaning Supplies', 120),
      ('Packaging', 130),
      ('Office Supplies', 140),
      ('Other', 150)
  ),
  inserted as (
    insert into public.inventory_categories(restaurant_id, name, description, sort_order, status)
    select target_restaurant_id, defaults.name, null, defaults.sort_order, 'active'
    from defaults
    where not exists (
      select 1 from public.inventory_categories existing
      where existing.restaurant_id = target_restaurant_id
        and lower(btrim(existing.name)) = lower(btrim(defaults.name))
    )
    returning 1
  )
  select count(*) into inserted_categories from inserted;

  with defaults(name, plural_name, abbreviation) as (
    values
      ('piece', 'pieces', 'pc'),
      ('kg', 'kg', 'kg'),
      ('g', 'g', 'g'),
      ('L', 'L', 'L'),
      ('ml', 'ml', 'ml'),
      ('bottle', 'bottles', 'btl'),
      ('can', 'cans', 'can'),
      ('box', 'boxes', 'box'),
      ('bag', 'bags', 'bag'),
      ('packet', 'packets', 'pkt'),
      ('dozen', 'dozen', 'doz'),
      ('tray', 'trays', 'tray'),
      ('bundle', 'bundles', 'bdl'),
      ('cup', 'cups', 'cup'),
      ('serving', 'servings', 'svg')
  ),
  inserted as (
    insert into public.inventory_units(
      restaurant_id, name, plural_name, abbreviation, description, status, active
    )
    select target_restaurant_id, defaults.name, defaults.plural_name,
      defaults.abbreviation, defaults.abbreviation, 'active', true
    from defaults
    where not exists (
      select 1 from public.inventory_units existing
      where existing.restaurant_id = target_restaurant_id
        and lower(btrim(existing.name)) = lower(btrim(defaults.name))
    )
    returning 1
  )
  select count(*) into inserted_units from inserted;

  with defaults(name, sort_order) as (
    values
      ('Main Store', 10),
      ('Kitchen Store', 20),
      ('Bar Store', 30),
      ('Dry Store', 40),
      ('Refrigerator', 50),
      ('Freezer', 60),
      ('Cleaning Store', 70)
  ),
  inserted as (
    insert into public.inventory_storage_locations(restaurant_id, name, description, status)
    select target_restaurant_id, defaults.name, null, 'active'
    from defaults
    where not exists (
      select 1 from public.inventory_storage_locations existing
      where existing.restaurant_id = target_restaurant_id
        and lower(btrim(existing.name)) = lower(btrim(defaults.name))
    )
    order by defaults.sort_order
    returning 1
  )
  select count(*) into inserted_locations from inserted;

  return jsonb_build_object(
    'categories_inserted', inserted_categories,
    'units_inserted', inserted_units,
    'storage_locations_inserted', inserted_locations
  );
end;
$$;

create or replace function public.initialize_inventory(target_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  restaurant_row public.restaurants;
  seed_result jsonb := jsonb_build_object(
    'categories_inserted', 0,
    'units_inserted', 0,
    'storage_locations_inserted', 0
  );
begin
  if target_restaurant_id is null or not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Inventory initialization access denied.';
  end if;

  select * into restaurant_row
  from public.restaurants
  where id = target_restaurant_id;

  if restaurant_row.id is null then
    raise exception 'Restaurant not found.';
  end if;

  if restaurant_row.inventory_initialized = true then
    return jsonb_build_object(
      'restaurant_id', target_restaurant_id,
      'initialized', true,
      'already_initialized', true,
      'seed', seed_result
    );
  end if;

  select * into restaurant_row
  from public.restaurants
  where id = target_restaurant_id
  for update;

  if restaurant_row.inventory_initialized = true then
    return jsonb_build_object(
      'restaurant_id', target_restaurant_id,
      'initialized', true,
      'already_initialized', true,
      'seed', seed_result
    );
  end if;

  seed_result := public.seed_inventory_default_master_data(target_restaurant_id);

  update public.restaurants
  set inventory_initialized = true,
      inventory_initialized_at = now(),
      inventory_template = coalesce(inventory_template, 'default-master-data')
  where id = target_restaurant_id;

  return jsonb_build_object(
    'restaurant_id', target_restaurant_id,
    'initialized', true,
    'already_initialized', false,
    'seed', seed_result
  );
end;
$$;

create or replace function public.repair_inventory_defaults(target_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_restaurant_id is null or not public.has_staff_role(
    target_restaurant_id,
    array['owner','manager']::public.restaurant_staff_role[]
  ) then
    raise exception 'Inventory repair access denied.';
  end if;

  if not exists (
    select 1 from public.restaurants
    where id = target_restaurant_id
      and inventory_initialized = true
  ) then
    raise exception 'Inventory must be initialized before repair.';
  end if;

  return public.seed_inventory_default_master_data(target_restaurant_id);
end;
$$;

create or replace function public.repair_inventory_defaults()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.restaurants;
  repaired integer := 0;
  result jsonb;
  results jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required to repair all inventory defaults.';
  end if;

  for row in
    select * from public.restaurants
    where inventory_initialized = true
    order by created_at
  loop
    result := public.seed_inventory_default_master_data(row.id);
    results := results || jsonb_build_array(jsonb_build_object(
      'restaurant_id', row.id,
      'seed', result
    ));
    repaired := repaired + 1;
  end loop;

  return jsonb_build_object('restaurants_repaired', repaired, 'results', results);
end;
$$;

revoke all on function public.seed_inventory_default_master_data(uuid) from public, anon;
revoke all on function public.initialize_inventory(uuid) from public, anon;
revoke all on function public.repair_inventory_defaults(uuid) from public, anon;
revoke all on function public.repair_inventory_defaults() from public, anon;
grant execute on function public.initialize_inventory(uuid) to authenticated, service_role;
grant execute on function public.repair_inventory_defaults(uuid) to authenticated, service_role;
grant execute on function public.repair_inventory_defaults() to service_role;
