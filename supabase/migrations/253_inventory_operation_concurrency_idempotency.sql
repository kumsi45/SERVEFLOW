-- Inventory V1 freeze: serialize ledger mutations per material and make the
-- manual Receive, Issue, Transfer, and Waste contracts retry-safe.

create table if not exists public.inventory_operation_idempotency (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  idempotency_key uuid not null,
  operation_type text not null check (operation_type in ('movement', 'transfer', 'waste')),
  request_fingerprint text not null,
  result_id uuid,
  created_by_staff_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, idempotency_key),
  constraint inventory_operation_idempotency_staff_restaurant_fk
    foreign key (restaurant_id, created_by_staff_id)
    references public.restaurant_staff(restaurant_id, id)
);

create index if not exists inventory_operation_idempotency_created_idx
  on public.inventory_operation_idempotency(restaurant_id, created_at desc);

alter table public.inventory_operation_idempotency enable row level security;
revoke all on public.inventory_operation_idempotency from public, anon, authenticated;

create or replace function public.inventory_movement_lock_item_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- All stock-changing paths converge on inventory_movements. Locking the
  -- material row here serializes balance checks across manual operations,
  -- Kitchen issue, purchase receipt, Adjustment, Waste, and Transfer.
  perform 1
  from public.inventory_items item
  where item.restaurant_id = new.restaurant_id
    and item.id = new.inventory_item_id
  for update;
  return new;
end;
$$;

drop trigger if exists inventory_movements_00_lock_item on public.inventory_movements;
create trigger inventory_movements_00_lock_item
  before insert on public.inventory_movements
  for each row execute function public.inventory_movement_lock_item_row();

revoke all on function public.inventory_movement_lock_item_row() from public, anon, authenticated;

create or replace function public.inventory_movement_sync_item_quantity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.inventory_items item
  set current_quantity = balance.quantity
  from (
    select inserted.restaurant_id, inserted.inventory_item_id,
      coalesce(sum(public.inventory_movement_signed_quantity(
        movement.quantity, movement.quantity_effect
      )), 0)::numeric(12,3) quantity
    from (select distinct restaurant_id, inventory_item_id from inserted_movements) inserted
    join public.inventory_movements movement
      on movement.restaurant_id = inserted.restaurant_id
     and movement.inventory_item_id = inserted.inventory_item_id
    group by inserted.restaurant_id, inserted.inventory_item_id
  ) balance
  where item.restaurant_id = balance.restaurant_id
    and item.id = balance.inventory_item_id;
  return null;
end;
$$;

drop trigger if exists inventory_movements_sync_item_quantity on public.inventory_movements;
create trigger inventory_movements_sync_item_quantity
  after insert on public.inventory_movements
  referencing new table as inserted_movements
  for each statement execute function public.inventory_movement_sync_item_quantity();

revoke all on function public.inventory_movement_sync_item_quantity() from public, anon, authenticated;

-- Reconcile only materials that already have authoritative ledger history.
update public.inventory_items item
set current_quantity = balance.quantity
from (
  select movement.restaurant_id, movement.inventory_item_id,
    coalesce(sum(public.inventory_movement_signed_quantity(
      movement.quantity, movement.quantity_effect
    )), 0)::numeric(12,3) quantity
  from public.inventory_movements movement
  group by movement.restaurant_id, movement.inventory_item_id
) balance
where item.restaurant_id = balance.restaurant_id
  and item.id = balance.inventory_item_id
  and item.current_quantity is distinct from balance.quantity;

create or replace function public.record_inventory_movement_v2(
  target_restaurant_id uuid,
  target_idempotency_key uuid,
  target_inventory_item_id uuid,
  target_storage_location_id uuid,
  target_movement_type public.inventory_movement_type,
  target_quantity numeric,
  target_quantity_effect text default null,
  target_supplier_id uuid default null,
  target_reference_number text default null,
  target_invoice_number text default null,
  target_reason text default null,
  target_notes text default null,
  target_movement_date timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  existing public.inventory_operation_idempotency;
  fingerprint text;
  movement_id uuid;
begin
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then raise exception 'Inventory movement access denied.'; end if;
  if target_idempotency_key is null then raise exception 'Inventory operation idempotency key is required.'; end if;

  fingerprint := md5(jsonb_build_array(
    target_inventory_item_id, target_storage_location_id, target_movement_type::text,
    target_quantity, target_quantity_effect, target_supplier_id, target_reference_number,
    target_invoice_number, target_reason, target_notes, target_movement_date
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(target_restaurant_id::text || ':' || target_idempotency_key::text, 0));

  select operation.* into existing
  from public.inventory_operation_idempotency operation
  where operation.restaurant_id = target_restaurant_id
    and operation.idempotency_key = target_idempotency_key;
  if found then
    if existing.operation_type <> 'movement' or existing.request_fingerprint <> fingerprint then
      raise exception 'Inventory idempotency key was already used for another operation.';
    end if;
    return jsonb_build_object('movement_id', existing.result_id, 'already_processed', true);
  end if;

  insert into public.inventory_operation_idempotency(
    restaurant_id, idempotency_key, operation_type, request_fingerprint, created_by_staff_id
  ) values (target_restaurant_id, target_idempotency_key, 'movement', fingerprint, actor_id);

  movement_id := public.record_inventory_movement(
    target_restaurant_id, target_inventory_item_id, target_storage_location_id,
    target_movement_type, target_quantity, target_quantity_effect, target_supplier_id,
    target_reference_number, target_invoice_number, target_reason, target_notes,
    target_movement_date
  );
  update public.inventory_operation_idempotency
  set result_id = movement_id
  where restaurant_id = target_restaurant_id and idempotency_key = target_idempotency_key;
  return jsonb_build_object('movement_id', movement_id, 'already_processed', false);
end;
$$;

create or replace function public.record_inventory_transfer_v2(
  target_restaurant_id uuid,
  target_idempotency_key uuid,
  target_inventory_item_id uuid,
  target_from_storage_location_id uuid,
  target_to_storage_location_id uuid,
  target_quantity numeric,
  target_reference_number text default null,
  target_reason text default null,
  target_notes text default null,
  target_movement_date timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  existing public.inventory_operation_idempotency;
  fingerprint text;
  transfer_group_id uuid;
begin
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then raise exception 'Inventory transfer access denied.'; end if;
  if target_idempotency_key is null then raise exception 'Inventory operation idempotency key is required.'; end if;
  fingerprint := md5(jsonb_build_array(
    target_inventory_item_id, target_from_storage_location_id, target_to_storage_location_id,
    target_quantity, target_reference_number, target_reason, target_notes, target_movement_date
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(target_restaurant_id::text || ':' || target_idempotency_key::text, 0));
  select operation.* into existing from public.inventory_operation_idempotency operation
  where operation.restaurant_id = target_restaurant_id and operation.idempotency_key = target_idempotency_key;
  if found then
    if existing.operation_type <> 'transfer' or existing.request_fingerprint <> fingerprint then
      raise exception 'Inventory idempotency key was already used for another operation.';
    end if;
    return jsonb_build_object('transfer_group_id', existing.result_id, 'already_processed', true);
  end if;
  insert into public.inventory_operation_idempotency(
    restaurant_id, idempotency_key, operation_type, request_fingerprint, created_by_staff_id
  ) values (target_restaurant_id, target_idempotency_key, 'transfer', fingerprint, actor_id);
  transfer_group_id := public.record_inventory_transfer(
    target_restaurant_id, target_inventory_item_id, target_from_storage_location_id,
    target_to_storage_location_id, target_quantity, target_reference_number,
    target_reason, target_notes, target_movement_date
  );
  update public.inventory_operation_idempotency set result_id = transfer_group_id
  where restaurant_id = target_restaurant_id and idempotency_key = target_idempotency_key;
  return jsonb_build_object('transfer_group_id', transfer_group_id, 'already_processed', false);
end;
$$;

create or replace function public.record_inventory_waste_v2(
  target_restaurant_id uuid,
  target_idempotency_key uuid,
  target_inventory_item_id uuid,
  target_storage_location_id uuid,
  target_quantity numeric,
  target_reason text,
  target_is_spoilage boolean default false,
  target_notes text default null,
  target_movement_date timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  existing public.inventory_operation_idempotency;
  fingerprint text;
  movement_id uuid;
begin
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then raise exception 'Inventory waste access denied.'; end if;
  if target_idempotency_key is null then raise exception 'Inventory operation idempotency key is required.'; end if;
  fingerprint := md5(jsonb_build_array(
    target_inventory_item_id, target_storage_location_id, target_quantity,
    target_reason, target_is_spoilage, target_notes, target_movement_date
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(target_restaurant_id::text || ':' || target_idempotency_key::text, 0));
  select operation.* into existing from public.inventory_operation_idempotency operation
  where operation.restaurant_id = target_restaurant_id and operation.idempotency_key = target_idempotency_key;
  if found then
    if existing.operation_type <> 'waste' or existing.request_fingerprint <> fingerprint then
      raise exception 'Inventory idempotency key was already used for another operation.';
    end if;
    return jsonb_build_object('movement_id', existing.result_id, 'already_processed', true);
  end if;
  insert into public.inventory_operation_idempotency(
    restaurant_id, idempotency_key, operation_type, request_fingerprint, created_by_staff_id
  ) values (target_restaurant_id, target_idempotency_key, 'waste', fingerprint, actor_id);
  movement_id := public.record_inventory_waste(
    target_restaurant_id, target_inventory_item_id, target_storage_location_id,
    target_quantity, target_reason, target_is_spoilage, target_notes, target_movement_date
  );
  update public.inventory_operation_idempotency set result_id = movement_id
  where restaurant_id = target_restaurant_id and idempotency_key = target_idempotency_key;
  return jsonb_build_object('movement_id', movement_id, 'already_processed', false);
end;
$$;

create or replace function public.record_inventory_opening_balance(
  target_restaurant_id uuid,
  target_inventory_item_id uuid,
  target_storage_location_id uuid,
  target_quantity numeric,
  target_reference_number text default null,
  target_notes text default null,
  target_movement_date timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
begin
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then raise exception 'Opening balance access denied.'; end if;

  perform 1 from public.inventory_items item
  where item.restaurant_id = target_restaurant_id and item.id = target_inventory_item_id
  for update;
  if not found then raise exception 'Inventory item is invalid.'; end if;

  if exists (
    select 1 from public.inventory_movements movement
    where movement.restaurant_id = target_restaurant_id
      and movement.inventory_item_id = target_inventory_item_id
      and movement.storage_location_id = target_storage_location_id
  ) then
    raise exception 'Opening balance can only be recorded before other movements.';
  end if;

  return public.record_inventory_movement(
    target_restaurant_id, target_inventory_item_id, target_storage_location_id,
    'opening_balance', target_quantity, null, null, target_reference_number,
    null, null, target_notes, target_movement_date
  );
end;
$$;

-- Direct access to legacy non-idempotent mutation contracts is closed. They
-- remain callable by SECURITY DEFINER workflow functions owned by postgres.
revoke all on function public.record_inventory_movement(uuid,uuid,uuid,public.inventory_movement_type,numeric,text,uuid,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.record_inventory_transfer(uuid,uuid,uuid,uuid,numeric,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.record_inventory_waste(uuid,uuid,uuid,numeric,text,boolean,text,timestamptz) from public, anon, authenticated;
revoke all on function public.record_inventory_adjustment(uuid,uuid,uuid,numeric,text,text,text,timestamptz) from public, anon, authenticated;

revoke all on function public.record_inventory_movement_v2(uuid,uuid,uuid,uuid,public.inventory_movement_type,numeric,text,uuid,text,text,text,text,timestamptz) from public, anon;
revoke all on function public.record_inventory_transfer_v2(uuid,uuid,uuid,uuid,uuid,numeric,text,text,text,timestamptz) from public, anon;
revoke all on function public.record_inventory_waste_v2(uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz) from public, anon;
grant execute on function public.record_inventory_movement_v2(uuid,uuid,uuid,uuid,public.inventory_movement_type,numeric,text,uuid,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.record_inventory_transfer_v2(uuid,uuid,uuid,uuid,uuid,numeric,text,text,text,timestamptz) to authenticated;
grant execute on function public.record_inventory_waste_v2(uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz) to authenticated;

comment on table public.inventory_operation_idempotency is
  'Tenant-scoped retry guard for manual Inventory stock mutations.';
