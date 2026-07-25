-- ServeFlow Phase 8.5.3: Inventory Adjustments & Waste Management.
-- Manual operational adjustments only. No purchasing, receiving, deduction,
-- kitchen, ordering, payments, reports, AI, forecasting, or menu behavior.

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  idempotency_key uuid not null,
  direction text not null check (direction in ('increase', 'decrease')),
  adjustment_type text not null check (adjustment_type in (
    'opening_stock', 'manual_correction', 'donation_received', 'supplier_replacement',
    'waste', 'spoilage', 'expired', 'breakage', 'theft', 'returned_to_supplier'
  )),
  reason text not null check (char_length(btrim(reason)) between 1 and 180),
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'confirmed' check (status = 'confirmed'),
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint inventory_adjustments_restaurant_id_id_unique unique (restaurant_id, id),
  constraint inventory_adjustments_idempotency_unique unique (restaurant_id, idempotency_key),
  constraint inventory_adjustments_created_by_restaurant_fk
    foreign key (restaurant_id, created_by)
    references public.restaurant_staff(restaurant_id, id) on delete restrict,
  constraint inventory_adjustments_approved_by_restaurant_fk
    foreign key (restaurant_id, approved_by)
    references public.restaurant_staff(restaurant_id, id) on delete restrict,
  constraint inventory_adjustments_approval_complete_check
    check (status <> 'confirmed' or (approved_by is not null and approved_at is not null)),
  constraint inventory_adjustments_direction_type_check check (
    (direction = 'increase' and adjustment_type in (
      'opening_stock', 'manual_correction', 'donation_received', 'supplier_replacement'
    )) or
    (direction = 'decrease' and adjustment_type in (
      'waste', 'spoilage', 'expired', 'breakage', 'theft',
      'manual_correction', 'returned_to_supplier'
    ))
  )
);

create table if not exists public.inventory_adjustment_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  adjustment_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  unit_name text not null check (char_length(btrim(unit_name)) between 1 and 40),
  quantity numeric(12,3) not null check (quantity > 0),
  quantity_before numeric(12,3) not null check (quantity_before >= 0),
  quantity_after numeric(12,3) not null check (quantity_after >= 0),
  movement_audit_type text not null check (movement_audit_type in (
    'MANUAL_ADJUSTMENT_IN', 'MANUAL_ADJUSTMENT_OUT', 'WASTE',
    'SPOILAGE', 'RETURN_TO_SUPPLIER'
  )),
  movement_id uuid not null,
  created_at timestamptz not null default now(),
  constraint inventory_adjustment_items_restaurant_id_id_unique unique (restaurant_id, id),
  constraint inventory_adjustment_items_one_item_unique unique (adjustment_id, inventory_item_id),
  constraint inventory_adjustment_items_adjustment_restaurant_fk
    foreign key (restaurant_id, adjustment_id)
    references public.inventory_adjustments(restaurant_id, id) on delete restrict,
  constraint inventory_adjustment_items_inventory_restaurant_fk
    foreign key (restaurant_id, inventory_item_id)
    references public.inventory_items(restaurant_id, id) on delete restrict,
  constraint inventory_adjustment_items_unit_restaurant_fk
    foreign key (restaurant_id, unit_id)
    references public.inventory_units(restaurant_id, id) on delete restrict,
  constraint inventory_adjustment_items_movement_fk
    foreign key (movement_id) references public.inventory_movements(id)
    deferrable initially deferred,
  constraint inventory_adjustment_items_quantity_math_check check (
    (movement_audit_type = 'MANUAL_ADJUSTMENT_IN' and quantity_after = quantity_before + quantity)
    or
    (movement_audit_type <> 'MANUAL_ADJUSTMENT_IN' and quantity_after = quantity_before - quantity)
  )
);

create index if not exists inventory_adjustments_restaurant_history_idx
  on public.inventory_adjustments(restaurant_id, created_at desc, id desc);
create index if not exists inventory_adjustments_restaurant_type_idx
  on public.inventory_adjustments(restaurant_id, adjustment_type, created_at desc);
create index if not exists inventory_adjustment_items_item_idx
  on public.inventory_adjustment_items(restaurant_id, inventory_item_id, created_at desc);

create or replace function public.inventory_adjustment_can_read(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.inventory_admin_has_access(target_restaurant_id)
    or exists (
      select 1 from public.restaurant_staff staff
      where staff.restaurant_id = target_restaurant_id
        and staff.user_id = auth.uid()
        and staff.active = true
    );
$$;

alter table public.inventory_adjustments enable row level security;
alter table public.inventory_adjustment_items enable row level security;

drop policy if exists inventory_adjustments_tenant_read on public.inventory_adjustments;
create policy inventory_adjustments_tenant_read on public.inventory_adjustments
  for select to authenticated using (public.inventory_adjustment_can_read(restaurant_id));
drop policy if exists inventory_adjustment_items_tenant_read on public.inventory_adjustment_items;
create policy inventory_adjustment_items_tenant_read on public.inventory_adjustment_items
  for select to authenticated using (public.inventory_adjustment_can_read(restaurant_id));

revoke all on public.inventory_adjustments from public, anon, authenticated;
revoke all on public.inventory_adjustment_items from public, anon, authenticated;

create or replace function public.inventory_adjustment_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Confirmed inventory adjustments are immutable.';
end;
$$;

drop trigger if exists inventory_adjustments_block_update on public.inventory_adjustments;
create trigger inventory_adjustments_block_update
  before update on public.inventory_adjustments
  for each row execute function public.inventory_adjustment_immutable();
drop trigger if exists inventory_adjustments_block_delete on public.inventory_adjustments;
create trigger inventory_adjustments_block_delete
  before delete on public.inventory_adjustments
  for each row execute function public.inventory_adjustment_immutable();
drop trigger if exists inventory_adjustment_items_block_update on public.inventory_adjustment_items;
create trigger inventory_adjustment_items_block_update
  before update on public.inventory_adjustment_items
  for each row execute function public.inventory_adjustment_immutable();
drop trigger if exists inventory_adjustment_items_block_delete on public.inventory_adjustment_items;
create trigger inventory_adjustment_items_block_delete
  before delete on public.inventory_adjustment_items
  for each row execute function public.inventory_adjustment_immutable();

-- Extend the existing audit classification without changing the movement ledger.
alter table public.inventory_movements
  drop constraint if exists inventory_movements_food_consumption_type_check;
alter table public.inventory_movements
  drop constraint if exists inventory_movements_audit_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_audit_type_check check (
    audit_movement_type is null or audit_movement_type in (
      'FOOD_CONSUMPTION', 'PURCHASE_RECEIPT',
      'MANUAL_ADJUSTMENT_IN', 'MANUAL_ADJUSTMENT_OUT',
      'WASTE', 'SPOILAGE', 'RETURN_TO_SUPPLIER'
    )
  );

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_movements_adjustment_complete_check'
  ) then
    alter table public.inventory_movements
      add constraint inventory_movements_adjustment_complete_check check (
        source_system <> 'inventory_adjustment'
        or (
          audit_movement_type in (
            'MANUAL_ADJUSTMENT_IN', 'MANUAL_ADJUSTMENT_OUT',
            'WASTE', 'SPOILAGE', 'RETURN_TO_SUPPLIER'
          )
          and source_record_id is not null
          and performed_by_staff_id is not null
          and quantity_before is not null
          and quantity_after is not null
          and workflow_snapshot is not null
        )
      );
  end if;
end $$;

create unique index if not exists inventory_movements_adjustment_item_unique
  on public.inventory_movements(restaurant_id, source_record_id)
  where source_system = 'inventory_adjustment';
create index if not exists inventory_movements_adjustment_history_idx
  on public.inventory_movements(restaurant_id, movement_date desc, id desc)
  where audit_movement_type in (
    'MANUAL_ADJUSTMENT_IN', 'MANUAL_ADJUSTMENT_OUT',
    'WASTE', 'SPOILAGE', 'RETURN_TO_SUPPLIER'
  );

create or replace function public.inventory_adjustment_movement_audit_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  origin record;
  expected_ledger_type public.inventory_movement_type;
  expected_effect text;
begin
  if new.source_system <> 'inventory_adjustment' then
    return new;
  end if;
  if new.source_record_id is null then
    raise exception 'Inventory adjustment movement source is required.';
  end if;

  select
    adjustment_item.id adjustment_item_id,
    adjustment_item.inventory_item_id,
    adjustment_item.unit_id,
    adjustment_item.unit_name,
    adjustment_item.quantity,
    adjustment_item.quantity_before,
    adjustment_item.quantity_after,
    adjustment_item.movement_audit_type,
    adjustment_item.movement_id,
    adjustment.id adjustment_id,
    adjustment.direction,
    adjustment.adjustment_type,
    adjustment.reason,
    adjustment.notes adjustment_notes,
    adjustment.created_by,
    adjustment.approved_by,
    adjustment.created_at adjustment_created_at,
    item.storage_location_id
  into origin
  from public.inventory_adjustment_items adjustment_item
  join public.inventory_adjustments adjustment
    on adjustment.id = adjustment_item.adjustment_id
   and adjustment.restaurant_id = adjustment_item.restaurant_id
  join public.inventory_items item
    on item.id = adjustment_item.inventory_item_id
   and item.restaurant_id = adjustment_item.restaurant_id
  where adjustment_item.id = new.source_record_id
    and adjustment_item.restaurant_id = new.restaurant_id;

  if not found then
    raise exception 'Inventory adjustment movement cannot be orphaned.';
  end if;

  expected_ledger_type := case origin.movement_audit_type
    when 'MANUAL_ADJUSTMENT_IN' then 'adjustment_increase'::public.inventory_movement_type
    when 'MANUAL_ADJUSTMENT_OUT' then 'adjustment_decrease'::public.inventory_movement_type
    when 'WASTE' then 'waste'::public.inventory_movement_type
    when 'SPOILAGE' then 'spoilage'::public.inventory_movement_type
    when 'RETURN_TO_SUPPLIER' then 'stock_out'::public.inventory_movement_type
  end;
  expected_effect := case when origin.movement_audit_type = 'MANUAL_ADJUSTMENT_IN'
    then 'in' else 'out' end;

  if new.id <> origin.movement_id
    or new.inventory_item_id <> origin.inventory_item_id
    or new.storage_location_id <> origin.storage_location_id
    or new.unit_id <> origin.unit_id
    or new.quantity <> origin.quantity
    or new.movement_type <> expected_ledger_type
    or new.quantity_effect <> expected_effect
  then
    raise exception 'Inventory adjustment movement does not match its immutable adjustment item.';
  end if;

  new.audit_movement_type := origin.movement_audit_type;
  new.performed_by_staff_id := coalesce(origin.approved_by, origin.created_by);
  new.quantity_before := origin.quantity_before;
  new.quantity_after := origin.quantity_after;
  new.workflow_snapshot := jsonb_build_object(
    'adjustment_id', origin.adjustment_id,
    'adjustment_item_id', origin.adjustment_item_id,
    'direction', origin.direction,
    'adjustment_type', origin.adjustment_type,
    'status', 'confirmed',
    'reviewed', true,
    'confirmed', true
  );
  new.source_payload := jsonb_build_object(
    'adjustment_id', origin.adjustment_id,
    'adjustment_item_id', origin.adjustment_item_id,
    'adjustment_type', origin.adjustment_type,
    'reason', origin.reason,
    'quantity_before', origin.quantity_before,
    'quantity_after', origin.quantity_after
  );
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'audit_movement_type', origin.movement_audit_type,
    'adjustment_id', origin.adjustment_id,
    'adjustment_item_id', origin.adjustment_item_id
  );
  new.reason := origin.reason;
  new.notes := coalesce(new.notes, origin.adjustment_notes);
  return new;
end;
$$;

drop trigger if exists inventory_movements_adjustment_audit on public.inventory_movements;
create trigger inventory_movements_adjustment_audit
  before insert on public.inventory_movements
  for each row execute function public.inventory_adjustment_movement_audit_row();

create or replace function public.confirm_inventory_adjustment(
  target_restaurant_id uuid,
  target_idempotency_key uuid,
  target_direction text,
  target_adjustment_type text,
  target_notes text,
  target_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  existing_adjustment public.inventory_adjustments;
  adjustment_id uuid;
  adjustment_reason text;
  movement_audit_type text;
  ledger_movement_type public.inventory_movement_type;
  quantity_effect text;
  adjustment_plan jsonb;
  plan_entry jsonb;
  adjustment_item_id uuid;
  movement_id uuid;
  line_count integer;
begin
  if not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Inventory adjustment access denied.';
  end if;
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then
    raise exception 'Inventory adjustment actor is invalid.';
  end if;
  if target_idempotency_key is null then
    raise exception 'Inventory adjustment idempotency key is required.';
  end if;
  if target_direction not in ('increase', 'decrease') then
    raise exception 'Inventory adjustment direction is invalid.';
  end if;
  if target_notes is not null and char_length(btrim(target_notes)) > 1000 then
    raise exception 'Inventory adjustment notes are too long.';
  end if;
  if target_lines is null
    or jsonb_typeof(target_lines) <> 'array'
    or jsonb_array_length(target_lines) = 0
  then
    raise exception 'Inventory adjustment requires at least one inventory item.';
  end if;

  if not (
    (target_direction = 'increase' and target_adjustment_type in (
      'opening_stock', 'manual_correction', 'donation_received', 'supplier_replacement'
    )) or
    (target_direction = 'decrease' and target_adjustment_type in (
      'waste', 'spoilage', 'expired', 'breakage', 'theft',
      'manual_correction', 'returned_to_supplier'
    ))
  ) then
    raise exception 'Inventory adjustment type is invalid for its direction.';
  end if;

  adjustment_reason := case target_adjustment_type
    when 'opening_stock' then 'Opening Stock'
    when 'manual_correction' then 'Manual Correction'
    when 'donation_received' then 'Donation Received'
    when 'supplier_replacement' then 'Supplier Replacement'
    when 'waste' then 'Waste'
    when 'spoilage' then 'Spoilage'
    when 'expired' then 'Expired'
    when 'breakage' then 'Breakage'
    when 'theft' then 'Theft'
    when 'returned_to_supplier' then 'Returned to Supplier'
  end;
  movement_audit_type := case
    when target_direction = 'increase' then 'MANUAL_ADJUSTMENT_IN'
    when target_adjustment_type = 'waste' then 'WASTE'
    when target_adjustment_type = 'spoilage' then 'SPOILAGE'
    when target_adjustment_type = 'returned_to_supplier' then 'RETURN_TO_SUPPLIER'
    else 'MANUAL_ADJUSTMENT_OUT'
  end;
  ledger_movement_type := case movement_audit_type
    when 'MANUAL_ADJUSTMENT_IN' then 'adjustment_increase'::public.inventory_movement_type
    when 'MANUAL_ADJUSTMENT_OUT' then 'adjustment_decrease'::public.inventory_movement_type
    when 'WASTE' then 'waste'::public.inventory_movement_type
    when 'SPOILAGE' then 'spoilage'::public.inventory_movement_type
    when 'RETURN_TO_SUPPLIER' then 'stock_out'::public.inventory_movement_type
  end;
  quantity_effect := case when target_direction = 'increase' then 'in' else 'out' end;

  -- Serialize retries even when two identical first requests arrive concurrently.
  perform pg_advisory_xact_lock(hashtextextended(
    target_restaurant_id::text || ':' || target_idempotency_key::text, 0
  ));
  select adjustment.* into existing_adjustment
  from public.inventory_adjustments adjustment
  where adjustment.restaurant_id = target_restaurant_id
    and adjustment.idempotency_key = target_idempotency_key;
  if found then
    return jsonb_build_object(
      'adjustment_id', existing_adjustment.id,
      'status', existing_adjustment.status,
      'already_processed', true
    );
  end if;

  select count(*) into line_count
  from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, quantity numeric);
  if line_count <> jsonb_array_length(target_lines) then
    raise exception 'Inventory adjustment line is invalid.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, quantity numeric)
    group by line.inventory_item_id
    having line.inventory_item_id is null or count(*) > 1
  ) then
    raise exception 'Inventory adjustment items cannot be duplicated.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, quantity numeric)
    where line.quantity is null
      or line.quantity <= 0
      or round(line.quantity, 3) <> line.quantity
  ) then
    raise exception 'Inventory adjustment quantities must be positive and use at most three decimal places.';
  end if;

  -- Lock affected inventory rows in a stable order before reading quantities.
  perform item.id
  from public.inventory_items item
  join jsonb_to_recordset(target_lines) line(inventory_item_id uuid, quantity numeric)
    on line.inventory_item_id = item.id
  where item.restaurant_id = target_restaurant_id
  order by item.id
  for update of item;

  select jsonb_agg(jsonb_build_object(
    'inventory_item_id', item.id,
    'storage_location_id', item.storage_location_id,
    'unit_id', unit.id,
    'unit_name', unit.name,
    'quantity', round(line.quantity, 3),
    'quantity_before', item.current_quantity,
    'quantity_after', case when target_direction = 'increase'
      then round(item.current_quantity + line.quantity, 3)
      else round(item.current_quantity - line.quantity, 3) end,
    'ledger_quantity_before', public.get_inventory_storage_balance(
      target_restaurant_id, item.id, item.storage_location_id
    )
  ) order by item.id)
  into adjustment_plan
  from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, quantity numeric)
  join public.inventory_items item
    on item.id = line.inventory_item_id
   and item.restaurant_id = target_restaurant_id
   and item.status = 'active'
   and item.active = true
  join public.inventory_units unit
    on unit.id = item.unit_id
   and unit.restaurant_id = item.restaurant_id
   and unit.status = 'active'
   and unit.active = true
  join public.inventory_storage_locations storage
    on storage.id = item.storage_location_id
   and storage.restaurant_id = item.restaurant_id
   and storage.status = 'active';

  if adjustment_plan is null
    or jsonb_array_length(adjustment_plan) <> jsonb_array_length(target_lines)
  then
    raise exception 'Inventory adjustment contains an inactive, deleted, or cross-tenant item.';
  end if;
  if target_direction = 'decrease' and exists (
    select 1 from jsonb_array_elements(adjustment_plan) entry
    where (entry->>'quantity_after')::numeric < 0
  ) then
    raise exception 'Inventory adjustment would create negative current stock.';
  end if;
  if target_direction = 'decrease' and exists (
    select 1 from jsonb_array_elements(adjustment_plan) entry
    where (entry->>'ledger_quantity_before')::numeric < (entry->>'quantity')::numeric
  ) then
    raise exception 'Inventory adjustment would violate the existing negative-stock policy.';
  end if;

  insert into public.inventory_adjustments(
    restaurant_id, idempotency_key, direction, adjustment_type, reason,
    notes, status, created_by, approved_by, approved_at
  ) values (
    target_restaurant_id, target_idempotency_key, target_direction,
    target_adjustment_type, adjustment_reason,
    nullif(btrim(coalesce(target_notes, '')), ''), 'confirmed',
    actor_id, actor_id, now()
  ) returning id into adjustment_id;

  for plan_entry in select value from jsonb_array_elements(adjustment_plan)
  loop
    adjustment_item_id := gen_random_uuid();
    movement_id := gen_random_uuid();

    insert into public.inventory_adjustment_items(
      id, restaurant_id, adjustment_id, inventory_item_id,
      unit_id, unit_name, quantity, quantity_before, quantity_after,
      movement_audit_type, movement_id
    ) values (
      adjustment_item_id, target_restaurant_id, adjustment_id,
      (plan_entry->>'inventory_item_id')::uuid,
      (plan_entry->>'unit_id')::uuid,
      plan_entry->>'unit_name',
      (plan_entry->>'quantity')::numeric,
      (plan_entry->>'quantity_before')::numeric,
      (plan_entry->>'quantity_after')::numeric,
      movement_audit_type, movement_id
    );

    update public.inventory_items
    set current_quantity = (plan_entry->>'quantity_after')::numeric
    where id = (plan_entry->>'inventory_item_id')::uuid
      and restaurant_id = target_restaurant_id;

    insert into public.inventory_movements(
      id, restaurant_id, inventory_item_id, storage_location_id,
      unit_id, unit_name, movement_type, quantity, quantity_effect,
      reference_number, reason, notes, source_system, source_record_id,
      source_payload, movement_date, created_by_staff_id, metadata
    ) values (
      movement_id, target_restaurant_id,
      (plan_entry->>'inventory_item_id')::uuid,
      (plan_entry->>'storage_location_id')::uuid,
      (plan_entry->>'unit_id')::uuid,
      plan_entry->>'unit_name',
      ledger_movement_type,
      (plan_entry->>'quantity')::numeric,
      quantity_effect,
      'ADJ-' || upper(left(adjustment_id::text, 8)),
      adjustment_reason,
      nullif(btrim(coalesce(target_notes, '')), ''),
      'inventory_adjustment',
      adjustment_item_id,
      '{}'::jsonb,
      now(),
      actor_id,
      '{}'::jsonb
    );
  end loop;

  return jsonb_build_object(
    'adjustment_id', adjustment_id,
    'status', 'confirmed',
    'already_processed', false
  );
end;
$$;

create or replace function public.get_inventory_adjustments(target_restaurant_id uuid)
returns table(
  id uuid,
  restaurant_id uuid,
  direction text,
  adjustment_type text,
  reason text,
  notes text,
  status text,
  created_by uuid,
  created_by_name text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  created_at timestamptz,
  item_count bigint,
  total_quantity numeric,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.inventory_adjustment_can_read(target_restaurant_id) then
    raise exception 'Inventory adjustment history access denied.';
  end if;

  return query
  select
    adjustment.id,
    adjustment.restaurant_id,
    adjustment.direction,
    adjustment.adjustment_type,
    adjustment.reason,
    adjustment.notes,
    adjustment.status,
    adjustment.created_by,
    coalesce(creator.display_name, creator.email, creator.role::text),
    adjustment.approved_by,
    coalesce(approver.display_name, approver.email, approver.role::text),
    adjustment.approved_at,
    adjustment.created_at,
    count(adjustment_item.id)::bigint,
    coalesce(sum(adjustment_item.quantity), 0)::numeric(18,3),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', adjustment_item.id,
      'inventory_item_id', adjustment_item.inventory_item_id,
      'inventory_item_name', item.name,
      'unit_id', adjustment_item.unit_id,
      'unit_name', adjustment_item.unit_name,
      'quantity', adjustment_item.quantity,
      'quantity_before', adjustment_item.quantity_before,
      'quantity_after', adjustment_item.quantity_after,
      'movement_audit_type', adjustment_item.movement_audit_type,
      'movement_id', adjustment_item.movement_id
    ) order by item.name, adjustment_item.id)
      filter (where adjustment_item.id is not null), '[]'::jsonb)
  from public.inventory_adjustments adjustment
  join public.restaurant_staff creator
    on creator.id = adjustment.created_by
   and creator.restaurant_id = adjustment.restaurant_id
  left join public.restaurant_staff approver
    on approver.id = adjustment.approved_by
   and approver.restaurant_id = adjustment.restaurant_id
  left join public.inventory_adjustment_items adjustment_item
    on adjustment_item.adjustment_id = adjustment.id
   and adjustment_item.restaurant_id = adjustment.restaurant_id
  left join public.inventory_items item
    on item.id = adjustment_item.inventory_item_id
   and item.restaurant_id = adjustment_item.restaurant_id
  where adjustment.restaurant_id = target_restaurant_id
  group by adjustment.id, creator.display_name, creator.email, creator.role,
    approver.display_name, approver.email, approver.role
  order by adjustment.created_at desc, adjustment.id desc;
end;
$$;

revoke all on function public.inventory_adjustment_can_read(uuid) from public, anon;
revoke all on function public.inventory_adjustment_immutable() from public, anon, authenticated;
revoke all on function public.inventory_adjustment_movement_audit_row() from public, anon, authenticated;
revoke all on function public.confirm_inventory_adjustment(uuid,uuid,text,text,text,jsonb) from public, anon;
revoke all on function public.get_inventory_adjustments(uuid) from public, anon;
grant execute on function public.inventory_adjustment_can_read(uuid),
  public.get_inventory_adjustments(uuid) to authenticated;
grant execute on function public.confirm_inventory_adjustment(uuid,uuid,text,text,text,jsonb)
  to authenticated;

comment on table public.inventory_adjustments is
  'Immutable confirmed manual inventory adjustments with tenant-scoped idempotency and audit actors.';
comment on table public.inventory_adjustment_items is
  'Immutable item-level adjustment quantities, before/after snapshots, and existing-ledger movement links.';
comment on function public.confirm_inventory_adjustment(uuid,uuid,text,text,text,jsonb) is
  'Atomically validates, row-locks, confirms, updates current stock, and records existing-ledger movements.';
