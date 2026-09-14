-- PREPARED ONLY. Validate under BEGIN / ROLLBACK; deployment needs authorization.
-- Freeze actual order-time deductions; never infer historical tracking from Menu.
-- Canonical payment, routing, eligibility, stock locks and receipt uniqueness stay.

BEGIN;

-- Fail closed if the effective engine has drifted since this design was traced.
-- These are function-definition fingerprints, not business-data fingerprints.
do $$
declare expected record;
begin
  for expected in select * from (values
    ('public.build_inventory_deduction_plan(uuid)', '52b35f2d21523520beb4b82f3d5d3cbc'),
    ('public.deduct_inventory_for_order_item(uuid)', '246d17b800b86e36305163a1d4435581'),
    ('public.inventory_food_consumption_audit_row()', 'e5630a72e7bae5c8e44f59e3c660fa8e'),
    ('public.inventory_movement_validate_row()', 'b60de0d3ee37e2855bf5336009b52064'),
    ('public.split_waiter_bill_quantities(uuid,jsonb)', '36619086d2d84ec0094ea2be8eda2d43')
  ) fingerprints(signature, fingerprint)
  loop
    if md5(pg_get_functiondef(to_regprocedure(expected.signature))) is distinct from expected.fingerprint then
      raise exception 'Effective inventory/billing function drifted: %. Re-audit before applying 263.', expected.signature;
    end if;
  end loop;
end;
$$;

-- Fence in-flight writers before classifying legacy rows and installing capture.
lock table public.order_items in access exclusive mode;

create table public.order_item_inventory_basis (
  order_item_id uuid primary key,
  restaurant_id uuid not null,
  order_id uuid not null,
  menu_item_id uuid not null,
  order_quantity integer not null check (order_quantity > 0),
  tracking_mode text not null check (tracking_mode in
    ('recipe', 'direct', 'no_tracking', 'legacy_review', 'legacy_receipt')),
  snapshot_version integer not null,
  recipe_id uuid,
  deduction_plan jsonb not null,
  captured_at timestamptz,
  captured_transaction xid8 not null default pg_current_xact_id(),
  split_parent_order_item_id uuid,
  split_from_quantity integer,
  accounted_by_order_item_id uuid references public.inventory_order_item_deductions(order_item_id) on delete restrict,
  unique (restaurant_id, order_item_id),
  check (jsonb_typeof(deduction_plan) = 'array'),
  check (
    (tracking_mode in ('recipe', 'direct') and snapshot_version = 1
      and captured_at is not null and jsonb_array_length(deduction_plan) > 0)
    or (tracking_mode = 'no_tracking' and snapshot_version = 1
      and captured_at is not null and deduction_plan = '[]'::jsonb)
    or (tracking_mode in ('legacy_review', 'legacy_receipt') and snapshot_version = 0
      and captured_at is null and deduction_plan = '[]'::jsonb)
  ),
  check ((tracking_mode = 'recipe') = (recipe_id is not null)),
  foreign key (restaurant_id, order_item_id) references public.order_items(restaurant_id, id)
    on delete restrict deferrable initially deferred,
  foreign key (restaurant_id, order_id) references public.orders(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, menu_item_id) references public.menu_items(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, recipe_id) references public.recipes(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, split_parent_order_item_id) references public.order_items(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, accounted_by_order_item_id) references public.order_items(restaurant_id, id) on delete restrict
);

-- Typed references retain source identities against deletion and enforce tenant
-- relationships independently of JSON. These are basis lines, NOT stock writes.
create table public.order_item_inventory_basis_lines (
  restaurant_id uuid not null,
  order_item_id uuid not null,
  inventory_item_id uuid not null,
  storage_location_id uuid not null,
  unit_id uuid not null,
  required_quantity numeric not null check (required_quantity > 0),
  primary key (order_item_id, inventory_item_id),
  foreign key (restaurant_id, order_item_id)
    references public.order_item_inventory_basis(restaurant_id, order_item_id) on delete restrict,
  foreign key (restaurant_id, inventory_item_id) references public.inventory_items(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, storage_location_id) references public.inventory_storage_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, unit_id) references public.inventory_units(restaurant_id, id) on delete restrict
);
create index order_item_inventory_basis_review_idx
  on public.order_item_inventory_basis(restaurant_id, order_id) where tracking_mode = 'legacy_review';
create index order_item_inventory_basis_split_parent_idx
  on public.order_item_inventory_basis(split_parent_order_item_id) where split_parent_order_item_id is not null;

alter table public.order_item_inventory_basis enable row level security;
alter table public.order_item_inventory_basis_lines enable row level security;
revoke all on public.order_item_inventory_basis, public.order_item_inventory_basis_lines
  from public, anon, authenticated, service_role;

-- Explicit classification only: no current-source backfill and no stock writes.
insert into public.order_item_inventory_basis (
  order_item_id, restaurant_id, order_id, menu_item_id, order_quantity,
  tracking_mode, snapshot_version, deduction_plan, captured_at
)
select item.id, item.restaurant_id, item.order_id, item.menu_item_id, item.quantity,
  case when exists (select 1 from public.inventory_order_item_deductions receipt
    where receipt.order_item_id = item.id and receipt.restaurant_id = item.restaurant_id)
    then 'legacy_receipt' else 'legacy_review' end,
  0, '[]'::jsonb, null
from public.order_items item;

-- Reuse the validated Phase 8.4.2 expansion ONLY at creation time. This helper
-- is private; it is never a fallback for historical undeducted order items.
CREATE OR REPLACE FUNCTION public.build_order_time_inventory_plan(target_order_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

create or replace function public.capture_order_item_inventory_basis()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  frozen_plan jsonb;
  mode_value text;
  recipe_value uuid;
  prepared public.order_item_inventory_basis;
begin
  -- Canonical bill splitting prepares a private derivative BEFORE inserting
  -- its order item. Clients have no write access to this trusted context.
  select * into prepared from public.order_item_inventory_basis where order_item_id = new.id;
  if prepared.order_item_id is not null then
    if prepared.restaurant_id <> new.restaurant_id or prepared.order_id <> new.order_id
      or prepared.menu_item_id <> new.menu_item_id or prepared.order_quantity <> new.quantity
      or prepared.captured_transaction <> pg_current_xact_id()
      or prepared.split_parent_order_item_id is null then
      raise exception 'Prepared split inventory basis does not match its order item.';
    end if;
    if not exists (select 1 from public.order_items parent
      where parent.id = prepared.split_parent_order_item_id
        and parent.restaurant_id = prepared.restaurant_id
        and parent.quantity = prepared.split_from_quantity - prepared.order_quantity) then
      raise exception 'Frozen split allocation does not conserve sold quantity.';
    end if;
    return null;
  end if;
  frozen_plan := public.build_order_time_inventory_plan(new.id);
  mode_value := case when frozen_plan = '[]'::jsonb then 'no_tracking'
    else frozen_plan->0->>'source' end;
  recipe_value := nullif(frozen_plan->0->>'recipe_id', '')::uuid;
  insert into public.order_item_inventory_basis (
    order_item_id, restaurant_id, order_id, menu_item_id, order_quantity,
    tracking_mode, snapshot_version, recipe_id, deduction_plan, captured_at
  ) values (new.id, new.restaurant_id, new.order_id, new.menu_item_id, new.quantity,
    mode_value, 1, recipe_value, frozen_plan, clock_timestamp());
  insert into public.order_item_inventory_basis_lines (
    restaurant_id, order_item_id, inventory_item_id, storage_location_id, unit_id, required_quantity
  ) select new.restaurant_id, new.id, (entry->>'inventory_item_id')::uuid,
      (entry->>'storage_location_id')::uuid, (entry->>'unit_id')::uuid,
      (entry->>'required_quantity')::numeric
    from jsonb_array_elements(frozen_plan) entry;
  return null;
end;
$$;
create trigger order_items_capture_inventory_basis
  after insert on public.order_items for each row
  execute function public.capture_order_item_inventory_basis();

create or replace function public.reject_inventory_basis_mutation()
returns trigger language plpgsql set search_path = public
as $$ begin raise exception 'Order-time inventory deduction basis is immutable.'; end; $$;
create trigger inventory_basis_immutable before update or delete on public.order_item_inventory_basis
  for each row execute function public.reject_inventory_basis_mutation();
create trigger inventory_basis_lines_immutable before update or delete on public.order_item_inventory_basis_lines
  for each row execute function public.reject_inventory_basis_mutation();

-- Invoice reassignment, dining-session merges and lifecycle changes remain
-- permitted. Quantity changes require a server-prepared split allocation.
create or replace function public.protect_order_item_inventory_identity()
returns trigger language plpgsql set search_path = public
as $$
begin
  if (new.id, new.restaurant_id, new.menu_item_id)
    is distinct from (old.id, old.restaurant_id, old.menu_item_id) then
    raise exception 'Order-time inventory item identity is immutable.';
  end if;
  if new.quantity is distinct from old.quantity and not exists (
    select 1 from public.order_item_inventory_basis child
    where child.split_parent_order_item_id = old.id
      and child.restaurant_id = old.restaurant_id
      and child.split_from_quantity = old.quantity
      and child.order_quantity = old.quantity - new.quantity
      and child.captured_transaction = pg_current_xact_id()
      and not exists (select 1 from public.order_items inserted where inserted.id = child.order_item_id)
  ) then
    raise exception 'Order-time inventory quantity requires an authorized frozen split allocation.';
  end if;
  return new;
end;
$$;
create trigger order_items_protect_inventory_identity
  before update of id, restaurant_id, menu_item_id, quantity on public.order_items
  for each row execute function public.protect_order_item_inventory_identity();

create or replace function public.build_inventory_deduction_plan(target_order_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  basis public.order_item_inventory_basis;
  receipt_plan jsonb;
  remaining_plan jsonb;
begin
  select * into basis from public.order_item_inventory_basis where order_item_id = target_order_item_id;
  if basis.order_item_id is null then
    raise exception 'Order item lacks an immutable deduction basis; review required.';
  end if;
  if basis.tracking_mode = 'legacy_review' then
    raise exception 'Legacy order item has ambiguous inventory history; manual review required.';
  end if;
  if basis.tracking_mode = 'legacy_receipt' then
    select deduction_plan into receipt_plan from public.inventory_order_item_deductions
      where order_item_id = basis.order_item_id and restaurant_id = basis.restaurant_id;
    if receipt_plan is null then raise exception 'Legacy deduction receipt is missing; review required.'; end if;
    return receipt_plan;
  end if;
  if (select count(*) from public.order_item_inventory_basis_lines line
      where line.order_item_id = basis.order_item_id and line.restaurant_id = basis.restaurant_id)
      <> jsonb_array_length(basis.deduction_plan) then
    raise exception 'Frozen inventory basis is incomplete.';
  end if;
  -- Billing allocations partition the ORIGINAL rounded quantities, preserving
  -- their sum exactly. Neither parent nor child ever consults current Menu.
  select coalesce(jsonb_agg(entry || jsonb_build_object('required_quantity',
      (entry->>'required_quantity')::numeric - coalesce(allocated.quantity, 0))
      order by entry->>'inventory_item_id'), '[]'::jsonb)
    into remaining_plan
  from jsonb_array_elements(basis.deduction_plan) entry
  left join lateral (
    select sum((part->>'required_quantity')::numeric) quantity
    from public.order_item_inventory_basis child
    cross join lateral jsonb_array_elements(child.deduction_plan) part
    where child.split_parent_order_item_id = basis.order_item_id
      and child.restaurant_id = basis.restaurant_id
      and part->>'inventory_item_id' = entry->>'inventory_item_id'
  ) allocated on true;
  if exists (select 1 from jsonb_array_elements(remaining_plan) entry
      where (entry->>'required_quantity')::numeric <= 0) then
    raise exception 'Frozen split allocation has no positive remaining quantity.';
  end if;
  return remaining_plan;
end;
$$;


-- Private billing derivative. Quantities are allocated from immutable evidence,
-- never re-planned from current Menu. No receipt/history is rewritten.
create or replace function public.prepare_split_inventory_basis(
  source_item_id uuid, child_item_id uuid, child_quantity integer
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  source_item public.order_items;
  source_basis public.order_item_inventory_basis;
  source_plan jsonb;
  child_plan jsonb;
  source_mode text;
  source_recipe uuid;
  accounted_item uuid;
begin
  select * into source_item from public.order_items where id = source_item_id for update;
  select * into source_basis from public.order_item_inventory_basis where order_item_id = source_item_id;
  if source_basis.order_item_id is null or child_quantity <= 0 or child_quantity >= source_item.quantity then
    raise exception 'Invalid frozen inventory split source or quantity.';
  end if;
  if exists (select 1 from public.order_items where id = child_item_id) then
    raise exception 'Split derivative identity already exists.';
  end if;
  source_mode := source_basis.tracking_mode;
  source_recipe := source_basis.recipe_id;
  accounted_item := source_basis.accounted_by_order_item_id;
  if exists (select 1 from public.inventory_order_item_deductions receipt
    where receipt.order_item_id = source_item.id and receipt.restaurant_id = source_item.restaurant_id) then
    accounted_item := source_item.id;
  end if;
  if source_mode = 'legacy_review' then
    source_plan := '[]'::jsonb;
  else
    source_plan := public.build_inventory_deduction_plan(source_item.id);
  end if;
  if source_mode = 'legacy_receipt' then
    source_mode := source_plan->0->>'source';
    source_recipe := nullif(source_plan->0->>'recipe_id', '')::uuid;
  end if;
  select coalesce(jsonb_agg(entry || jsonb_build_object('required_quantity',
      round((entry->>'required_quantity')::numeric * child_quantity / source_item.quantity, 3))
      order by entry->>'inventory_item_id'), '[]'::jsonb)
    into child_plan from jsonb_array_elements(source_plan) entry;
  -- Reject an unrepresentable sub-mill split rather than lose or create stock.
  if exists (
    select 1 from jsonb_array_elements(child_plan) child
    join lateral jsonb_array_elements(source_plan) original
      on original->>'inventory_item_id' = child->>'inventory_item_id'
    where (child->>'required_quantity')::numeric <= 0
      or (child->>'required_quantity')::numeric >= (original->>'required_quantity')::numeric
  ) then raise exception 'Inventory split is below ledger quantity precision.'; end if;
  insert into public.order_item_inventory_basis (
    order_item_id, restaurant_id, order_id, menu_item_id, order_quantity,
    tracking_mode, snapshot_version, recipe_id, deduction_plan, captured_at,
    split_parent_order_item_id, split_from_quantity, accounted_by_order_item_id
  ) values (child_item_id, source_item.restaurant_id, source_item.order_id, source_item.menu_item_id, child_quantity,
    source_mode, case when source_mode = 'legacy_review' then 0 else 1 end,
    source_recipe, child_plan, case when source_mode = 'legacy_review' then null else clock_timestamp() end,
    source_item.id, source_item.quantity, accounted_item);
  insert into public.order_item_inventory_basis_lines (
    restaurant_id, order_item_id, inventory_item_id, storage_location_id, unit_id, required_quantity
  ) select source_item.restaurant_id, child_item_id, (entry->>'inventory_item_id')::uuid,
    (entry->>'storage_location_id')::uuid, (entry->>'unit_id')::uuid,
    (entry->>'required_quantity')::numeric from jsonb_array_elements(child_plan) entry;
end;
$$;
revoke all on function public.prepare_split_inventory_basis(uuid, uuid, integer)
  from public, anon, authenticated, service_role;

-- Existing bill authority/validation preserved; only frozen derivative creation changes.
CREATE OR REPLACE FUNCTION public.split_waiter_bill_quantities(target_order_id uuid, requested_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  session public.orders;
  waiter public.restaurant_staff;
  new_invoice public.order_invoices;
  line record;
  split_item_id uuid;
  requested_count integer;
  selected_units integer;
  unpaid_units integer;
  selected_total numeric(12, 2);
  next_invoice_number integer;
begin
  select * into session from public.orders orders where orders.id = target_order_id for update;
  select * into waiter from public.restaurant_staff staff
  where staff.restaurant_id = session.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;

  if waiter.id is null then raise exception 'Active waiter access required.'; end if;
  if session.dining_session_status <> 'open' then raise exception 'This dining session is closed.'; end if;
  if jsonb_typeof(requested_items) is distinct from 'array' or jsonb_array_length(requested_items) = 0 then
    raise exception 'Choose item quantities to split.';
  end if;

  select coalesce(sum(items.quantity), 0) into unpaid_units
  from public.order_items items
  join public.order_invoices invoices on invoices.id = items.invoice_id
  where items.order_id = session.id and invoices.status = 'pending' and invoices.verified_at is null;

  with requested as (
    select (value->>'item_id')::uuid item_id, (value->>'quantity')::integer quantity
    from jsonb_array_elements(requested_items)
  ), eligible as (
    select requested.item_id, requested.quantity, items.quantity available_quantity, items.price
    from requested
    join public.order_items items on items.id = requested.item_id and items.order_id = session.id
    join public.order_invoices invoices on invoices.id = items.invoice_id
    where invoices.status = 'pending'
      and invoices.verified_at is null
      and requested.quantity between 1 and items.quantity
  )
  select count(*), coalesce(sum(quantity), 0), coalesce(sum(quantity * price), 0)
  into requested_count, selected_units, selected_total
  from eligible;

  if requested_count <> jsonb_array_length(requested_items) then raise exception 'Split contains invalid or paid items.'; end if;
  if selected_units >= unpaid_units then raise exception 'At least one item must remain on the original bill.'; end if;

  select coalesce(max(invoice_number), 0) + 1 into next_invoice_number
  from public.order_invoices invoices where invoices.order_id = session.id;

  insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method)
  values (session.restaurant_id, session.id, next_invoice_number, 'pending', selected_total, session.payment_method)
  returning * into new_invoice;

  for line in
    select items.*, requested.quantity as split_quantity
    from (
      select (value->>'item_id')::uuid item_id, (value->>'quantity')::integer quantity
      from jsonb_array_elements(requested_items)
    ) requested
    join public.order_items items on items.id = requested.item_id
  loop
    if line.split_quantity = line.quantity then
      update public.order_items set invoice_id = new_invoice.id where id = line.id;
    else
      split_item_id := gen_random_uuid();
      perform public.prepare_split_inventory_basis(line.id, split_item_id, line.split_quantity);
      update public.order_items set quantity = line.quantity - line.split_quantity where id = line.id;
      insert into public.order_items (
        id, restaurant_id, order_id, menu_item_id, quantity, price, created_at, notes, appended_at,
        kitchen_station_id, kitchen_status, kitchen_preparation_started_at, kitchen_preparation_started_by,
        kitchen_ready_marked_at, kitchen_ready_marked_by, kitchen_completed_at, kitchen_completed_by, invoice_id
      ) values (
        split_item_id, line.restaurant_id, line.order_id, line.menu_item_id, line.split_quantity, line.price, line.created_at,
        line.notes, line.appended_at, line.kitchen_station_id, line.kitchen_status,
        line.kitchen_preparation_started_at, line.kitchen_preparation_started_by,
        line.kitchen_ready_marked_at, line.kitchen_ready_marked_by,
        line.kitchen_completed_at, line.kitchen_completed_by, new_invoice.id
      );
    end if;
  end loop;

  update public.order_invoices invoices
  set total_price = totals.total, updated_at = now()
  from (
    select items.invoice_id, sum(items.quantity * items.price)::numeric(12, 2) total
    from public.order_items items where items.order_id = session.id group by items.invoice_id
  ) totals
  where invoices.order_id = session.id and invoices.id = totals.invoice_id;

  delete from public.order_invoices invoices
  where invoices.order_id = session.id
    and invoices.id <> new_invoice.id
    and invoices.status = 'pending'
    and not exists (select 1 from public.order_items items where items.invoice_id = invoices.id);

  return jsonb_build_object(
    'order_id', session.id,
    'invoice_id', new_invoice.id,
    'invoice_number', new_invoice.invoice_number,
    'invoice_total', new_invoice.total_price,
    'units_moved', selected_units
  );
end;
$function$;

-- Existing lock, eligibility, balance, receipt and ledger machinery retained.
CREATE OR REPLACE FUNCTION public.deduct_inventory_for_order_item(target_order_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- A bill-only derivative of already-accounted food must not consume it again.
  if exists (select 1 from public.order_item_inventory_basis basis
    where basis.order_item_id = target_item.id and basis.restaurant_id = target_item.restaurant_id
      and basis.accounted_by_order_item_id is not null) then
    return jsonb_build_object('order_item_id', target_item.id, 'deducted', false,
      'status', 'already_deducted_inherited');
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
      'status', 'no_tracking'
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
$function$;

-- Audit provenance comes exclusively from the receipt plan, never current Menu.
CREATE OR REPLACE FUNCTION public.inventory_food_consumption_audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  origin record;
  plan_entry jsonb;
begin
  if new.source_system <> 'automatic_order_item_deduction' then
    return new;
  end if;
  if new.source_record_id is null
    or new.movement_type <> 'stock_out'::public.inventory_movement_type
    or new.quantity_effect <> 'out'
  then
    raise exception 'Food consumption movement source is invalid.';
  end if;

  select
    deduction.order_item_id,
    deduction.order_id,
    deduction.menu_item_id,
    deduction.deduction_plan,
    order_item.invoice_id,
    order_item.appended_at,
    order_item.kitchen_station_id,
    order_item.kitchen_completed_by,
    order_item.kitchen_status,
    dining_session.display_number order_number,
    dining_session.dining_session_display_number,
    dining_session.created_by_waiter_id,
    dining_session.order_source,
    dining_session.dining_session_status,
    dining_session.workflow_policy_snapshot,
    dining_session.workflow_version,
    invoice.payment_status,
    invoice.operational_status invoice_operational_status,
    coalesce(
      invoice.verified_by,
      invoice.paid_by,
      case when invoice.invoice_source = 'cashier' then invoice.created_by_staff_id end
    ) cashier_staff_id
  into origin
  from public.inventory_order_item_deductions deduction
  join public.order_items order_item
    on order_item.id = deduction.order_item_id
   and order_item.restaurant_id = deduction.restaurant_id
  join public.orders dining_session
    on dining_session.id = deduction.order_id
   and dining_session.restaurant_id = deduction.restaurant_id
  left join public.order_invoices invoice
    on invoice.id = order_item.invoice_id
   and invoice.restaurant_id = order_item.restaurant_id
  where deduction.order_item_id = new.source_record_id
    and deduction.restaurant_id = new.restaurant_id;

  if not found then
    raise exception 'Food consumption movement cannot be orphaned from its deduction.';
  end if;

  select entry into plan_entry
  from jsonb_array_elements(origin.deduction_plan) entry
  where (entry->>'inventory_item_id')::uuid = new.inventory_item_id;

  if plan_entry is null
    or (plan_entry->>'required_quantity')::numeric <> new.quantity
    or (plan_entry->>'storage_location_id')::uuid <> new.storage_location_id
    or (plan_entry->>'unit_id')::uuid <> new.unit_id
  then
    raise exception 'Food consumption movement does not match its deduction plan.';
  end if;

  new.audit_movement_type := 'FOOD_CONSUMPTION';
  new.menu_item_id := origin.menu_item_id;
  new.recipe_id := nullif(plan_entry->>'recipe_id', '')::uuid;
  new.order_id := origin.order_id;
  new.order_item_id := origin.order_item_id;
  new.dining_session_id := origin.order_id;
  new.kitchen_batch_id := case when origin.appended_at is null then 'initial'
    else ((extract(epoch from origin.appended_at) * 1000000)::bigint)::text end;
  new.waiter_id := origin.created_by_waiter_id;
  new.cashier_id := origin.cashier_staff_id;
  new.kitchen_station_id := origin.kitchen_station_id;
  new.performed_by_staff_id := coalesce(
    origin.kitchen_completed_by,
    origin.created_by_waiter_id,
    origin.cashier_staff_id,
    new.created_by_staff_id
  );
  new.quantity_before := (plan_entry->>'available_quantity')::numeric(12,3);
  new.quantity_after := (plan_entry->>'remaining_quantity')::numeric(12,3);
  new.workflow_snapshot := jsonb_build_object(
    'workflow_policy_snapshot', origin.workflow_policy_snapshot,
    'workflow_version', origin.workflow_version,
    'order_source', origin.order_source,
    'dining_session_status', origin.dining_session_status,
    'payment_status', origin.payment_status,
    'invoice_operational_status', origin.invoice_operational_status,
    'kitchen_status', origin.kitchen_status,
    'order_number', origin.order_number,
    'dining_session_number', origin.dining_session_display_number
  );
  new.notes := coalesce(new.notes, 'Automatic food consumption from completed order item.');
  return new;
end;
$function$;

-- Inactive-source exception requires a matching frozen plan and receipt.
CREATE OR REPLACE FUNCTION public.inventory_movement_validate_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  item_row public.inventory_items;
  unit_name_value text;
  expected_effect text;
  frozen_entry jsonb;
  frozen_automatic boolean := false;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Inventory movements are immutable.';
  end if;

  if not public.inventory_admin_has_access(new.restaurant_id) then
    raise exception 'Inventory movement access denied.';
  end if;

  if new.quantity is null or new.quantity <= 0 then
    raise exception 'Movement quantity must be greater than zero.';
  end if;

  expected_effect := public.inventory_movement_expected_effect(new.movement_type);
  if expected_effect is not null and new.quantity_effect <> expected_effect then
    raise exception 'Movement direction is invalid for this movement type.';
  end if;
  if expected_effect is null and new.quantity_effect not in ('in','out') then
    raise exception 'Movement direction is required.';
  end if;

  if new.movement_type in ('transfer_in','transfer_out') and new.transfer_group_id is null then
    raise exception 'Transfer movements require a transfer group.';
  end if;
  if new.movement_type not in ('transfer_in','transfer_out') and new.transfer_group_id is not null then
    raise exception 'Only transfer movements can use a transfer group.';
  end if;

  if not public.inventory_movement_requirements_met(new.movement_type, new.reason) then
    raise exception 'Movement reason is required.';
  end if;

  -- Only a frozen, matching plan AND once-only receipt can use an inactive
  -- source. Source_system alone never grants an exemption.
  if new.source_system = 'automatic_order_item_deduction' then
    select entry into frozen_entry
    from public.order_item_inventory_basis basis
    join public.inventory_order_item_deductions receipt
      on receipt.order_item_id = basis.order_item_id
     and receipt.restaurant_id = basis.restaurant_id
     and receipt.menu_item_id = basis.menu_item_id
    cross join lateral jsonb_array_elements(public.build_inventory_deduction_plan(basis.order_item_id)) entry
    where basis.order_item_id = new.source_record_id
      and basis.restaurant_id = new.restaurant_id
      and basis.tracking_mode in ('recipe', 'direct')
      and (entry->>'inventory_item_id')::uuid = new.inventory_item_id
      and (entry->>'storage_location_id')::uuid = new.storage_location_id
      and (entry->>'unit_id')::uuid = new.unit_id
      and (entry->>'required_quantity')::numeric = new.quantity;
    if frozen_entry is null then
      raise exception 'Automatic movement lacks a matching frozen deduction basis.';
    end if;
    frozen_automatic := true;
  end if;

  select * into item_row
  from public.inventory_items
  where id = new.inventory_item_id
    and restaurant_id = new.restaurant_id
    and (status = 'active' or frozen_automatic);
  if item_row.id is null then
    raise exception 'Inventory item is invalid.';
  end if;

  if not exists (
    select 1 from public.inventory_storage_locations l
    where l.id = new.storage_location_id
      and l.restaurant_id = new.restaurant_id
      and (l.status = 'active' or frozen_automatic)
  ) then
    raise exception 'Storage location is invalid.';
  end if;

  select u.name into unit_name_value
  from public.inventory_units u
  where u.id = new.unit_id
    and u.restaurant_id = new.restaurant_id
    and (u.status = 'active' or frozen_automatic);
  if unit_name_value is null or item_row.unit_id is distinct from new.unit_id then
    raise exception 'Movement unit is invalid.';
  end if;

  if new.supplier_id is not null and not exists (
    select 1 from public.inventory_suppliers s
    where s.id = new.supplier_id
      and s.restaurant_id = new.restaurant_id
      and s.status = 'active'
  ) then
    raise exception 'Supplier is invalid.';
  end if;

  if new.quantity_effect = 'out'
    and public.get_inventory_storage_balance(new.restaurant_id, new.inventory_item_id, new.storage_location_id) < new.quantity
  then
    raise exception 'Movement would create negative stock.';
  end if;

  if new.created_by_staff_id is null then
    new.created_by_staff_id := public.inventory_admin_actor(new.restaurant_id);
  end if;
  if new.created_by_staff_id is null or not exists (
    select 1 from public.restaurant_staff s
    where s.id = new.created_by_staff_id
      and s.restaurant_id = new.restaurant_id
      and s.active = true
      and s.role::text in ('owner', 'manager', 'inventory_officer')
  ) then
    raise exception 'Movement user is invalid.';
  end if;

  -- A changed inventory master base unit requires reconciliation, not silent
  -- application of incomparable quantities. The equality check above stays.
  new.unit_name := case when frozen_automatic then frozen_entry->>'unit_name' else unit_name_value end;
  new.reference_number := nullif(btrim(coalesce(new.reference_number, '')), '');
  new.invoice_number := nullif(btrim(coalesce(new.invoice_number, '')), '');
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.source_system := nullif(btrim(coalesce(new.source_system, '')), '');
  if new.source_system is null then
    new.source_system := 'manual';
  end if;
  new.source_payload := coalesce(new.source_payload, '{}'::jsonb);
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  new.created_at := now();
  return new;
end $function$;

revoke all on function public.build_order_time_inventory_plan(uuid),
  public.capture_order_item_inventory_basis(), public.reject_inventory_basis_mutation(),
  public.protect_order_item_inventory_identity(), public.build_inventory_deduction_plan(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.deduct_inventory_for_order_item(uuid) from public, anon;
grant execute on function public.deduct_inventory_for_order_item(uuid) to authenticated, service_role;
comment on table public.order_item_inventory_basis is
  'Immutable server-generated order-time inventory plan; explicit no_tracking or legacy review, never guessed history.';

COMMIT;
