-- ServeFlow Phase 8.4.3: inventory movement and audit engine.
-- Audit-only extension of the immutable Phase 8.2 movement ledger. The Phase
-- 8.4.2 deduction function is intentionally unchanged. Automatic movement
-- enrichment runs in the deduction INSERT and therefore in the same transaction.

alter table public.inventory_movements
  add column if not exists audit_movement_type text,
  add column if not exists menu_item_id uuid,
  add column if not exists recipe_id uuid,
  add column if not exists order_id uuid,
  add column if not exists order_item_id uuid,
  add column if not exists dining_session_id uuid,
  add column if not exists kitchen_batch_id text,
  add column if not exists waiter_id uuid,
  add column if not exists cashier_id uuid,
  add column if not exists kitchen_station_id uuid,
  add column if not exists performed_by_staff_id uuid,
  add column if not exists quantity_before numeric(12,3),
  add column if not exists quantity_after numeric(12,3),
  add column if not exists workflow_snapshot jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_food_consumption_type_check') then
    alter table public.inventory_movements add constraint inventory_movements_food_consumption_type_check
      check (audit_movement_type is null or audit_movement_type = 'FOOD_CONSUMPTION');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_food_consumption_complete_check') then
    alter table public.inventory_movements add constraint inventory_movements_food_consumption_complete_check
      check (
        source_system <> 'automatic_order_item_deduction'
        or (
          audit_movement_type = 'FOOD_CONSUMPTION'
          and menu_item_id is not null
          and order_id is not null
          and order_item_id is not null
          and dining_session_id is not null
          and kitchen_batch_id is not null
          and performed_by_staff_id is not null
          and quantity_before is not null
          and quantity_after is not null
          and workflow_snapshot is not null
        )
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_menu_item_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_menu_item_fk
      foreign key (restaurant_id, menu_item_id)
      references public.menu_items(restaurant_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_recipe_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_recipe_fk
      foreign key (restaurant_id, recipe_id)
      references public.recipes(restaurant_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_order_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_order_fk
      foreign key (restaurant_id, order_id)
      references public.orders(restaurant_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_order_item_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_order_item_fk
      foreign key (restaurant_id, order_item_id)
      references public.order_items(restaurant_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_dining_session_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_dining_session_fk
      foreign key (restaurant_id, dining_session_id)
      references public.orders(restaurant_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_waiter_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_waiter_fk
      foreign key (restaurant_id, waiter_id)
      references public.restaurant_staff(restaurant_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_cashier_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_cashier_fk
      foreign key (restaurant_id, cashier_id)
      references public.restaurant_staff(restaurant_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_station_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_station_fk
      foreign key (restaurant_id, kitchen_station_id)
      references public.kitchen_stations(restaurant_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_audit_performed_by_fk') then
    alter table public.inventory_movements add constraint inventory_movements_audit_performed_by_fk
      foreign key (restaurant_id, performed_by_staff_id)
      references public.restaurant_staff(restaurant_id, id) on delete restrict;
  end if;
end $$;

create index if not exists inventory_movements_food_consumption_history_idx
  on public.inventory_movements(restaurant_id, created_at desc, id desc)
  where audit_movement_type = 'FOOD_CONSUMPTION';
create index if not exists inventory_movements_food_consumption_order_idx
  on public.inventory_movements(restaurant_id, order_id, order_item_id)
  where audit_movement_type = 'FOOD_CONSUMPTION';
create index if not exists inventory_movements_food_consumption_filters_idx
  on public.inventory_movements(restaurant_id, inventory_item_id, menu_item_id, recipe_id, kitchen_station_id)
  where audit_movement_type = 'FOOD_CONSUMPTION';

create or replace function public.inventory_food_consumption_audit_row()
returns trigger
language plpgsql
set search_path = public
as $$
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
    menu.recipe_id,
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
  join public.menu_items menu
    on menu.id = deduction.menu_item_id
   and menu.restaurant_id = deduction.restaurant_id
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
  new.recipe_id := coalesce(nullif(plan_entry->>'recipe_id', '')::uuid, origin.recipe_id);
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
$$;

drop trigger if exists inventory_movements_food_consumption_audit on public.inventory_movements;
create trigger inventory_movements_food_consumption_audit
  before insert on public.inventory_movements
  for each row execute function public.inventory_food_consumption_audit_row();

create or replace function public.get_inventory_movement_history(
  target_restaurant_id uuid,
  search_text text default null,
  date_from timestamptz default null,
  date_to timestamptz default null,
  target_inventory_item_id uuid default null,
  target_menu_item_id uuid default null,
  target_recipe_id uuid default null,
  target_kitchen_station_id uuid default null,
  target_movement_type text default null,
  result_limit integer default 500
)
returns table(
  id uuid,
  restaurant_id uuid,
  inventory_item_id uuid,
  inventory_item_name text,
  menu_item_id uuid,
  menu_item_name text,
  recipe_id uuid,
  recipe_name text,
  order_id uuid,
  order_number text,
  order_item_id uuid,
  dining_session_id uuid,
  dining_session_number text,
  kitchen_batch_id text,
  waiter_id uuid,
  waiter_name text,
  cashier_id uuid,
  cashier_name text,
  kitchen_station_id uuid,
  kitchen_station_name text,
  performed_by_staff_id uuid,
  performed_by_name text,
  movement_type text,
  quantity numeric,
  unit text,
  quantity_before numeric,
  quantity_after numeric,
  created_at timestamptz,
  workflow_snapshot jsonb,
  notes text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_role(target_restaurant_id,
    array['owner','manager','inventory_officer']::public.restaurant_staff_role[]) then
    raise exception 'Inventory movement history access denied.';
  end if;
  if result_limit not between 1 and 1000 then
    raise exception 'Inventory movement history limit is invalid.';
  end if;
  if nullif(upper(btrim(coalesce(target_movement_type, ''))), '') is not null
    and upper(btrim(target_movement_type)) <> 'FOOD_CONSUMPTION'
  then
    raise exception 'Inventory movement type is invalid.';
  end if;

  return query
  select
    movement.id,
    movement.restaurant_id,
    movement.inventory_item_id,
    inventory.name,
    movement.menu_item_id,
    menu.name,
    movement.recipe_id,
    recipe.name,
    movement.order_id,
    coalesce(dining_session.display_number, dining_session.id::text),
    movement.order_item_id,
    movement.dining_session_id,
    coalesce(dining_session.dining_session_display_number, dining_session.display_number, dining_session.id::text),
    movement.kitchen_batch_id,
    movement.waiter_id,
    coalesce(waiter.display_name, waiter.email, waiter.role::text),
    movement.cashier_id,
    coalesce(cashier.display_name, cashier.email, cashier.role::text),
    movement.kitchen_station_id,
    station.name,
    movement.performed_by_staff_id,
    coalesce(performer.display_name, performer.email, performer.role::text),
    movement.audit_movement_type,
    movement.quantity,
    movement.unit_name,
    movement.quantity_before,
    movement.quantity_after,
    movement.created_at,
    movement.workflow_snapshot,
    movement.notes
  from public.inventory_movements movement
  join public.inventory_items inventory
    on inventory.id = movement.inventory_item_id
   and inventory.restaurant_id = movement.restaurant_id
  join public.orders dining_session
    on dining_session.id = movement.order_id
   and dining_session.restaurant_id = movement.restaurant_id
  join public.menu_items menu
    on menu.id = movement.menu_item_id
   and menu.restaurant_id = movement.restaurant_id
  left join public.recipes recipe
    on recipe.id = movement.recipe_id
   and recipe.restaurant_id = movement.restaurant_id
  left join public.kitchen_stations station
    on station.id = movement.kitchen_station_id
   and station.restaurant_id = movement.restaurant_id
  left join public.restaurant_staff waiter
    on waiter.id = movement.waiter_id
   and waiter.restaurant_id = movement.restaurant_id
  left join public.restaurant_staff cashier
    on cashier.id = movement.cashier_id
   and cashier.restaurant_id = movement.restaurant_id
  left join public.restaurant_staff performer
    on performer.id = movement.performed_by_staff_id
   and performer.restaurant_id = movement.restaurant_id
  where movement.restaurant_id = target_restaurant_id
    and movement.audit_movement_type = 'FOOD_CONSUMPTION'
    and (date_from is null or movement.created_at >= date_from)
    and (date_to is null or movement.created_at < date_to)
    and (target_inventory_item_id is null or movement.inventory_item_id = target_inventory_item_id)
    and (target_menu_item_id is null or movement.menu_item_id = target_menu_item_id)
    and (target_recipe_id is null or movement.recipe_id = target_recipe_id)
    and (target_kitchen_station_id is null or movement.kitchen_station_id = target_kitchen_station_id)
    and (
      nullif(btrim(coalesce(search_text, '')), '') is null
      or inventory.name ilike '%' || btrim(search_text) || '%'
      or menu.name ilike '%' || btrim(search_text) || '%'
      or recipe.name ilike '%' || btrim(search_text) || '%'
      or station.name ilike '%' || btrim(search_text) || '%'
      or dining_session.display_number ilike '%' || btrim(search_text) || '%'
      or dining_session.dining_session_display_number ilike '%' || btrim(search_text) || '%'
    )
  order by movement.created_at desc, movement.id desc
  limit result_limit;
end;
$$;

revoke all on function public.inventory_food_consumption_audit_row() from public, anon, authenticated;
revoke all on function public.get_inventory_movement_history(uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text,integer)
  from public, anon;
grant execute on function public.get_inventory_movement_history(uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text,integer)
  to authenticated;

comment on column public.inventory_movements.audit_movement_type is
  'Phase 8.4.3 audit classification. This phase permits only FOOD_CONSUMPTION.';
comment on function public.inventory_food_consumption_audit_row() is
  'Enriches and validates each automatic deduction movement in the deduction transaction.';
comment on function public.get_inventory_movement_history(uuid,text,timestamptz,timestamptz,uuid,uuid,uuid,uuid,text,integer) is
  'Read-only tenant-scoped FOOD_CONSUMPTION history for owner, manager, and inventory officer roles.';
