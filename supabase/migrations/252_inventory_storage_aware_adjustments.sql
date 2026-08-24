-- ServeFlow Inventory: storage-aware correction confirmation.
-- Preserves the legacy adjustment RPC and all historical rows.

alter table public.inventory_adjustment_items
  add column if not exists storage_location_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_adjustment_items_storage_restaurant_fk'
  ) then
    alter table public.inventory_adjustment_items
      add constraint inventory_adjustment_items_storage_restaurant_fk
      foreign key (restaurant_id, storage_location_id)
      references public.inventory_storage_locations(restaurant_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists inventory_adjustment_items_storage_idx
  on public.inventory_adjustment_items(restaurant_id, storage_location_id, created_at desc);

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
  if new.source_system <> 'inventory_adjustment' then return new; end if;
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
    coalesce(adjustment_item.storage_location_id, item.storage_location_id) storage_location_id
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

  if not found then raise exception 'Inventory adjustment movement cannot be orphaned.'; end if;

  expected_ledger_type := case origin.movement_audit_type
    when 'MANUAL_ADJUSTMENT_IN' then 'adjustment_increase'::public.inventory_movement_type
    when 'MANUAL_ADJUSTMENT_OUT' then 'adjustment_decrease'::public.inventory_movement_type
    when 'WASTE' then 'waste'::public.inventory_movement_type
    when 'SPOILAGE' then 'spoilage'::public.inventory_movement_type
    when 'RETURN_TO_SUPPLIER' then 'stock_out'::public.inventory_movement_type
  end;
  expected_effect := case when origin.movement_audit_type = 'MANUAL_ADJUSTMENT_IN' then 'in' else 'out' end;

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
    'storage_location_id', origin.storage_location_id,
    'direction', origin.direction,
    'adjustment_type', origin.adjustment_type,
    'status', 'confirmed', 'reviewed', true, 'confirmed', true
  );
  new.source_payload := jsonb_build_object(
    'adjustment_id', origin.adjustment_id,
    'adjustment_item_id', origin.adjustment_item_id,
    'storage_location_id', origin.storage_location_id,
    'adjustment_type', origin.adjustment_type,
    'reason', origin.reason,
    'quantity_before', origin.quantity_before,
    'quantity_after', origin.quantity_after
  );
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'audit_movement_type', origin.movement_audit_type,
    'adjustment_id', origin.adjustment_id,
    'adjustment_item_id', origin.adjustment_item_id,
    'storage_location_id', origin.storage_location_id
  );
  new.reason := origin.reason;
  new.notes := coalesce(new.notes, origin.adjustment_notes);
  return new;
end;
$$;

create or replace function public.confirm_inventory_storage_adjustment(
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
  lock_entry record;
begin
  if not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Inventory adjustment access denied.';
  end if;
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then raise exception 'Inventory adjustment actor is invalid.'; end if;
  if target_idempotency_key is null then raise exception 'Inventory adjustment idempotency key is required.'; end if;
  if target_direction not in ('increase', 'decrease') then raise exception 'Inventory adjustment direction is invalid.'; end if;
  if target_notes is not null and char_length(btrim(target_notes)) > 1000 then
    raise exception 'Inventory adjustment notes are too long.';
  end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) = 0 then
    raise exception 'Inventory adjustment requires at least one inventory item.';
  end if;
  if not (
    (target_direction = 'increase' and target_adjustment_type in ('opening_stock', 'manual_correction'))
    or (target_direction = 'decrease' and target_adjustment_type = 'manual_correction')
  ) then
    raise exception 'Inventory correction type is invalid for its direction.';
  end if;

  adjustment_reason := case target_adjustment_type
    when 'opening_stock' then 'Opening Stock' else 'Manual Correction' end;
  movement_audit_type := case target_direction
    when 'increase' then 'MANUAL_ADJUSTMENT_IN' else 'MANUAL_ADJUSTMENT_OUT' end;
  ledger_movement_type := case target_direction
    when 'increase' then 'adjustment_increase'::public.inventory_movement_type
    else 'adjustment_decrease'::public.inventory_movement_type end;
  quantity_effect := case target_direction when 'increase' then 'in' else 'out' end;

  perform pg_advisory_xact_lock(hashtextextended(
    target_restaurant_id::text || ':' || target_idempotency_key::text, 0
  ));
  select adjustment.* into existing_adjustment
  from public.inventory_adjustments adjustment
  where adjustment.restaurant_id = target_restaurant_id
    and adjustment.idempotency_key = target_idempotency_key;
  if found then
    return jsonb_build_object('adjustment_id', existing_adjustment.id, 'status', existing_adjustment.status, 'already_processed', true);
  end if;

  select count(*) into line_count
  from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, storage_location_id uuid, quantity numeric);
  if line_count <> jsonb_array_length(target_lines) then raise exception 'Inventory adjustment line is invalid.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, storage_location_id uuid, quantity numeric)
    group by line.inventory_item_id
    having line.inventory_item_id is null or bool_or(line.storage_location_id is null) or count(*) > 1
  ) then raise exception 'Inventory adjustment items or storage locations are invalid.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, storage_location_id uuid, quantity numeric)
    where line.quantity is null or line.quantity <= 0 or round(line.quantity, 3) <> line.quantity
  ) then raise exception 'Inventory adjustment quantities must be positive and use at most three decimal places.'; end if;

  for lock_entry in
    select line.inventory_item_id, line.storage_location_id
    from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, storage_location_id uuid, quantity numeric)
    order by line.inventory_item_id, line.storage_location_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      target_restaurant_id::text || ':' || lock_entry.inventory_item_id::text || ':' || lock_entry.storage_location_id::text, 0
    ));
  end loop;

  perform item.id
  from public.inventory_items item
  join jsonb_to_recordset(target_lines) line(inventory_item_id uuid, storage_location_id uuid, quantity numeric)
    on line.inventory_item_id = item.id
  where item.restaurant_id = target_restaurant_id
  order by item.id
  for update of item;

  select jsonb_agg(jsonb_build_object(
    'inventory_item_id', item.id,
    'storage_location_id', storage.id,
    'unit_id', unit.id,
    'unit_name', unit.name,
    'quantity', round(line.quantity, 3),
    'quantity_before', item.current_quantity,
    'quantity_after', case when target_direction = 'increase'
      then round(item.current_quantity + line.quantity, 3)
      else round(item.current_quantity - line.quantity, 3) end,
    'ledger_quantity_before', public.get_inventory_storage_balance(target_restaurant_id, item.id, storage.id)
  ) order by item.id)
  into adjustment_plan
  from jsonb_to_recordset(target_lines) line(inventory_item_id uuid, storage_location_id uuid, quantity numeric)
  join public.inventory_items item
    on item.id = line.inventory_item_id and item.restaurant_id = target_restaurant_id
   and item.status = 'active' and item.active = true
  join public.inventory_units unit
    on unit.id = item.unit_id and unit.restaurant_id = item.restaurant_id
   and unit.status = 'active' and unit.active = true
  join public.inventory_storage_locations storage
    on storage.id = line.storage_location_id and storage.restaurant_id = item.restaurant_id
   and storage.status = 'active';

  if adjustment_plan is null or jsonb_array_length(adjustment_plan) <> jsonb_array_length(target_lines) then
    raise exception 'Inventory adjustment contains an inactive, deleted, or cross-tenant item or storage location.';
  end if;
  if target_direction = 'decrease' and exists (
    select 1 from jsonb_array_elements(adjustment_plan) entry where (entry->>'quantity_after')::numeric < 0
  ) then raise exception 'Inventory adjustment would create negative current stock.'; end if;
  if target_direction = 'decrease' and exists (
    select 1 from jsonb_array_elements(adjustment_plan) entry
    where (entry->>'ledger_quantity_before')::numeric < (entry->>'quantity')::numeric
  ) then raise exception 'Inventory adjustment would create negative storage stock.'; end if;

  insert into public.inventory_adjustments(
    restaurant_id, idempotency_key, direction, adjustment_type, reason,
    notes, status, created_by, approved_by, approved_at
  ) values (
    target_restaurant_id, target_idempotency_key, target_direction, target_adjustment_type,
    adjustment_reason, nullif(btrim(coalesce(target_notes, '')), ''), 'confirmed', actor_id, actor_id, now()
  ) returning id into adjustment_id;

  for plan_entry in select value from jsonb_array_elements(adjustment_plan)
  loop
    adjustment_item_id := gen_random_uuid();
    movement_id := gen_random_uuid();
    insert into public.inventory_adjustment_items(
      id, restaurant_id, adjustment_id, inventory_item_id, storage_location_id,
      unit_id, unit_name, quantity, quantity_before, quantity_after, movement_audit_type, movement_id
    ) values (
      adjustment_item_id, target_restaurant_id, adjustment_id,
      (plan_entry->>'inventory_item_id')::uuid, (plan_entry->>'storage_location_id')::uuid,
      (plan_entry->>'unit_id')::uuid, plan_entry->>'unit_name',
      (plan_entry->>'quantity')::numeric, (plan_entry->>'quantity_before')::numeric,
      (plan_entry->>'quantity_after')::numeric, movement_audit_type, movement_id
    );

    update public.inventory_items
    set current_quantity = (plan_entry->>'quantity_after')::numeric
    where id = (plan_entry->>'inventory_item_id')::uuid and restaurant_id = target_restaurant_id;

    insert into public.inventory_movements(
      id, restaurant_id, inventory_item_id, storage_location_id, unit_id, unit_name,
      movement_type, quantity, quantity_effect, reference_number, reason, notes,
      source_system, source_record_id, source_payload, movement_date,
      created_by_staff_id, metadata
    ) values (
      movement_id, target_restaurant_id, (plan_entry->>'inventory_item_id')::uuid,
      (plan_entry->>'storage_location_id')::uuid, (plan_entry->>'unit_id')::uuid,
      plan_entry->>'unit_name', ledger_movement_type, (plan_entry->>'quantity')::numeric,
      quantity_effect, 'ADJ-' || upper(left(adjustment_id::text, 8)), adjustment_reason,
      nullif(btrim(coalesce(target_notes, '')), ''), 'inventory_adjustment', adjustment_item_id,
      '{}'::jsonb, now(), actor_id, '{}'::jsonb
    );
  end loop;

  return jsonb_build_object('adjustment_id', adjustment_id, 'status', 'confirmed', 'already_processed', false);
end;
$$;

revoke all on function public.confirm_inventory_storage_adjustment(uuid,uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.confirm_inventory_storage_adjustment(uuid,uuid,text,text,text,jsonb) to authenticated;

comment on function public.confirm_inventory_storage_adjustment(uuid,uuid,text,text,text,jsonb) is
  'Atomically confirms a correction against an explicit same-tenant storage balance with idempotency and immutable audit provenance.';

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
      'storage_location_id', storage.id,
      'storage_location_name', storage.name,
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
  left join public.inventory_storage_locations storage
    on storage.id = coalesce(adjustment_item.storage_location_id, item.storage_location_id)
   and storage.restaurant_id = adjustment_item.restaurant_id
  where adjustment.restaurant_id = target_restaurant_id
  group by adjustment.id, creator.display_name, creator.email, creator.role,
    approver.display_name, approver.email, approver.role
  order by adjustment.created_at desc, adjustment.id desc;
end;
$$;

revoke all on function public.get_inventory_adjustments(uuid) from public, anon;
grant execute on function public.get_inventory_adjustments(uuid) to authenticated;
