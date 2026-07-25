-- ServeFlow Phase 8.4.2: atomic automatic inventory deduction engine.
-- One PostgreSQL function call is one transaction: PostgreSQL commits every
-- receipt and movement together, or rolls all of them back on any exception.
-- No workflow, kitchen routing, payment, ordering, recipe, menu, reporting,
-- purchasing, inventory administration, or stock-operation behavior is changed.

create unique index if not exists order_items_restaurant_id_id_unique
  on public.order_items(restaurant_id, id);

create table if not exists public.inventory_order_item_deductions (
  order_item_id uuid primary key,
  restaurant_id uuid not null,
  order_id uuid not null,
  menu_item_id uuid not null,
  deduction_source text not null check (deduction_source in ('recipe', 'direct')),
  order_quantity integer not null check (order_quantity > 0),
  deduction_plan jsonb not null check (
    jsonb_typeof(deduction_plan) = 'array' and jsonb_array_length(deduction_plan) > 0
  ),
  deducted_by_staff_id uuid not null,
  deducted_at timestamptz not null default clock_timestamp(),
  constraint inventory_order_item_deductions_order_item_fk
    foreign key (restaurant_id, order_item_id)
    references public.order_items(restaurant_id, id) on delete cascade,
  constraint inventory_order_item_deductions_order_fk
    foreign key (restaurant_id, order_id)
    references public.orders(restaurant_id, id) on delete cascade,
  constraint inventory_order_item_deductions_menu_item_fk
    foreign key (restaurant_id, menu_item_id)
    references public.menu_items(restaurant_id, id) on delete restrict,
  constraint inventory_order_item_deductions_staff_fk
    foreign key (restaurant_id, deducted_by_staff_id)
    references public.restaurant_staff(restaurant_id, id) on delete restrict
);

create index if not exists inventory_order_item_deductions_restaurant_date_idx
  on public.inventory_order_item_deductions(restaurant_id, deducted_at desc);

-- The receipt primary key is the main idempotency guard. This second database
-- guard prevents duplicate automatic ledger rows for an item even if a caller
-- ever attempts to bypass the engine and insert the same source directly.
create unique index if not exists inventory_movements_order_item_deduction_unique
  on public.inventory_movements(source_record_id, inventory_item_id)
  where source_system = 'automatic_order_item_deduction'
    and source_record_id is not null;

alter table public.inventory_order_item_deductions enable row level security;
revoke all on public.inventory_order_item_deductions from public, anon, authenticated;

create or replace function public.build_inventory_deduction_plan(
  target_order_item_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_item public.order_items;
  target_recipe_id uuid;
  target_direct_inventory_item_id uuid;
  target_recipe_yield numeric;
  missing_conversion text;
  result jsonb;
begin
  select item.* into target_item
  from public.order_items item
  where item.id = target_order_item_id;

  if target_item.id is null then
    raise exception 'Order item not found.';
  end if;

  select menu.recipe_id, menu.direct_inventory_item_id
  into target_recipe_id, target_direct_inventory_item_id
  from public.menu_items menu
  where menu.id = target_item.menu_item_id
    and menu.restaurant_id = target_item.restaurant_id;

  if not found then
    raise exception 'Order item menu source is invalid.';
  end if;
  if target_recipe_id is null and target_direct_inventory_item_id is null then
    return '[]'::jsonb;
  end if;
  if target_recipe_id is not null and target_direct_inventory_item_id is not null then
    raise exception 'Order item has multiple inventory deduction sources.';
  end if;

  if target_direct_inventory_item_id is not null then
    select jsonb_agg(jsonb_build_object(
      'inventory_item_id', inventory.id,
      'inventory_item_name', inventory.name,
      'storage_location_id', inventory.storage_location_id,
      'unit_id', inventory.unit_id,
      'unit_name', item_unit.name,
      'required_quantity', target_item.quantity::numeric,
      'source', 'direct'
    ))
    into result
    from public.inventory_items inventory
    join public.inventory_units item_unit
      on item_unit.id = inventory.unit_id
     and item_unit.restaurant_id = inventory.restaurant_id
     and item_unit.status = 'active'
    join public.inventory_storage_locations storage
      on storage.id = inventory.storage_location_id
     and storage.restaurant_id = inventory.restaurant_id
     and storage.status = 'active'
    where inventory.id = target_direct_inventory_item_id
      and inventory.restaurant_id = target_item.restaurant_id
      and inventory.status = 'active'
      and inventory.active = true;

    if result is null then
      raise exception 'Direct inventory deduction source is invalid.';
    end if;
    return result;
  end if;

  select recipe.yield_quantity
  into target_recipe_yield
  from public.recipes recipe
  where recipe.id = target_recipe_id
    and recipe.restaurant_id = target_item.restaurant_id
    and recipe.status = 'active'
    and recipe.deleted_at is null;

  if target_recipe_yield is null or target_recipe_yield <= 0 then
    raise exception 'Recipe deduction source is invalid.';
  end if;
  if not exists (
    select 1 from public.recipe_ingredients ingredient
    where ingredient.restaurant_id = target_item.restaurant_id
      and ingredient.recipe_id = target_recipe_id
  ) then
    raise exception 'Recipe has no ingredients to deduct.';
  end if;

  select ingredient_inventory.name || ': ' || ingredient_unit.name || ' to ' || item_unit.name
  into missing_conversion
  from public.recipe_ingredients ingredient
  join public.inventory_items ingredient_inventory
    on ingredient_inventory.id = ingredient.inventory_item_id
   and ingredient_inventory.restaurant_id = ingredient.restaurant_id
  join public.inventory_units ingredient_unit
    on ingredient_unit.id = ingredient.unit_id
   and ingredient_unit.restaurant_id = ingredient.restaurant_id
  left join public.inventory_units item_unit
    on item_unit.id = ingredient_inventory.unit_id
   and item_unit.restaurant_id = ingredient_inventory.restaurant_id
  where ingredient.restaurant_id = target_item.restaurant_id
    and ingredient.recipe_id = target_recipe_id
    and public.recipe_unit_conversion_ratio(ingredient_unit.name, item_unit.name) is null
  order by ingredient.sort_order, ingredient.id
  limit 1;

  if missing_conversion is not null then
    raise exception 'Recipe unit conversion is unavailable for %.', missing_conversion;
  end if;

  with expanded as (
    select
      inventory.id inventory_item_id,
      inventory.name inventory_item_name,
      inventory.storage_location_id,
      inventory.unit_id,
      item_unit.name unit_name,
      ingredient.quantity_required
        * target_item.quantity
        / target_recipe_yield
        * public.recipe_unit_conversion_ratio(ingredient_unit.name, item_unit.name)
        as required_quantity
    from public.recipe_ingredients ingredient
    join public.inventory_items inventory
      on inventory.id = ingredient.inventory_item_id
     and inventory.restaurant_id = ingredient.restaurant_id
     and inventory.status = 'active'
     and inventory.active = true
    join public.inventory_units ingredient_unit
      on ingredient_unit.id = ingredient.unit_id
     and ingredient_unit.restaurant_id = ingredient.restaurant_id
     and ingredient_unit.status = 'active'
    join public.inventory_units item_unit
      on item_unit.id = inventory.unit_id
     and item_unit.restaurant_id = inventory.restaurant_id
     and item_unit.status = 'active'
    join public.inventory_storage_locations storage
      on storage.id = inventory.storage_location_id
     and storage.restaurant_id = inventory.restaurant_id
     and storage.status = 'active'
    where ingredient.restaurant_id = target_item.restaurant_id
      and ingredient.recipe_id = target_recipe_id
  ), aggregated as (
    select inventory_item_id, inventory_item_name, storage_location_id, unit_id, unit_name,
      round(sum(required_quantity), 3) required_quantity
    from expanded
    group by inventory_item_id, inventory_item_name, storage_location_id, unit_id, unit_name
  )
  select jsonb_agg(jsonb_build_object(
    'inventory_item_id', inventory_item_id,
    'inventory_item_name', inventory_item_name,
    'storage_location_id', storage_location_id,
    'unit_id', unit_id,
    'unit_name', unit_name,
    'required_quantity', required_quantity,
    'source', 'recipe',
    'recipe_id', target_recipe_id
  ) order by inventory_item_id)
  into result
  from aggregated
  where required_quantity > 0;

  if result is null or jsonb_array_length(result) = 0 then
    raise exception 'Recipe deduction plan is invalid.';
  end if;
  if jsonb_array_length(result) <> (
    select count(*)
    from public.recipe_ingredients ingredient
    where ingredient.restaurant_id = target_item.restaurant_id
      and ingredient.recipe_id = target_recipe_id
  ) then
    raise exception 'Recipe contains an invalid inventory ingredient.';
  end if;

  return result;
end;
$$;

create or replace function public.deduct_inventory_for_order_item(
  target_order_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_item public.order_items;
  target_batch_key text;
  actor_id uuid;
  deduction_plan jsonb;
  validated_plan jsonb := '[]'::jsonb;
  plan_entry jsonb;
  available_quantity numeric;
  required_quantity numeric;
  locked_count integer := 0;
  deduction_source text;
begin
  -- This row lock serializes retries for the same order item. The database
  -- receipt below remains the final once-only authority.
  select item.* into target_item
  from public.order_items item
  where item.id = target_order_item_id
  for update;

  if target_item.id is null then
    raise exception 'Order item not found.';
  end if;
  if not public.has_staff_role(target_item.restaurant_id,
    array['owner','manager']::public.restaurant_staff_role[]) then
    raise exception 'Automatic inventory deduction access denied.';
  end if;

  if exists (
    select 1 from public.inventory_order_item_deductions consumed
    where consumed.order_item_id = target_item.id
  ) then
    return jsonb_build_object(
      'order_item_id', target_item.id,
      'deducted', false,
      'status', 'already_deducted'
    );
  end if;

  target_batch_key := case when target_item.appended_at is null then 'initial'
    else ((extract(epoch from target_item.appended_at) * 1000000)::bigint)::text end;

  if not public.should_deduct_inventory_for_service_completion(
    target_item.order_id,
    target_item.invoice_id,
    target_batch_key
  ) then
    return jsonb_build_object(
      'order_item_id', target_item.id,
      'deducted', false,
      'status', 'not_eligible'
    );
  end if;
  if target_item.kitchen_status <> 'completed' then
    return jsonb_build_object(
      'order_item_id', target_item.id,
      'deducted', false,
      'status', 'not_completed'
    );
  end if;

  -- Expand, convert, scale for recipe yield and ordered quantity, and aggregate
  -- the complete plan before taking any inventory write lock or applying stock.
  deduction_plan := public.build_inventory_deduction_plan(target_item.id);
  if jsonb_array_length(deduction_plan) = 0 then
    return jsonb_build_object(
      'order_item_id', target_item.id,
      'deducted', false,
      'status', 'no_deduction_source'
    );
  end if;

  -- Lock every affected inventory master row in a stable order before reading
  -- authoritative ledger balances. Competing deductions therefore serialize.
  for plan_entry in
    select to_jsonb(locked_inventory)
    from public.inventory_items locked_inventory
    where locked_inventory.restaurant_id = target_item.restaurant_id
      and locked_inventory.id in (
        select (entry->>'inventory_item_id')::uuid
        from jsonb_array_elements(deduction_plan) entry
      )
    order by locked_inventory.id
    for update
  loop
    locked_count := locked_count + 1;
  end loop;

  if locked_count <> jsonb_array_length(deduction_plan) then
    raise exception 'Inventory deduction plan contains an invalid inventory item.';
  end if;

  -- Validate the entire locked plan through the Phase 8.2 balance helper.
  -- No movement is inserted until every entry has passed this loop.
  for plan_entry in
    select entry from jsonb_array_elements(deduction_plan) entry
    order by entry->>'inventory_item_id'
  loop
    required_quantity := (plan_entry->>'required_quantity')::numeric;
    if required_quantity <= 0 then
      raise exception 'Inventory deduction quantity must be greater than zero.';
    end if;

    available_quantity := public.get_inventory_storage_balance(
      target_item.restaurant_id,
      (plan_entry->>'inventory_item_id')::uuid,
      (plan_entry->>'storage_location_id')::uuid
    );
    if available_quantity < required_quantity then
      raise exception 'Movement would create negative stock.';
    end if;

    validated_plan := validated_plan || jsonb_build_array(
      plan_entry || jsonb_build_object(
        'available_quantity', available_quantity,
        'remaining_quantity', available_quantity - required_quantity
      )
    );
  end loop;

  actor_id := public.inventory_admin_actor(target_item.restaurant_id);
  if actor_id is null then
    raise exception 'Automatic inventory deduction actor is invalid.';
  end if;
  deduction_source := validated_plan->0->>'source';

  insert into public.inventory_order_item_deductions(
    order_item_id, restaurant_id, order_id, menu_item_id, deduction_source,
    order_quantity, deduction_plan, deducted_by_staff_id
  ) values (
    target_item.id, target_item.restaurant_id, target_item.order_id,
    target_item.menu_item_id, deduction_source, target_item.quantity,
    validated_plan, actor_id
  )
  on conflict (order_item_id) do nothing;

  if not found then
    return jsonb_build_object(
      'order_item_id', target_item.id,
      'deducted', false,
      'status', 'already_deducted'
    );
  end if;

  -- This set-based insert is the only apply step. The existing immutable
  -- movement validation trigger rechecks tenant, unit, storage, actor, and the
  -- existing negative-stock policy. Any failure rolls back this insert and the
  -- once-only receipt above as one PostgreSQL transaction.
  insert into public.inventory_movements(
    restaurant_id, inventory_item_id, storage_location_id, unit_id, unit_name,
    movement_type, quantity, quantity_effect, reference_number, reason,
    source_system, source_record_id, source_payload, movement_date,
    created_by_staff_id, metadata
  )
  select
    target_item.restaurant_id,
    (entry->>'inventory_item_id')::uuid,
    (entry->>'storage_location_id')::uuid,
    (entry->>'unit_id')::uuid,
    entry->>'unit_name',
    'stock_out'::public.inventory_movement_type,
    (entry->>'required_quantity')::numeric,
    'out',
    'order-item:' || target_item.id::text,
    'Automatic order item deduction',
    'automatic_order_item_deduction',
    target_item.id,
    jsonb_build_object(
      'order_id', target_item.order_id,
      'order_item_id', target_item.id,
      'menu_item_id', target_item.menu_item_id,
      'order_quantity', target_item.quantity,
      'deduction_source', deduction_source
    ),
    clock_timestamp(),
    actor_id,
    entry
  from jsonb_array_elements(validated_plan) entry
  order by entry->>'inventory_item_id';

  return jsonb_build_object(
    'order_item_id', target_item.id,
    'deducted', true,
    'status', 'deducted',
    'deduction_source', deduction_source,
    'movement_count', jsonb_array_length(validated_plan),
    'plan', validated_plan
  );
end;
$$;

create or replace function public.deduct_inventory_for_service_completion(
  target_order_id uuid,
  target_invoice_id uuid default null,
  target_batch_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  target_item record;
  item_result jsonb;
  results jsonb := '[]'::jsonb;
begin
  select orders.* into target_order
  from public.orders orders
  where orders.id = target_order_id;

  if target_order.id is null then
    raise exception 'Dining session not found.';
  end if;
  if not public.has_staff_role(target_order.restaurant_id,
    array['owner','manager']::public.restaurant_staff_role[]) then
    raise exception 'Automatic inventory deduction access denied.';
  end if;
  if not public.should_deduct_inventory_for_service_completion(
    target_order.id, target_invoice_id, target_batch_key
  ) then
    return jsonb_build_object('deducted', false, 'status', 'not_eligible', 'items', results);
  end if;

  for target_item in
    select item.id
    from public.order_items item
    where item.order_id = target_order.id
      and item.restaurant_id = target_order.restaurant_id
      and item.kitchen_status = 'completed'
      and (target_invoice_id is null or item.invoice_id = target_invoice_id)
      and (
        target_batch_key is null
        or coalesce(
          case when item.appended_at is null then 'initial'
            else ((extract(epoch from item.appended_at) * 1000000)::bigint)::text end,
          'initial'
        ) = coalesce(nullif(btrim(target_batch_key), ''), 'initial')
      )
    order by item.id
  loop
    item_result := public.deduct_inventory_for_order_item(target_item.id);
    results := results || jsonb_build_array(item_result);
  end loop;

  return jsonb_build_object('deducted', true, 'status', 'processed', 'items', results);
end;
$$;

revoke all on function public.build_inventory_deduction_plan(uuid) from public, anon, authenticated;
revoke all on function public.deduct_inventory_for_order_item(uuid) from public, anon;
revoke all on function public.deduct_inventory_for_service_completion(uuid, uuid, text) from public, anon;
grant execute on function public.deduct_inventory_for_order_item(uuid),
  public.deduct_inventory_for_service_completion(uuid, uuid, text)
  to authenticated;

comment on table public.inventory_order_item_deductions is
  'Database-enforced once-only receipt for atomic order-item inventory deduction.';
comment on function public.build_inventory_deduction_plan(uuid) is
  'Internal complete-plan builder. Reuses recipe ingredients and the Phase 8.3.3 unit conversion engine.';
comment on function public.deduct_inventory_for_order_item(uuid) is
  'Atomically plans, locks, validates, and deducts inventory exactly once for one completed order item.';
comment on function public.deduct_inventory_for_service_completion(uuid,uuid,text) is
  'Atomic service-completion adapter for all completed order items in the requested invoice or batch.';
