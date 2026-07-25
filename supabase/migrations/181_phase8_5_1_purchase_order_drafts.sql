-- ServeFlow Phase 8.5.1: Purchase Order Draft foundation.
-- Draft CRUD and totals only. No receiving, inventory movement, stock increase,
-- accounting, payments, reports, or automatic purchasing workflow.

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  supplier_id uuid not null,
  status text not null default 'draft' check (status = 'draft'),
  expected_delivery_date date not null,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by_staff_id uuid not null,
  updated_by_staff_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_restaurant_id_id_unique unique (restaurant_id, id),
  constraint purchase_orders_supplier_restaurant_fk
    foreign key (restaurant_id, supplier_id)
    references public.inventory_suppliers(restaurant_id, id) on delete restrict,
  constraint purchase_orders_created_by_restaurant_fk
    foreign key (restaurant_id, created_by_staff_id)
    references public.restaurant_staff(restaurant_id, id) on delete restrict,
  constraint purchase_orders_updated_by_restaurant_fk
    foreign key (restaurant_id, updated_by_staff_id)
    references public.restaurant_staff(restaurant_id, id) on delete restrict
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  purchase_order_id uuid not null,
  inventory_item_id uuid not null,
  purchase_unit_id uuid not null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_price numeric(18,6) not null check (unit_price >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_items_order_restaurant_fk
    foreign key (restaurant_id, purchase_order_id)
    references public.purchase_orders(restaurant_id, id) on delete cascade,
  constraint purchase_order_items_inventory_restaurant_fk
    foreign key (restaurant_id, inventory_item_id)
    references public.inventory_items(restaurant_id, id) on delete restrict,
  constraint purchase_order_items_unit_restaurant_fk
    foreign key (restaurant_id, purchase_unit_id)
    references public.inventory_units(restaurant_id, id) on delete restrict,
  constraint purchase_order_items_one_item_per_draft unique (purchase_order_id, inventory_item_id)
);

create index if not exists purchase_orders_restaurant_updated_idx
  on public.purchase_orders(restaurant_id, updated_at desc, id desc);
create index if not exists purchase_orders_restaurant_supplier_idx
  on public.purchase_orders(restaurant_id, supplier_id, updated_at desc);
create index if not exists purchase_order_items_restaurant_order_idx
  on public.purchase_order_items(restaurant_id, purchase_order_id, sort_order, id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists purchase_orders_inventory_staff_select on public.purchase_orders;
create policy purchase_orders_inventory_staff_select on public.purchase_orders
  for select to authenticated
  using (public.inventory_admin_has_access(restaurant_id));

drop policy if exists purchase_order_items_inventory_staff_select on public.purchase_order_items;
create policy purchase_order_items_inventory_staff_select on public.purchase_order_items
  for select to authenticated
  using (public.inventory_admin_has_access(restaurant_id));

revoke all on public.purchase_orders from public, anon, authenticated;
revoke all on public.purchase_order_items from public, anon, authenticated;

create or replace function public.save_purchase_order_draft(
  target_restaurant_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_purchase_order_id uuid := nullif(payload->>'id', '')::uuid;
  target_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid;
  target_expected_delivery_date date := nullif(payload->>'expected_delivery_date', '')::date;
  target_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  target_lines jsonb := payload->'lines';
  actor_id uuid;
  existing_order public.purchase_orders;
  line_count integer;
begin
  if not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Purchase order draft access denied.';
  end if;
  actor_id := public.inventory_admin_actor(target_restaurant_id);
  if actor_id is null then
    raise exception 'Purchase order draft actor is invalid.';
  end if;
  if nullif(lower(btrim(coalesce(payload->>'status', 'draft'))), '') <> 'draft' then
    raise exception 'Only draft purchase orders are supported.';
  end if;
  if target_supplier_id is null or not exists (
    select 1 from public.inventory_suppliers supplier
    where supplier.id = target_supplier_id
      and supplier.restaurant_id = target_restaurant_id
      and supplier.status = 'active'
  ) then
    raise exception 'Purchase order supplier is invalid.';
  end if;
  if target_expected_delivery_date is null then
    raise exception 'Expected delivery date is required.';
  end if;
  if target_notes is not null and char_length(target_notes) > 2000 then
    raise exception 'Purchase order notes are too long.';
  end if;
  if target_lines is null
    or jsonb_typeof(target_lines) <> 'array'
    or jsonb_array_length(target_lines) = 0
  then
    raise exception 'Purchase order draft requires at least one inventory item.';
  end if;

  select count(*) into line_count
  from jsonb_to_recordset(target_lines) line(
    inventory_item_id uuid,
    purchase_unit_id uuid,
    quantity numeric,
    unit_price numeric,
    sort_order integer
  );
  if line_count <> jsonb_array_length(target_lines) then
    raise exception 'Purchase order line is invalid.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(target_lines) line(
      inventory_item_id uuid,
      purchase_unit_id uuid,
      quantity numeric,
      unit_price numeric,
      sort_order integer
    )
    group by line.inventory_item_id
    having count(*) > 1
  ) then
    raise exception 'An inventory item may appear only once in a purchase order draft.';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(target_lines) line(
      inventory_item_id uuid,
      purchase_unit_id uuid,
      quantity numeric,
      unit_price numeric,
      sort_order integer
    )
    left join public.inventory_items item
      on item.id = line.inventory_item_id
     and item.restaurant_id = target_restaurant_id
     and item.status = 'active'
     and item.active = true
    left join public.inventory_units unit
      on unit.id = line.purchase_unit_id
     and unit.restaurant_id = target_restaurant_id
     and unit.status = 'active'
     and unit.active = true
    where item.id is null
      or unit.id is null
      or line.quantity is null
      or line.quantity <= 0
      or line.unit_price is null
      or line.unit_price < 0
      or coalesce(line.sort_order, 0) < 0
  ) then
    raise exception 'Purchase order line contains an invalid item, unit, quantity, or unit price.';
  end if;

  if target_purchase_order_id is null then
    insert into public.purchase_orders(
      restaurant_id, supplier_id, status, expected_delivery_date, notes,
      created_by_staff_id, updated_by_staff_id
    ) values (
      target_restaurant_id, target_supplier_id, 'draft',
      target_expected_delivery_date, target_notes, actor_id, actor_id
    ) returning id into target_purchase_order_id;
  else
    select draft.* into existing_order
    from public.purchase_orders draft
    where draft.id = target_purchase_order_id
      and draft.restaurant_id = target_restaurant_id
    for update;
    if not found then
      raise exception 'Purchase order draft not found.';
    end if;
    if existing_order.status <> 'draft' then
      raise exception 'Only draft purchase orders can be edited.';
    end if;
    update public.purchase_orders
    set supplier_id = target_supplier_id,
        expected_delivery_date = target_expected_delivery_date,
        notes = target_notes,
        updated_by_staff_id = actor_id,
        updated_at = clock_timestamp()
    where id = target_purchase_order_id
      and restaurant_id = target_restaurant_id;
    delete from public.purchase_order_items
    where purchase_order_id = target_purchase_order_id
      and restaurant_id = target_restaurant_id;
  end if;

  insert into public.purchase_order_items(
    restaurant_id, purchase_order_id, inventory_item_id, purchase_unit_id,
    quantity, unit_price, sort_order
  )
  select
    target_restaurant_id,
    target_purchase_order_id,
    line.inventory_item_id,
    line.purchase_unit_id,
    round(line.quantity, 3),
    round(line.unit_price, 6),
    coalesce(line.sort_order, row_number() over(order by line.inventory_item_id)::integer - 1)
  from jsonb_to_recordset(target_lines) line(
    inventory_item_id uuid,
    purchase_unit_id uuid,
    quantity numeric,
    unit_price numeric,
    sort_order integer
  )
  order by coalesce(line.sort_order, 2147483647), line.inventory_item_id;

  return target_purchase_order_id;
end;
$$;

create or replace function public.delete_purchase_order_draft(
  target_restaurant_id uuid,
  target_purchase_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.purchase_orders;
begin
  if not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Purchase order draft access denied.';
  end if;
  select draft.* into target_order
  from public.purchase_orders draft
  where draft.id = target_purchase_order_id
    and draft.restaurant_id = target_restaurant_id
  for update;
  if not found then
    return false;
  end if;
  if target_order.status <> 'draft' then
    raise exception 'Only draft purchase orders can be deleted.';
  end if;
  delete from public.purchase_orders
  where id = target_purchase_order_id
    and restaurant_id = target_restaurant_id;
  return found;
end;
$$;

create or replace function public.get_purchase_order_drafts(
  target_restaurant_id uuid
)
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
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Purchase order draft access denied.';
  end if;
  return query
  select
    draft.id,
    draft.restaurant_id,
    draft.supplier_id,
    supplier.name,
    draft.status,
    draft.expected_delivery_date,
    draft.notes,
    draft.created_by_staff_id,
    coalesce(creator.display_name, creator.email, creator.role::text),
    draft.updated_by_staff_id,
    coalesce(updater.display_name, updater.email, updater.role::text),
    draft.created_at,
    draft.updated_at,
    count(line.id)::bigint,
    coalesce(sum(line.quantity * line.unit_price), 0)::numeric(18,6),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', line.id,
      'inventory_item_id', line.inventory_item_id,
      'inventory_item_name', item.name,
      'purchase_unit_id', line.purchase_unit_id,
      'purchase_unit_name', unit.name,
      'quantity', line.quantity,
      'unit_price', line.unit_price,
      'line_total', line.quantity * line.unit_price,
      'sort_order', line.sort_order
    ) order by line.sort_order, line.id) filter (where line.id is not null), '[]'::jsonb)
  from public.purchase_orders draft
  join public.inventory_suppliers supplier
    on supplier.id = draft.supplier_id
   and supplier.restaurant_id = draft.restaurant_id
  join public.restaurant_staff creator
    on creator.id = draft.created_by_staff_id
   and creator.restaurant_id = draft.restaurant_id
  join public.restaurant_staff updater
    on updater.id = draft.updated_by_staff_id
   and updater.restaurant_id = draft.restaurant_id
  left join public.purchase_order_items line
    on line.purchase_order_id = draft.id
   and line.restaurant_id = draft.restaurant_id
  left join public.inventory_items item
    on item.id = line.inventory_item_id
   and item.restaurant_id = line.restaurant_id
  left join public.inventory_units unit
    on unit.id = line.purchase_unit_id
   and unit.restaurant_id = line.restaurant_id
  where draft.restaurant_id = target_restaurant_id
    and draft.status = 'draft'
  group by draft.id, supplier.name, creator.display_name, creator.email, creator.role,
    updater.display_name, updater.email, updater.role
  order by draft.updated_at desc, draft.id desc;
end;
$$;

revoke all on function public.save_purchase_order_draft(uuid, jsonb) from public, anon;
revoke all on function public.delete_purchase_order_draft(uuid, uuid) from public, anon;
revoke all on function public.get_purchase_order_drafts(uuid) from public, anon;
grant execute on function public.save_purchase_order_draft(uuid, jsonb),
  public.delete_purchase_order_draft(uuid, uuid),
  public.get_purchase_order_drafts(uuid) to authenticated;

comment on table public.purchase_orders is
  'Phase 8.5.1 draft purchase order headers only. Receiving and stock effects are not implemented.';
comment on table public.purchase_order_items is
  'Phase 8.5.1 draft lines. Totals are quantity multiplied by unit price; no inventory effect.';
