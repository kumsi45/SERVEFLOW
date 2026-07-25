-- ServeFlow Phase 8.5.2: atomic purchase-order receiving.
-- Receiving only: no returns, supplier payments, accounting, or reports.

alter table public.purchase_orders
  drop constraint if exists purchase_orders_status_check;
alter table public.purchase_orders
  add constraint purchase_orders_status_check
  check (status in ('draft', 'partially_received', 'completed'));

alter table public.purchase_order_items
  add column if not exists received_quantity numeric(18,3) not null default 0;

create unique index if not exists purchase_order_items_restaurant_id_id_unique
  on public.purchase_order_items(restaurant_id, id);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchase_order_items_received_quantity_check'
  ) then
    alter table public.purchase_order_items
      add constraint purchase_order_items_received_quantity_check
      check (received_quantity >= 0 and received_quantity <= quantity);
  end if;
end $$;

create table if not exists public.purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  purchase_order_id uuid not null,
  idempotency_key uuid not null,
  received_by_staff_id uuid not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint purchase_order_receipts_restaurant_id_id_unique unique (restaurant_id, id),
  constraint purchase_order_receipts_idempotency_unique unique (restaurant_id, idempotency_key),
  constraint purchase_order_receipts_order_restaurant_fk
    foreign key (restaurant_id, purchase_order_id)
    references public.purchase_orders(restaurant_id, id) on delete restrict,
  constraint purchase_order_receipts_staff_restaurant_fk
    foreign key (restaurant_id, received_by_staff_id)
    references public.restaurant_staff(restaurant_id, id) on delete restrict
);

create table if not exists public.purchase_order_receipt_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  receipt_id uuid not null,
  purchase_order_item_id uuid not null,
  inventory_item_id uuid not null,
  purchase_unit_id uuid not null,
  purchase_unit_name text not null,
  received_quantity numeric(18,3) not null check (received_quantity > 0),
  inventory_unit_id uuid not null,
  inventory_unit_name text not null,
  conversion_ratio numeric(24,9) not null check (conversion_ratio > 0),
  inventory_quantity numeric(12,3) not null check (inventory_quantity > 0),
  purchase_unit_price numeric(18,6) not null check (purchase_unit_price >= 0),
  inventory_unit_price numeric(24,9) not null check (inventory_unit_price >= 0),
  quantity_before numeric(12,3) not null,
  quantity_after numeric(12,3) not null,
  created_at timestamptz not null default now(),
  constraint purchase_order_receipt_items_restaurant_id_id_unique unique (restaurant_id, id),
  constraint purchase_order_receipt_items_receipt_line_unique unique (receipt_id, purchase_order_item_id),
  constraint purchase_order_receipt_items_receipt_restaurant_fk
    foreign key (restaurant_id, receipt_id)
    references public.purchase_order_receipts(restaurant_id, id) on delete restrict,
  constraint purchase_order_receipt_items_order_line_restaurant_fk
    foreign key (restaurant_id, purchase_order_item_id)
    references public.purchase_order_items(restaurant_id, id) on delete restrict,
  constraint purchase_order_receipt_items_inventory_restaurant_fk
    foreign key (restaurant_id, inventory_item_id)
    references public.inventory_items(restaurant_id, id) on delete restrict,
  constraint purchase_order_receipt_items_purchase_unit_restaurant_fk
    foreign key (restaurant_id, purchase_unit_id)
    references public.inventory_units(restaurant_id, id) on delete restrict,
  constraint purchase_order_receipt_items_inventory_unit_restaurant_fk
    foreign key (restaurant_id, inventory_unit_id)
    references public.inventory_units(restaurant_id, id) on delete restrict,
  constraint purchase_order_receipt_items_quantity_math_check
    check (quantity_after = quantity_before + inventory_quantity)
);

create index if not exists purchase_order_receipts_order_idx
  on public.purchase_order_receipts(restaurant_id, purchase_order_id, received_at, id);
create index if not exists purchase_order_receipt_items_receipt_idx
  on public.purchase_order_receipt_items(restaurant_id, receipt_id, id);

alter table public.purchase_order_receipts enable row level security;
alter table public.purchase_order_receipt_items enable row level security;

drop policy if exists purchase_order_receipts_inventory_staff_select on public.purchase_order_receipts;
create policy purchase_order_receipts_inventory_staff_select on public.purchase_order_receipts
  for select to authenticated using (public.inventory_admin_has_access(restaurant_id));
drop policy if exists purchase_order_receipt_items_inventory_staff_select on public.purchase_order_receipt_items;
create policy purchase_order_receipt_items_inventory_staff_select on public.purchase_order_receipt_items
  for select to authenticated using (public.inventory_admin_has_access(restaurant_id));

revoke all on public.purchase_order_receipts from public, anon, authenticated;
revoke all on public.purchase_order_receipt_items from public, anon, authenticated;

create or replace function public.purchase_order_receipt_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Purchase receipt history is immutable.';
end;
$$;

drop trigger if exists purchase_order_receipts_block_update on public.purchase_order_receipts;
create trigger purchase_order_receipts_block_update
  before update on public.purchase_order_receipts
  for each row execute function public.purchase_order_receipt_immutable();
drop trigger if exists purchase_order_receipts_block_delete on public.purchase_order_receipts;
create trigger purchase_order_receipts_block_delete
  before delete on public.purchase_order_receipts
  for each row execute function public.purchase_order_receipt_immutable();
drop trigger if exists purchase_order_receipt_items_block_update on public.purchase_order_receipt_items;
create trigger purchase_order_receipt_items_block_update
  before update on public.purchase_order_receipt_items
  for each row execute function public.purchase_order_receipt_immutable();
drop trigger if exists purchase_order_receipt_items_block_delete on public.purchase_order_receipt_items;
create trigger purchase_order_receipt_items_block_delete
  before delete on public.purchase_order_receipt_items
  for each row execute function public.purchase_order_receipt_immutable();

alter table public.inventory_movements
  drop constraint if exists inventory_movements_food_consumption_type_check;
alter table public.inventory_movements
  drop constraint if exists inventory_movements_audit_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_audit_type_check
  check (audit_movement_type is null or audit_movement_type in ('FOOD_CONSUMPTION', 'PURCHASE_RECEIPT'));

create unique index if not exists inventory_movements_purchase_receipt_item_unique
  on public.inventory_movements(restaurant_id, source_record_id)
  where source_system = 'purchase_order_receipt';
create index if not exists inventory_movements_purchase_receipt_history_idx
  on public.inventory_movements(restaurant_id, movement_date desc, id desc)
  where audit_movement_type = 'PURCHASE_RECEIPT';

create or replace function public.inventory_purchase_receipt_audit_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  origin record;
begin
  if new.source_system <> 'purchase_order_receipt' then
    return new;
  end if;
  if new.source_record_id is null
    or new.movement_type <> 'stock_in'::public.inventory_movement_type
    or new.quantity_effect <> 'in'
  then
    raise exception 'Purchase receipt movement source is invalid.';
  end if;

  select
    receipt_item.id receipt_item_id,
    receipt_item.inventory_item_id,
    receipt_item.inventory_unit_id,
    receipt_item.inventory_unit_name,
    receipt_item.inventory_quantity,
    receipt_item.quantity_before,
    receipt_item.quantity_after,
    receipt_item.purchase_order_item_id,
    receipt_item.purchase_unit_id,
    receipt_item.purchase_unit_name,
    receipt_item.received_quantity,
    receipt_item.purchase_unit_price,
    receipt_item.inventory_unit_price,
    receipt.id receipt_id,
    receipt.purchase_order_id,
    receipt.received_by_staff_id,
    receipt.notes receipt_notes,
    purchase_order.supplier_id,
    item.storage_location_id
  into origin
  from public.purchase_order_receipt_items receipt_item
  join public.purchase_order_receipts receipt
    on receipt.id = receipt_item.receipt_id
   and receipt.restaurant_id = receipt_item.restaurant_id
  join public.purchase_orders purchase_order
    on purchase_order.id = receipt.purchase_order_id
   and purchase_order.restaurant_id = receipt.restaurant_id
  join public.inventory_items item
    on item.id = receipt_item.inventory_item_id
   and item.restaurant_id = receipt_item.restaurant_id
  where receipt_item.id = new.source_record_id
    and receipt_item.restaurant_id = new.restaurant_id;

  if not found
    or new.inventory_item_id <> origin.inventory_item_id
    or new.storage_location_id <> origin.storage_location_id
    or new.unit_id <> origin.inventory_unit_id
    or new.quantity <> origin.inventory_quantity
    or new.supplier_id is distinct from origin.supplier_id
  then
    raise exception 'Purchase receipt movement does not match its immutable receipt item.';
  end if;

  new.audit_movement_type := 'PURCHASE_RECEIPT';
  new.performed_by_staff_id := origin.received_by_staff_id;
  new.quantity_before := origin.quantity_before;
  new.quantity_after := origin.quantity_after;
  new.workflow_snapshot := jsonb_build_object(
    'purchase_order_id', origin.purchase_order_id,
    'purchase_receipt_id', origin.receipt_id,
    'purchase_order_item_id', origin.purchase_order_item_id
  );
  new.source_payload := jsonb_build_object(
    'purchase_order_id', origin.purchase_order_id,
    'purchase_receipt_id', origin.receipt_id,
    'purchase_order_item_id', origin.purchase_order_item_id,
    'purchase_unit_id', origin.purchase_unit_id,
    'purchase_unit_name', origin.purchase_unit_name,
    'received_quantity', origin.received_quantity,
    'purchase_unit_price', origin.purchase_unit_price,
    'inventory_unit_price', origin.inventory_unit_price
  );
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'audit_movement_type', 'PURCHASE_RECEIPT',
    'purchase_order_id', origin.purchase_order_id,
    'purchase_receipt_id', origin.receipt_id,
    'purchase_order_item_id', origin.purchase_order_item_id,
    'purchase_unit_price', origin.purchase_unit_price,
    'inventory_unit_price', origin.inventory_unit_price
  );
  new.notes := coalesce(new.notes, origin.receipt_notes, 'Purchase order receipt.');
  return new;
end;
$$;

drop trigger if exists inventory_movements_purchase_receipt_audit on public.inventory_movements;
create trigger inventory_movements_purchase_receipt_audit
  before insert on public.inventory_movements
  for each row execute function public.inventory_purchase_receipt_audit_row();

create or replace function public.receive_purchase_order(
  target_restaurant_id uuid,
  target_purchase_order_id uuid,
  target_idempotency_key uuid,
  target_lines jsonb,
  target_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  purchase_order_row public.purchase_orders;
  existing_receipt public.purchase_order_receipts;
  receipt_id uuid;
  receipt_plan jsonb;
  plan_entry jsonb;
  receipt_item_id uuid;
  before_quantity numeric(12,3);
  after_quantity numeric(12,3);
  resulting_status text;
  line_count integer;
begin
  if not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Purchase order receiving access denied.';
  end if;
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then
    raise exception 'Purchase order receiving actor is invalid.';
  end if;
  if target_idempotency_key is null then
    raise exception 'A receipt idempotency key is required.';
  end if;
  if target_notes is not null and char_length(btrim(target_notes)) > 1000 then
    raise exception 'Receipt notes are too long.';
  end if;
  if target_lines is null
    or jsonb_typeof(target_lines) <> 'array'
    or jsonb_array_length(target_lines) = 0
  then
    raise exception 'Select at least one purchase order line to receive.';
  end if;

  select purchase_order.* into purchase_order_row
  from public.purchase_orders purchase_order
  where purchase_order.id = target_purchase_order_id
    and purchase_order.restaurant_id = target_restaurant_id
  for update;
  if not found then
    raise exception 'Purchase order not found.';
  end if;

  select receipt.* into existing_receipt
  from public.purchase_order_receipts receipt
  where receipt.restaurant_id = target_restaurant_id
    and receipt.idempotency_key = target_idempotency_key;
  if found then
    if existing_receipt.purchase_order_id <> target_purchase_order_id then
      raise exception 'Receipt idempotency key belongs to another purchase order.';
    end if;
    return jsonb_build_object(
      'receipt_id', existing_receipt.id,
      'purchase_order_id', existing_receipt.purchase_order_id,
      'status', purchase_order_row.status,
      'already_processed', true
    );
  end if;

  if purchase_order_row.status = 'completed' then
    raise exception 'Purchase order is already completed.';
  end if;
  if purchase_order_row.status not in ('draft', 'partially_received') then
    raise exception 'Purchase order cannot be received in its current status.';
  end if;
  if not exists (
    select 1 from public.inventory_suppliers supplier
    where supplier.id = purchase_order_row.supplier_id
      and supplier.restaurant_id = target_restaurant_id
      and supplier.status = 'active'
  ) then
    raise exception 'Purchase order supplier must be active before receiving.';
  end if;

  select count(*) into line_count
  from jsonb_to_recordset(target_lines) line(purchase_order_item_id uuid, received_quantity numeric);
  if line_count <> jsonb_array_length(target_lines) then
    raise exception 'Purchase receipt line is invalid.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(target_lines) line(purchase_order_item_id uuid, received_quantity numeric)
    group by line.purchase_order_item_id
    having line.purchase_order_item_id is null or count(*) > 1
  ) then
    raise exception 'Purchase receipt lines cannot be duplicated.';
  end if;

  perform line.id
  from public.purchase_order_items line
  join jsonb_to_recordset(target_lines) request(purchase_order_item_id uuid, received_quantity numeric)
    on request.purchase_order_item_id = line.id
  where line.restaurant_id = target_restaurant_id
    and line.purchase_order_id = target_purchase_order_id
  order by line.id
  for update of line;

  if exists (
    select 1
    from jsonb_to_recordset(target_lines) request(purchase_order_item_id uuid, received_quantity numeric)
    left join public.purchase_order_items line
      on line.id = request.purchase_order_item_id
     and line.restaurant_id = target_restaurant_id
     and line.purchase_order_id = target_purchase_order_id
    where line.id is null
      or request.received_quantity is null
      or request.received_quantity <= 0
      or round(request.received_quantity, 3) <> request.received_quantity
      or request.received_quantity > line.quantity - line.received_quantity
  ) then
    raise exception 'Purchase receipt quantity exceeds the remaining ordered quantity or is invalid.';
  end if;

  perform item.id
  from public.inventory_items item
  join public.purchase_order_items line
    on line.inventory_item_id = item.id
   and line.restaurant_id = item.restaurant_id
  join jsonb_to_recordset(target_lines) request(purchase_order_item_id uuid, received_quantity numeric)
    on request.purchase_order_item_id = line.id
  where item.restaurant_id = target_restaurant_id
  order by item.id
  for update of item;

  select jsonb_agg(jsonb_build_object(
    'purchase_order_item_id', line.id,
    'inventory_item_id', item.id,
    'storage_location_id', item.storage_location_id,
    'purchase_unit_id', purchase_unit.id,
    'purchase_unit_name', purchase_unit.name,
    'received_quantity', round(request.received_quantity, 3),
    'inventory_unit_id', inventory_unit.id,
    'inventory_unit_name', inventory_unit.name,
    'conversion_ratio', public.recipe_unit_conversion_ratio(purchase_unit.name, inventory_unit.name),
    'inventory_quantity', round(
      request.received_quantity * public.recipe_unit_conversion_ratio(purchase_unit.name, inventory_unit.name), 3
    ),
    'purchase_unit_price', line.unit_price,
    'inventory_unit_price', round(
      line.unit_price / public.recipe_unit_conversion_ratio(purchase_unit.name, inventory_unit.name), 9
    )
  ) order by item.id, line.id)
  into receipt_plan
  from jsonb_to_recordset(target_lines) request(purchase_order_item_id uuid, received_quantity numeric)
  join public.purchase_order_items line
    on line.id = request.purchase_order_item_id
   and line.restaurant_id = target_restaurant_id
   and line.purchase_order_id = target_purchase_order_id
  join public.inventory_items item
    on item.id = line.inventory_item_id
   and item.restaurant_id = line.restaurant_id
   and item.status = 'active'
   and item.active = true
  join public.inventory_units purchase_unit
    on purchase_unit.id = line.purchase_unit_id
   and purchase_unit.restaurant_id = line.restaurant_id
   and purchase_unit.status = 'active'
   and purchase_unit.active = true
  join public.inventory_units inventory_unit
    on inventory_unit.id = item.unit_id
   and inventory_unit.restaurant_id = item.restaurant_id
   and inventory_unit.status = 'active'
   and inventory_unit.active = true
  join public.inventory_storage_locations storage
    on storage.id = item.storage_location_id
   and storage.restaurant_id = item.restaurant_id
   and storage.status = 'active'
  where public.recipe_unit_conversion_ratio(purchase_unit.name, inventory_unit.name) is not null;

  if receipt_plan is null
    or jsonb_array_length(receipt_plan) <> jsonb_array_length(target_lines)
    or exists (
      select 1 from jsonb_array_elements(receipt_plan) entry
      where (entry->>'inventory_quantity')::numeric <= 0
    )
  then
    raise exception 'Purchase receipt plan contains an inactive item or an unsupported unit conversion.';
  end if;

  insert into public.purchase_order_receipts(
    restaurant_id, purchase_order_id, idempotency_key, received_by_staff_id, notes
  ) values (
    target_restaurant_id, target_purchase_order_id, target_idempotency_key, actor_id,
    nullif(btrim(coalesce(target_notes, '')), '')
  ) returning id into receipt_id;

  for plan_entry in select value from jsonb_array_elements(receipt_plan)
  loop
    select item.current_quantity into before_quantity
    from public.inventory_items item
    where item.id = (plan_entry->>'inventory_item_id')::uuid
      and item.restaurant_id = target_restaurant_id;
    after_quantity := round(before_quantity + (plan_entry->>'inventory_quantity')::numeric, 3);

    insert into public.purchase_order_receipt_items(
      restaurant_id, receipt_id, purchase_order_item_id, inventory_item_id,
      purchase_unit_id, purchase_unit_name, received_quantity,
      inventory_unit_id, inventory_unit_name, conversion_ratio, inventory_quantity,
      purchase_unit_price, inventory_unit_price, quantity_before, quantity_after
    ) values (
      target_restaurant_id, receipt_id,
      (plan_entry->>'purchase_order_item_id')::uuid,
      (plan_entry->>'inventory_item_id')::uuid,
      (plan_entry->>'purchase_unit_id')::uuid,
      plan_entry->>'purchase_unit_name',
      (plan_entry->>'received_quantity')::numeric,
      (plan_entry->>'inventory_unit_id')::uuid,
      plan_entry->>'inventory_unit_name',
      (plan_entry->>'conversion_ratio')::numeric,
      (plan_entry->>'inventory_quantity')::numeric,
      (plan_entry->>'purchase_unit_price')::numeric,
      (plan_entry->>'inventory_unit_price')::numeric,
      before_quantity, after_quantity
    ) returning id into receipt_item_id;

    update public.inventory_items
    set current_quantity = after_quantity
    where id = (plan_entry->>'inventory_item_id')::uuid
      and restaurant_id = target_restaurant_id;

    insert into public.inventory_movements(
      restaurant_id, inventory_item_id, storage_location_id, supplier_id,
      unit_id, unit_name, movement_type, quantity, quantity_effect,
      reference_number, reason, notes, source_system, source_record_id,
      source_payload, movement_date, created_by_staff_id, metadata
    ) values (
      target_restaurant_id,
      (plan_entry->>'inventory_item_id')::uuid,
      (plan_entry->>'storage_location_id')::uuid,
      purchase_order_row.supplier_id,
      (plan_entry->>'inventory_unit_id')::uuid,
      plan_entry->>'inventory_unit_name',
      'stock_in',
      (plan_entry->>'inventory_quantity')::numeric,
      'in',
      'PO-' || upper(left(target_purchase_order_id::text, 8)),
      'Purchase order receipt',
      nullif(btrim(coalesce(target_notes, '')), ''),
      'purchase_order_receipt',
      receipt_item_id,
      '{}'::jsonb,
      now(),
      actor_id,
      '{}'::jsonb
    );

    update public.purchase_order_items
    set received_quantity = received_quantity + (plan_entry->>'received_quantity')::numeric,
        updated_at = clock_timestamp()
    where id = (plan_entry->>'purchase_order_item_id')::uuid
      and restaurant_id = target_restaurant_id;
  end loop;

  select case when bool_and(line.received_quantity = line.quantity)
    then 'completed' else 'partially_received' end
  into resulting_status
  from public.purchase_order_items line
  where line.restaurant_id = target_restaurant_id
    and line.purchase_order_id = target_purchase_order_id;

  update public.purchase_orders
  set status = resulting_status,
      updated_by_staff_id = actor_id,
      updated_at = clock_timestamp()
  where id = target_purchase_order_id
    and restaurant_id = target_restaurant_id;

  return jsonb_build_object(
    'receipt_id', receipt_id,
    'purchase_order_id', target_purchase_order_id,
    'status', resulting_status,
    'already_processed', false
  );
end;
$$;

create or replace function public.get_purchase_orders(target_restaurant_id uuid)
returns table(
  id uuid,
  restaurant_id uuid,
  supplier_id uuid,
  supplier_name text,
  status text,
  expected_delivery_date date,
  notes text,
  created_by_staff_id uuid,
  created_by_name text,
  updated_by_staff_id uuid,
  updated_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  line_count bigint,
  total numeric,
  received_total numeric,
  remaining_total numeric,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Purchase order access denied.';
  end if;
  return query
  select
    purchase_order.id,
    purchase_order.restaurant_id,
    purchase_order.supplier_id,
    supplier.name,
    purchase_order.status,
    purchase_order.expected_delivery_date,
    purchase_order.notes,
    purchase_order.created_by_staff_id,
    coalesce(creator.display_name, creator.email, creator.role::text),
    purchase_order.updated_by_staff_id,
    coalesce(updater.display_name, updater.email, updater.role::text),
    purchase_order.created_at,
    purchase_order.updated_at,
    count(line.id)::bigint,
    coalesce(sum(line.quantity * line.unit_price), 0)::numeric(18,6),
    coalesce(sum(line.received_quantity * line.unit_price), 0)::numeric(18,6),
    coalesce(sum((line.quantity - line.received_quantity) * line.unit_price), 0)::numeric(18,6),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', line.id,
      'inventory_item_id', line.inventory_item_id,
      'inventory_item_name', item.name,
      'purchase_unit_id', line.purchase_unit_id,
      'purchase_unit_name', unit.name,
      'quantity', line.quantity,
      'received_quantity', line.received_quantity,
      'remaining_quantity', line.quantity - line.received_quantity,
      'unit_price', line.unit_price,
      'line_total', line.quantity * line.unit_price,
      'sort_order', line.sort_order
    ) order by line.sort_order, line.id) filter (where line.id is not null), '[]'::jsonb)
  from public.purchase_orders purchase_order
  join public.inventory_suppliers supplier
    on supplier.id = purchase_order.supplier_id
   and supplier.restaurant_id = purchase_order.restaurant_id
  join public.restaurant_staff creator
    on creator.id = purchase_order.created_by_staff_id
   and creator.restaurant_id = purchase_order.restaurant_id
  join public.restaurant_staff updater
    on updater.id = purchase_order.updated_by_staff_id
   and updater.restaurant_id = purchase_order.restaurant_id
  left join public.purchase_order_items line
    on line.purchase_order_id = purchase_order.id
   and line.restaurant_id = purchase_order.restaurant_id
  left join public.inventory_items item
    on item.id = line.inventory_item_id
   and item.restaurant_id = line.restaurant_id
  left join public.inventory_units unit
    on unit.id = line.purchase_unit_id
   and unit.restaurant_id = line.restaurant_id
  where purchase_order.restaurant_id = target_restaurant_id
  group by purchase_order.id, supplier.name, creator.display_name, creator.email, creator.role,
    updater.display_name, updater.email, updater.role
  order by purchase_order.updated_at desc, purchase_order.id desc;
end;
$$;

revoke all on function public.receive_purchase_order(uuid, uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.get_purchase_orders(uuid) from public, anon;
grant execute on function public.receive_purchase_order(uuid, uuid, uuid, jsonb, text),
  public.get_purchase_orders(uuid) to authenticated;

comment on table public.purchase_order_receipts is
  'Immutable, idempotent purchase receipt headers created atomically with inventory stock-in.';
comment on table public.purchase_order_receipt_items is
  'Immutable purchase quantity, price, conversion, and before/after stock snapshots.';
comment on column public.purchase_order_receipt_items.purchase_unit_price is
  'Original purchase-order unit price preserved at receipt time; never overwritten.';
