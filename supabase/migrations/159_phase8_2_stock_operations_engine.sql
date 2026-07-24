-- Phase 8.2: immutable stock operations engine.
-- Isolated inventory movement ledger for owner and manager stock operations.

do $$ begin
  create type public.inventory_movement_type as enum (
    'stock_in',
    'stock_out',
    'adjustment_increase',
    'adjustment_decrease',
    'waste',
    'spoilage',
    'transfer_in',
    'transfer_out',
    'opening_balance',
    'closing_balance',
    'manual_correction'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  storage_location_id uuid not null references public.inventory_storage_locations(id),
  supplier_id uuid references public.inventory_suppliers(id),
  unit_id uuid not null references public.inventory_units(id),
  unit_name text not null check (char_length(btrim(unit_name)) between 1 and 40),
  movement_type public.inventory_movement_type not null,
  quantity numeric(12,3) not null check (quantity > 0),
  quantity_effect text not null check (quantity_effect in ('in','out')),
  reference_number text check (reference_number is null or char_length(reference_number) <= 120),
  invoice_number text check (invoice_number is null or char_length(invoice_number) <= 120),
  reason text check (reason is null or char_length(reason) <= 180),
  notes text check (notes is null or char_length(notes) <= 1000),
  transfer_group_id uuid,
  source_system text not null default 'manual' check (char_length(btrim(source_system)) between 1 and 80),
  source_record_id uuid,
  source_payload jsonb not null default '{}'::jsonb,
  movement_date timestamptz not null default now(),
  created_by_staff_id uuid not null references public.restaurant_staff(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.inventory_movements add column if not exists source_system text not null default 'manual';
alter table public.inventory_movements add column if not exists source_record_id uuid;
alter table public.inventory_movements add column if not exists source_payload jsonb not null default '{}'::jsonb;

create index if not exists inventory_movements_restaurant_date_idx
  on public.inventory_movements(restaurant_id, movement_date desc, created_at desc);
create index if not exists inventory_movements_item_date_idx
  on public.inventory_movements(restaurant_id, inventory_item_id, movement_date, created_at, id);
create index if not exists inventory_movements_storage_idx
  on public.inventory_movements(restaurant_id, storage_location_id, movement_date desc);
create index if not exists inventory_movements_supplier_idx
  on public.inventory_movements(restaurant_id, supplier_id, movement_date desc)
  where supplier_id is not null;
create index if not exists inventory_movements_type_idx
  on public.inventory_movements(restaurant_id, movement_type, movement_date desc);
create index if not exists inventory_movements_transfer_group_idx
  on public.inventory_movements(restaurant_id, transfer_group_id)
  where transfer_group_id is not null;
create index if not exists inventory_movements_source_idx
  on public.inventory_movements(restaurant_id, source_system, source_record_id)
  where source_record_id is not null;

create unique index if not exists inventory_items_restaurant_id_id_unique
  on public.inventory_items(restaurant_id, id);
create unique index if not exists inventory_storage_locations_restaurant_id_id_unique
  on public.inventory_storage_locations(restaurant_id, id);
create unique index if not exists inventory_units_restaurant_id_id_unique
  on public.inventory_units(restaurant_id, id);
create unique index if not exists inventory_suppliers_restaurant_id_id_unique
  on public.inventory_suppliers(restaurant_id, id);
create unique index if not exists restaurant_staff_restaurant_id_id_unique
  on public.restaurant_staff(restaurant_id, id);
create unique index if not exists inventory_transfer_group_type_unique
  on public.inventory_movements(restaurant_id, transfer_group_id, movement_type)
  where transfer_group_id is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_item_restaurant_fk') then
    alter table public.inventory_movements
      add constraint inventory_movements_item_restaurant_fk
      foreign key (restaurant_id, inventory_item_id)
      references public.inventory_items(restaurant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_storage_restaurant_fk') then
    alter table public.inventory_movements
      add constraint inventory_movements_storage_restaurant_fk
      foreign key (restaurant_id, storage_location_id)
      references public.inventory_storage_locations(restaurant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_unit_restaurant_fk') then
    alter table public.inventory_movements
      add constraint inventory_movements_unit_restaurant_fk
      foreign key (restaurant_id, unit_id)
      references public.inventory_units(restaurant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_supplier_restaurant_fk') then
    alter table public.inventory_movements
      add constraint inventory_movements_supplier_restaurant_fk
      foreign key (restaurant_id, supplier_id)
      references public.inventory_suppliers(restaurant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'inventory_movements_staff_restaurant_fk') then
    alter table public.inventory_movements
      add constraint inventory_movements_staff_restaurant_fk
      foreign key (restaurant_id, created_by_staff_id)
      references public.restaurant_staff(restaurant_id, id);
  end if;
end $$;

alter table public.inventory_movements enable row level security;

create or replace function public.inventory_movement_expected_effect(target_type public.inventory_movement_type)
returns text
language sql
immutable
set search_path=public
as $$
  select case
    when target_type in ('stock_in','adjustment_increase','transfer_in','opening_balance') then 'in'
    when target_type in ('stock_out','adjustment_decrease','waste','spoilage','transfer_out') then 'out'
    else null
  end;
$$;

create or replace function public.inventory_movement_signed_quantity(target_quantity numeric, target_effect text)
returns numeric
language sql
immutable
set search_path=public
as $$
  select case when target_effect = 'in' then target_quantity else -target_quantity end;
$$;

create or replace function public.get_inventory_storage_balance(
  target_restaurant_id uuid,
  target_inventory_item_id uuid,
  target_storage_location_id uuid
)
returns numeric
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(sum(public.inventory_movement_signed_quantity(m.quantity, m.quantity_effect)), 0)::numeric(12,3)
  from public.inventory_movements m
  where m.restaurant_id = target_restaurant_id
    and m.inventory_item_id = target_inventory_item_id
    and m.storage_location_id = target_storage_location_id
    and public.inventory_admin_has_access(target_restaurant_id);
$$;

create or replace function public.inventory_movement_requirements_met(target_type public.inventory_movement_type, target_reason text)
returns boolean
language sql
immutable
set search_path=public
as $$
  select case
    when target_type in ('adjustment_increase','adjustment_decrease','waste','spoilage','manual_correction') then nullif(btrim(coalesce(target_reason, '')), '') is not null
    else true
  end;
$$;

create or replace function public.inventory_movement_validate_row()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  item_row public.inventory_items;
  unit_name_value text;
  expected_effect text;
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

  select * into item_row
  from public.inventory_items
  where id = new.inventory_item_id
    and restaurant_id = new.restaurant_id
    and status = 'active';
  if item_row.id is null then
    raise exception 'Inventory item is invalid.';
  end if;

  if not exists (
    select 1 from public.inventory_storage_locations l
    where l.id = new.storage_location_id
      and l.restaurant_id = new.restaurant_id
      and l.status = 'active'
  ) then
    raise exception 'Storage location is invalid.';
  end if;

  select u.name into unit_name_value
  from public.inventory_units u
  where u.id = new.unit_id
    and u.restaurant_id = new.restaurant_id
    and u.status = 'active';
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
      and s.role in ('owner','manager')
  ) then
    raise exception 'Movement user is invalid.';
  end if;

  new.unit_name := unit_name_value;
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
end $$;

create or replace function public.inventory_movement_validate_transfer_pair()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  transfer_count integer;
  out_count integer;
  in_count integer;
  storage_count integer;
  quantity_count integer;
begin
  select
    count(*),
    count(*) filter (where movement_type = 'transfer_out'),
    count(*) filter (where movement_type = 'transfer_in'),
    count(distinct storage_location_id),
    count(distinct quantity)
  into transfer_count, out_count, in_count, storage_count, quantity_count
  from public.inventory_movements
  where restaurant_id = new.restaurant_id
    and transfer_group_id = new.transfer_group_id
    and inventory_item_id = new.inventory_item_id;

  if transfer_count <> 2 or out_count <> 1 or in_count <> 1 or storage_count <> 2 or quantity_count <> 1 then
    raise exception 'Transfer must contain exactly one balanced transfer out and one transfer in.';
  end if;

  return null;
end $$;

create or replace function public.inventory_movement_block_update_delete()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  raise exception 'Inventory movements are immutable.';
end $$;

drop trigger if exists inventory_movements_validate on public.inventory_movements;
create trigger inventory_movements_validate
  before insert on public.inventory_movements
  for each row execute function public.inventory_movement_validate_row();

drop trigger if exists inventory_movements_block_update on public.inventory_movements;
create trigger inventory_movements_block_update
  before update on public.inventory_movements
  for each row execute function public.inventory_movement_block_update_delete();

drop trigger if exists inventory_movements_block_delete on public.inventory_movements;
create trigger inventory_movements_block_delete
  before delete on public.inventory_movements
  for each row execute function public.inventory_movement_block_update_delete();

drop trigger if exists inventory_movements_transfer_pair on public.inventory_movements;
create constraint trigger inventory_movements_transfer_pair
  after insert on public.inventory_movements
  deferrable initially deferred
  for each row
  when (new.movement_type in ('transfer_in','transfer_out'))
  execute function public.inventory_movement_validate_transfer_pair();

drop policy if exists inventory_movements_inventory_admin_select on public.inventory_movements;
drop policy if exists inventory_movements_inventory_admin_insert on public.inventory_movements;
create policy inventory_movements_inventory_admin_select on public.inventory_movements
  for select to authenticated using (public.inventory_admin_has_access(restaurant_id));
create policy inventory_movements_inventory_admin_insert on public.inventory_movements
  for insert to authenticated with check (public.inventory_admin_has_access(restaurant_id));

create or replace function public.record_inventory_movement(
  target_restaurant_id uuid,
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
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_id uuid;
  item_unit_id uuid;
  new_id uuid;
  final_effect text;
begin
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then
    raise exception 'Inventory movement access denied.';
  end if;

  select unit_id into item_unit_id
  from public.inventory_items
  where id = target_inventory_item_id
    and restaurant_id = target_restaurant_id
    and status = 'active';
  if item_unit_id is null then
    raise exception 'Inventory item is invalid.';
  end if;

  if target_movement_type in ('transfer_in','transfer_out') then
    raise exception 'Use the inventory transfer RPC for transfers.';
  end if;

  final_effect := coalesce(public.inventory_movement_expected_effect(target_movement_type), target_quantity_effect);
  if final_effect not in ('in','out') then
    raise exception 'Movement direction is required.';
  end if;

  insert into public.inventory_movements(
    restaurant_id,
    inventory_item_id,
    storage_location_id,
    supplier_id,
    unit_id,
    unit_name,
    movement_type,
    quantity,
    quantity_effect,
    reference_number,
    invoice_number,
    reason,
    notes,
    movement_date,
    created_by_staff_id
  )
  values(
    target_restaurant_id,
    target_inventory_item_id,
    target_storage_location_id,
    target_supplier_id,
    item_unit_id,
    'pending',
    target_movement_type,
    target_quantity,
    final_effect,
    target_reference_number,
    target_invoice_number,
    target_reason,
    target_notes,
    coalesce(target_movement_date, now()),
    actor_id
  )
  returning id into new_id;

  return new_id;
end $$;

create or replace function public.record_inventory_transfer(
  target_restaurant_id uuid,
  target_inventory_item_id uuid,
  target_from_storage_location_id uuid,
  target_to_storage_location_id uuid,
  target_quantity numeric,
  target_reference_number text default null,
  target_reason text default null,
  target_notes text default null,
  target_movement_date timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_id uuid;
  item_unit_id uuid;
  group_id uuid := gen_random_uuid();
begin
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then
    raise exception 'Inventory transfer access denied.';
  end if;

  if target_from_storage_location_id = target_to_storage_location_id then
    raise exception 'Transfer locations must be different.';
  end if;
  if target_quantity is null or target_quantity <= 0 then
    raise exception 'Transfer quantity must be greater than zero.';
  end if;

  select unit_id into item_unit_id
  from public.inventory_items
  where id = target_inventory_item_id
    and restaurant_id = target_restaurant_id
    and status = 'active';
  if item_unit_id is null then
    raise exception 'Inventory item is invalid.';
  end if;

  if public.get_inventory_storage_balance(target_restaurant_id, target_inventory_item_id, target_from_storage_location_id) < target_quantity then
    raise exception 'Transfer would create negative stock.';
  end if;

  if nullif(btrim(coalesce(target_reference_number, '')), '') is not null and exists (
    select 1
    from public.inventory_movements out_move
    join public.inventory_movements in_move
      on in_move.restaurant_id = out_move.restaurant_id
     and in_move.transfer_group_id = out_move.transfer_group_id
     and in_move.inventory_item_id = out_move.inventory_item_id
     and in_move.movement_type = 'transfer_in'
    where out_move.restaurant_id = target_restaurant_id
      and out_move.inventory_item_id = target_inventory_item_id
      and out_move.storage_location_id = target_from_storage_location_id
      and in_move.storage_location_id = target_to_storage_location_id
      and out_move.movement_type = 'transfer_out'
      and out_move.reference_number = nullif(btrim(target_reference_number), '')
  ) then
    raise exception 'Duplicate transfer reference.';
  end if;

  insert into public.inventory_movements(
    restaurant_id, inventory_item_id, storage_location_id, unit_id, unit_name,
    movement_type, quantity, quantity_effect, reference_number, reason, notes,
    transfer_group_id, movement_date, created_by_staff_id
  )
  values
    (target_restaurant_id, target_inventory_item_id, target_from_storage_location_id, item_unit_id, 'pending',
     'transfer_out', target_quantity, 'out', target_reference_number, target_reason, target_notes,
     group_id, coalesce(target_movement_date, now()), actor_id),
    (target_restaurant_id, target_inventory_item_id, target_to_storage_location_id, item_unit_id, 'pending',
     'transfer_in', target_quantity, 'in', target_reference_number, target_reason, target_notes,
     group_id, coalesce(target_movement_date, now()), actor_id);

  return group_id;
end $$;

create or replace function public.record_inventory_adjustment(
  target_restaurant_id uuid,
  target_inventory_item_id uuid,
  target_storage_location_id uuid,
  target_quantity numeric,
  target_direction text,
  target_reason text,
  target_notes text default null,
  target_movement_date timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  target_type public.inventory_movement_type;
begin
  if nullif(btrim(coalesce(target_reason, '')), '') is null then
    raise exception 'Adjustment reason is required.';
  end if;
  if target_direction = 'increase' then
    target_type := 'adjustment_increase';
  elsif target_direction = 'decrease' then
    target_type := 'adjustment_decrease';
  else
    raise exception 'Adjustment direction is invalid.';
  end if;

  return public.record_inventory_movement(
    target_restaurant_id,
    target_inventory_item_id,
    target_storage_location_id,
    target_type,
    target_quantity,
    null,
    null,
    null,
    null,
    target_reason,
    target_notes,
    target_movement_date
  );
end $$;

create or replace function public.record_inventory_waste(
  target_restaurant_id uuid,
  target_inventory_item_id uuid,
  target_storage_location_id uuid,
  target_quantity numeric,
  target_reason text,
  target_is_spoilage boolean default false,
  target_notes text default null,
  target_movement_date timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
begin
  if nullif(btrim(coalesce(target_reason, '')), '') is null then
    raise exception 'Waste reason is required.';
  end if;

  return public.record_inventory_movement(
    target_restaurant_id,
    target_inventory_item_id,
    target_storage_location_id,
    case when target_is_spoilage then 'spoilage'::public.inventory_movement_type else 'waste'::public.inventory_movement_type end,
    target_quantity,
    null,
    null,
    null,
    null,
    target_reason,
    target_notes,
    target_movement_date
  );
end $$;

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
set search_path=public
as $$
declare
  actor_id uuid;
begin
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then
    raise exception 'Opening balance access denied.';
  end if;

  if exists (
    select 1
    from public.inventory_movements m
    where m.restaurant_id = target_restaurant_id
      and m.inventory_item_id = target_inventory_item_id
      and m.storage_location_id = target_storage_location_id
  ) then
    raise exception 'Opening balance can only be recorded before other movements.';
  end if;

  return public.record_inventory_movement(
    target_restaurant_id,
    target_inventory_item_id,
    target_storage_location_id,
    'opening_balance',
    target_quantity,
    null,
    null,
    target_reference_number,
    null,
    null,
    target_notes,
    target_movement_date
  );
end $$;

create or replace function public.get_inventory_balances(target_restaurant_id uuid)
returns table(
  inventory_item_id uuid,
  storage_location_id uuid,
  unit_id uuid,
  unit_name text,
  balance numeric
)
language sql
stable
security definer
set search_path=public
as $$
  select
    m.inventory_item_id,
    m.storage_location_id,
    m.unit_id,
    max(m.unit_name) as unit_name,
    coalesce(sum(public.inventory_movement_signed_quantity(m.quantity, m.quantity_effect)), 0)::numeric(12,3) as balance
  from public.inventory_movements m
  where m.restaurant_id = target_restaurant_id
    and public.inventory_admin_has_access(target_restaurant_id)
  group by m.inventory_item_id, m.storage_location_id, m.unit_id;
$$;

create or replace function public.get_inventory_current_stock(target_restaurant_id uuid)
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
set search_path=public
as $$
  with movement_balances as (
    select
      m.inventory_item_id,
      m.storage_location_id,
      max(m.movement_date) as last_movement_at,
      coalesce(sum(public.inventory_movement_signed_quantity(m.quantity, m.quantity_effect)), 0)::numeric(12,3) as current_quantity
    from public.inventory_movements m
    where m.restaurant_id = target_restaurant_id
      and public.inventory_admin_has_access(target_restaurant_id)
    group by m.inventory_item_id, m.storage_location_id
  ),
  item_locations as (
    select i.id as inventory_item_id, i.storage_location_id
    from public.inventory_items i
    where i.restaurant_id = target_restaurant_id
      and i.status = 'active'
      and public.inventory_admin_has_access(target_restaurant_id)
    union
    select b.inventory_item_id, b.storage_location_id
    from movement_balances b
  )
  select
    i.id as inventory_item_id,
    i.name as item_name,
    i.category_id,
    c.name as category_name,
    l.id as storage_location_id,
    l.name as storage_location_name,
    i.unit_id,
    u.name as unit_name,
    i.minimum_stock,
    i.maximum_stock,
    coalesce(b.current_quantity, 0)::numeric(12,3) as current_quantity,
    case
      when coalesce(b.current_quantity, 0) <= 0 then 'out_of_stock'
      when i.minimum_stock > 0 and coalesce(b.current_quantity, 0) <= i.minimum_stock then 'low_stock'
      when i.maximum_stock is not null and coalesce(b.current_quantity, 0) > i.maximum_stock then 'over_stock'
      else 'in_stock'
    end as stock_status,
    b.last_movement_at
  from item_locations il
  join public.inventory_items i
    on i.id = il.inventory_item_id
   and i.restaurant_id = target_restaurant_id
   and i.status = 'active'
  join public.inventory_storage_locations l
    on l.id = il.storage_location_id
   and l.restaurant_id = target_restaurant_id
   and l.status = 'active'
  join public.inventory_units u
    on u.id = i.unit_id
   and u.restaurant_id = target_restaurant_id
  left join public.inventory_categories c
    on c.id = i.category_id
   and c.restaurant_id = target_restaurant_id
  left join movement_balances b
    on b.inventory_item_id = il.inventory_item_id
   and b.storage_location_id = il.storage_location_id
  order by i.name, l.name;
$$;

create or replace function public.get_inventory_ledger(
  target_restaurant_id uuid,
  target_inventory_item_id uuid default null,
  target_storage_location_id uuid default null,
  target_limit integer default 200
)
returns table(
  id uuid,
  inventory_item_id uuid,
  item_name text,
  storage_location_id uuid,
  storage_location_name text,
  supplier_id uuid,
  supplier_name text,
  movement_type public.inventory_movement_type,
  quantity numeric,
  quantity_effect text,
  signed_quantity numeric,
  unit_name text,
  reference_number text,
  invoice_number text,
  reason text,
  notes text,
  transfer_group_id uuid,
  movement_date timestamptz,
  created_by_staff_id uuid,
  staff_name text
)
language sql
stable
security definer
set search_path=public
as $$
  select
    m.id,
    m.inventory_item_id,
    i.name as item_name,
    m.storage_location_id,
    l.name as storage_location_name,
    m.supplier_id,
    s.name as supplier_name,
    m.movement_type,
    m.quantity,
    m.quantity_effect,
    public.inventory_movement_signed_quantity(m.quantity, m.quantity_effect)::numeric(12,3) as signed_quantity,
    m.unit_name,
    m.reference_number,
    m.invoice_number,
    m.reason,
    m.notes,
    m.transfer_group_id,
    m.movement_date,
    m.created_by_staff_id,
    coalesce(st.display_name, st.email, st.role::text) as staff_name
  from public.inventory_movements m
  join public.inventory_items i
    on i.id = m.inventory_item_id
   and i.restaurant_id = m.restaurant_id
  join public.inventory_storage_locations l
    on l.id = m.storage_location_id
   and l.restaurant_id = m.restaurant_id
  left join public.inventory_suppliers s
    on s.id = m.supplier_id
   and s.restaurant_id = m.restaurant_id
  left join public.restaurant_staff st
    on st.id = m.created_by_staff_id
   and st.restaurant_id = m.restaurant_id
  where m.restaurant_id = target_restaurant_id
    and (target_inventory_item_id is null or m.inventory_item_id = target_inventory_item_id)
    and (target_storage_location_id is null or m.storage_location_id = target_storage_location_id)
    and public.inventory_admin_has_access(target_restaurant_id)
  order by m.movement_date desc, m.created_at desc, m.id desc
  limit least(greatest(coalesce(target_limit, 200), 1), 500);
$$;

create or replace function public.get_inventory_item_ledger(
  target_restaurant_id uuid,
  target_inventory_item_id uuid,
  target_storage_location_id uuid default null
)
returns table(
  id uuid,
  movement_date timestamptz,
  movement_type public.inventory_movement_type,
  reference_number text,
  quantity numeric,
  quantity_effect text,
  balance_after_movement numeric,
  storage_location_id uuid,
  supplier_id uuid,
  created_by_staff_id uuid,
  notes text,
  reason text
)
language sql
stable
security definer
set search_path=public
as $$
  with scoped as (
    select
      m.*,
      public.inventory_movement_signed_quantity(m.quantity, m.quantity_effect) as signed_quantity
    from public.inventory_movements m
    where m.restaurant_id = target_restaurant_id
      and m.inventory_item_id = target_inventory_item_id
      and (target_storage_location_id is null or m.storage_location_id = target_storage_location_id)
      and public.inventory_admin_has_access(target_restaurant_id)
  )
  select
    id,
    movement_date,
    movement_type,
    reference_number,
    quantity,
    quantity_effect,
    sum(signed_quantity) over(order by movement_date, created_at, id rows unbounded preceding)::numeric(12,3) as balance_after_movement,
    storage_location_id,
    supplier_id,
    created_by_staff_id,
    notes,
    reason
  from scoped
  order by movement_date desc, created_at desc, id desc;
$$;

revoke all on public.inventory_movements from public, anon;
grant select, insert on public.inventory_movements to authenticated;

revoke all on function public.record_inventory_movement(uuid,uuid,uuid,public.inventory_movement_type,numeric,text,uuid,text,text,text,text,timestamptz) from public, anon;
revoke all on function public.record_inventory_transfer(uuid,uuid,uuid,uuid,numeric,text,text,text,timestamptz) from public, anon;
revoke all on function public.record_inventory_adjustment(uuid,uuid,uuid,numeric,text,text,text,timestamptz) from public, anon;
revoke all on function public.record_inventory_waste(uuid,uuid,uuid,numeric,text,boolean,text,timestamptz) from public, anon;
revoke all on function public.record_inventory_opening_balance(uuid,uuid,uuid,numeric,text,text,timestamptz) from public, anon;
revoke all on function public.get_inventory_storage_balance(uuid,uuid,uuid) from public, anon;
revoke all on function public.get_inventory_balances(uuid) from public, anon;
revoke all on function public.get_inventory_current_stock(uuid) from public, anon;
revoke all on function public.get_inventory_ledger(uuid,uuid,uuid,integer) from public, anon;
revoke all on function public.get_inventory_item_ledger(uuid,uuid,uuid) from public, anon;
grant execute on function public.record_inventory_movement(uuid,uuid,uuid,public.inventory_movement_type,numeric,text,uuid,text,text,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.record_inventory_transfer(uuid,uuid,uuid,uuid,numeric,text,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.record_inventory_adjustment(uuid,uuid,uuid,numeric,text,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.record_inventory_waste(uuid,uuid,uuid,numeric,text,boolean,text,timestamptz) to authenticated, service_role;
grant execute on function public.record_inventory_opening_balance(uuid,uuid,uuid,numeric,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.get_inventory_storage_balance(uuid,uuid,uuid) to authenticated, service_role;
grant execute on function public.get_inventory_balances(uuid) to authenticated, service_role;
grant execute on function public.get_inventory_current_stock(uuid) to authenticated, service_role;
grant execute on function public.get_inventory_ledger(uuid,uuid,uuid,integer) to authenticated, service_role;
grant execute on function public.get_inventory_item_ledger(uuid,uuid,uuid) to authenticated, service_role;
