-- SERVEFLOW Phase 4B: Kitchen station collaboration.
-- Adds station-level progress as the source of truth for collaborative kitchen
-- work while preserving the existing order workflow used by cashier collection.

alter type public.staff_activity_action add value if not exists 'kitchen_station_started';
alter type public.staff_activity_action add value if not exists 'kitchen_station_ready';
alter type public.staff_activity_action add value if not exists 'kitchen_station_completed';
alter type public.staff_activity_action add value if not exists 'kitchen_order_completed';

create table if not exists public.kitchen_order_station_progress (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null,
  kitchen_station_id uuid not null,
  station_status text not null default 'waiting',
  item_count integer not null default 0,
  ready_count integer not null default 0,
  completed_count integer not null default 0,
  started_at timestamptz,
  started_by uuid,
  ready_at timestamptz,
  ready_by uuid,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, order_id, kitchen_station_id),
  constraint kitchen_order_station_progress_order_same_restaurant
    foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id)
    on delete cascade,
  constraint kitchen_order_station_progress_station_same_restaurant
    foreign key (restaurant_id, kitchen_station_id)
    references public.kitchen_stations (restaurant_id, id)
    on delete restrict,
  constraint kitchen_order_station_progress_started_by_same_restaurant
    foreign key (restaurant_id, started_by)
    references public.restaurant_staff (restaurant_id, id),
  constraint kitchen_order_station_progress_ready_by_same_restaurant
    foreign key (restaurant_id, ready_by)
    references public.restaurant_staff (restaurant_id, id),
  constraint kitchen_order_station_progress_completed_by_same_restaurant
    foreign key (restaurant_id, completed_by)
    references public.restaurant_staff (restaurant_id, id),
  constraint kitchen_order_station_progress_status_allowed
    check (station_status in ('waiting', 'preparing', 'ready', 'completed')),
  constraint kitchen_order_station_progress_counts_valid
    check (
      item_count >= 0
      and ready_count >= 0
      and completed_count >= 0
      and completed_count <= ready_count
      and ready_count <= item_count
    )
);

create index if not exists kitchen_order_station_progress_order_idx
on public.kitchen_order_station_progress (restaurant_id, order_id);

create index if not exists kitchen_order_station_progress_station_status_idx
on public.kitchen_order_station_progress (restaurant_id, kitchen_station_id, station_status);

alter table public.kitchen_order_station_progress enable row level security;

revoke all on public.kitchen_order_station_progress from anon, authenticated;
grant select, update on public.kitchen_order_station_progress to authenticated;

drop policy if exists kitchen_order_station_progress_select_owner_or_station on public.kitchen_order_station_progress;
create policy kitchen_order_station_progress_select_owner_or_station
on public.kitchen_order_station_progress
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
  or (
    public.has_staff_role(restaurant_id, array['kitchen']::public.restaurant_staff_role[])
    and kitchen_station_id = public.current_kitchen_staff_station(restaurant_id)
  )
);

drop policy if exists kitchen_order_station_progress_update_own_station on public.kitchen_order_station_progress;
create policy kitchen_order_station_progress_update_own_station
on public.kitchen_order_station_progress
for update
to authenticated
using (
  public.has_staff_role(restaurant_id, array['kitchen']::public.restaurant_staff_role[])
  and kitchen_station_id = public.current_kitchen_staff_station(restaurant_id)
)
with check (
  public.has_staff_role(restaurant_id, array['kitchen']::public.restaurant_staff_role[])
  and kitchen_station_id = public.current_kitchen_staff_station(restaurant_id)
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'kitchen_order_station_progress'
     ) then
    alter publication supabase_realtime add table public.kitchen_order_station_progress;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'orders'
     ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;

create or replace function public.refresh_kitchen_order_station_progress(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
begin
  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    return;
  end if;

  insert into public.kitchen_order_station_progress (
    restaurant_id,
    order_id,
    kitchen_station_id,
    station_status,
    item_count,
    ready_count,
    completed_count,
    started_at,
    started_by,
    ready_at,
    ready_by,
    completed_at,
    completed_by,
    updated_at
  )
  select
    items.restaurant_id,
    items.order_id,
    items.kitchen_station_id,
    case
      when count(*) filter (where items.kitchen_status = 'completed') = count(*) then 'completed'
      when count(*) filter (where items.kitchen_status in ('ready', 'completed')) = count(*) then 'ready'
      when count(*) filter (where items.kitchen_status = 'paid') = count(*) then 'waiting'
      else 'preparing'
    end,
    count(*)::integer,
    count(*) filter (where items.kitchen_status in ('ready', 'completed'))::integer,
    count(*) filter (where items.kitchen_status = 'completed')::integer,
    min(items.kitchen_preparation_started_at),
    (array_remove(array_agg(items.kitchen_preparation_started_by order by items.kitchen_preparation_started_at asc nulls last), null))[1],
    max(items.kitchen_ready_marked_at),
    (array_remove(array_agg(items.kitchen_ready_marked_by order by items.kitchen_ready_marked_at desc nulls last), null))[1],
    max(items.kitchen_completed_at),
    (array_remove(array_agg(items.kitchen_completed_by order by items.kitchen_completed_at desc nulls last), null))[1],
    now()
  from public.order_items items
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_station_id is not null
  group by items.restaurant_id, items.order_id, items.kitchen_station_id
  on conflict (restaurant_id, order_id, kitchen_station_id) do update
  set
    station_status = excluded.station_status,
    item_count = excluded.item_count,
    ready_count = excluded.ready_count,
    completed_count = excluded.completed_count,
    started_at = excluded.started_at,
    started_by = excluded.started_by,
    ready_at = excluded.ready_at,
    ready_by = excluded.ready_by,
    completed_at = excluded.completed_at,
    completed_by = excluded.completed_by,
    updated_at = now();

  delete from public.kitchen_order_station_progress progress
  where progress.restaurant_id = target_order.restaurant_id
    and progress.order_id = target_order.id
    and not exists (
      select 1
      from public.order_items items
      where items.restaurant_id = progress.restaurant_id
        and items.order_id = progress.order_id
        and items.kitchen_station_id = progress.kitchen_station_id
    );
end;
$$;

create or replace function public.derive_order_status_from_items(
  target_order_id uuid,
  acting_staff_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  next_status public.order_status;
  updated_order public.orders;
  station_count integer;
  was_completed boolean;
begin
  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  if target_order.status::text in ('pending', 'pending_payment', 'cancelled') then
    return target_order;
  end if;

  perform public.refresh_kitchen_order_station_progress(target_order.id);

  select
    count(*)::integer,
    case
      when count(*) = 0 then target_order.status
      when bool_or(progress.station_status = 'waiting') then 'paid'::public.order_status
      when bool_or(progress.station_status = 'preparing') then 'preparing'::public.order_status
      when bool_and(progress.station_status = 'completed') then 'completed'::public.order_status
      else 'ready'::public.order_status
    end
  into station_count, next_status
  from public.kitchen_order_station_progress progress
  where progress.restaurant_id = target_order.restaurant_id
    and progress.order_id = target_order.id;

  was_completed := target_order.status::text = 'completed';

  update public.orders
  set
    status = next_status,
    preparation_started_at = case
      when next_status::text in ('preparing', 'ready', 'completed') and preparation_started_at is null then (
        select min(progress.started_at)
        from public.kitchen_order_station_progress progress
        where progress.restaurant_id = target_order.restaurant_id
          and progress.order_id = target_order.id
          and progress.started_at is not null
      )
      else preparation_started_at
    end,
    preparation_started_by = case
      when next_status::text in ('preparing', 'ready', 'completed') and preparation_started_by is null and acting_staff_id is not null then acting_staff_id
      else preparation_started_by
    end,
    ready_marked_at = case
      when next_status::text in ('ready', 'completed') then (
        select max(progress.ready_at)
        from public.kitchen_order_station_progress progress
        where progress.restaurant_id = target_order.restaurant_id
          and progress.order_id = target_order.id
          and progress.ready_at is not null
      )
      else ready_marked_at
    end,
    ready_marked_by = case
      when next_status::text in ('ready', 'completed') and acting_staff_id is not null then acting_staff_id
      else ready_marked_by
    end,
    completed_at = case
      when next_status::text = 'completed' then (
        select max(progress.completed_at)
        from public.kitchen_order_station_progress progress
        where progress.restaurant_id = target_order.restaurant_id
          and progress.order_id = target_order.id
          and progress.completed_at is not null
      )
      else completed_at
    end,
    completed_by = case
      when next_status::text = 'completed' and acting_staff_id is not null then acting_staff_id
      else completed_by
    end
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

  if next_status::text = 'completed' and not was_completed and acting_staff_id is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      acting_staff_id,
      'kitchen_order_completed',
      null,
      jsonb_build_object(
        'order_id', target_order.id,
        'station_count', station_count
      )
    );
  end if;

  return updated_order;
end;
$$;

create or replace function public.reconcile_order_status_from_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_order_id uuid;
begin
  changed_order_id := coalesce(new.order_id, old.order_id);
  perform public.derive_order_status_from_items(changed_order_id, null);
  return coalesce(new, old);
end;
$$;

drop trigger if exists reconcile_order_status_from_item_change on public.order_items;
create trigger reconcile_order_status_from_item_change
after insert or update of kitchen_status, kitchen_station_id or delete on public.order_items
for each row
execute function public.reconcile_order_status_from_item_change();

insert into public.kitchen_order_station_progress (
  restaurant_id,
  order_id,
  kitchen_station_id,
  station_status,
  item_count,
  ready_count,
  completed_count,
  started_at,
  started_by,
  ready_at,
  ready_by,
  completed_at,
  completed_by
)
select
  items.restaurant_id,
  items.order_id,
  items.kitchen_station_id,
  case
    when count(*) filter (where items.kitchen_status = 'completed') = count(*) then 'completed'
    when count(*) filter (where items.kitchen_status in ('ready', 'completed')) = count(*) then 'ready'
    when count(*) filter (where items.kitchen_status = 'paid') = count(*) then 'waiting'
    else 'preparing'
  end,
  count(*)::integer,
  count(*) filter (where items.kitchen_status in ('ready', 'completed'))::integer,
  count(*) filter (where items.kitchen_status = 'completed')::integer,
  min(items.kitchen_preparation_started_at),
  (array_remove(array_agg(items.kitchen_preparation_started_by order by items.kitchen_preparation_started_at asc nulls last), null))[1],
  max(items.kitchen_ready_marked_at),
  (array_remove(array_agg(items.kitchen_ready_marked_by order by items.kitchen_ready_marked_at desc nulls last), null))[1],
  max(items.kitchen_completed_at),
  (array_remove(array_agg(items.kitchen_completed_by order by items.kitchen_completed_at desc nulls last), null))[1]
from public.order_items items
where items.kitchen_station_id is not null
group by items.restaurant_id, items.order_id, items.kitchen_station_id
on conflict (restaurant_id, order_id, kitchen_station_id) do nothing;

create or replace function public.start_order_preparation(
  target_order_id uuid,
  target_station_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  effective_station_id uuid;
  updated_count integer;
  updated_order public.orders;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to start order preparation.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('kitchen', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may start order preparation.';
  end if;

  if target_order.status::text not in ('paid', 'preparing', 'ready') then
    raise exception 'Only active paid kitchen orders may be started.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      update public.restaurant_staff
      set assigned_kitchen_station_id = public.ensure_main_kitchen_station_for_restaurant(target_order.restaurant_id)
      where id = acting_staff.id
        and restaurant_id = acting_staff.restaurant_id
        and assigned_kitchen_station_id is null
      returning * into acting_staff;
    end if;
    effective_station_id := acting_staff.assigned_kitchen_station_id;
  else
    if target_station_id is null then
      raise exception 'Choose a kitchen station before starting preparation.';
    end if;

    select stations.id
    into effective_station_id
    from public.kitchen_stations stations
    where stations.id = target_station_id
      and stations.restaurant_id = target_order.restaurant_id
      and stations.active = true
      and stations.archived_at is null;
  end if;

  if effective_station_id is null then
    raise exception 'Kitchen station not found.';
  end if;

  update public.order_items items
  set
    kitchen_status = 'preparing',
    kitchen_preparation_started_at = coalesce(kitchen_preparation_started_at, now()),
    kitchen_preparation_started_by = coalesce(kitchen_preparation_started_by, acting_staff.id)
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_station_id = effective_station_id
    and items.kitchen_status = 'paid';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'No pending items were found for this station.';
  end if;

  updated_order := public.derive_order_status_from_items(target_order.id, acting_staff.id);

  perform public.log_staff_activity(
    target_order.restaurant_id,
    acting_staff.id,
    'kitchen_station_started',
    null,
    jsonb_build_object(
      'order_id', target_order.id,
      'table_number', updated_order.table_number,
      'kitchen_station_id', effective_station_id,
      'item_count', updated_count
    )
  );

  return updated_order;
end;
$$;

create or replace function public.mark_order_ready(
  target_order_id uuid,
  target_station_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  effective_station_id uuid;
  updated_count integer;
  updated_order public.orders;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to mark an order ready.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('kitchen', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may mark orders ready.';
  end if;

  if target_order.status::text not in ('paid', 'preparing', 'ready') then
    raise exception 'Only active kitchen orders may be marked ready.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      update public.restaurant_staff
      set assigned_kitchen_station_id = public.ensure_main_kitchen_station_for_restaurant(target_order.restaurant_id)
      where id = acting_staff.id
        and restaurant_id = acting_staff.restaurant_id
        and assigned_kitchen_station_id is null
      returning * into acting_staff;
    end if;
    effective_station_id := acting_staff.assigned_kitchen_station_id;
  else
    if target_station_id is null then
      raise exception 'Choose a kitchen station before marking items ready.';
    end if;

    select stations.id
    into effective_station_id
    from public.kitchen_stations stations
    where stations.id = target_station_id
      and stations.restaurant_id = target_order.restaurant_id
      and stations.active = true
      and stations.archived_at is null;
  end if;

  if effective_station_id is null then
    raise exception 'Kitchen station not found.';
  end if;

  update public.order_items items
  set
    kitchen_status = 'ready',
    kitchen_ready_marked_at = coalesce(kitchen_ready_marked_at, now()),
    kitchen_ready_marked_by = coalesce(kitchen_ready_marked_by, acting_staff.id)
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_station_id = effective_station_id
    and items.kitchen_status = 'preparing';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'No preparing items were found for this station.';
  end if;

  updated_order := public.derive_order_status_from_items(target_order.id, acting_staff.id);

  perform public.log_staff_activity(
    target_order.restaurant_id,
    acting_staff.id,
    'kitchen_station_ready',
    null,
    jsonb_build_object(
      'order_id', target_order.id,
      'table_number', updated_order.table_number,
      'kitchen_station_id', effective_station_id,
      'item_count', updated_count
    )
  );

  return updated_order;
end;
$$;

create or replace function public.mark_order_completed(
  target_order_id uuid,
  target_station_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  effective_station_id uuid;
  updated_count integer;
  updated_order public.orders;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to complete an order.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('kitchen', 'cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active restaurant staff may complete orders.';
  end if;

  if target_order.status::text not in ('paid', 'preparing', 'ready') then
    raise exception 'Only active kitchen items may be completed.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      update public.restaurant_staff
      set assigned_kitchen_station_id = public.ensure_main_kitchen_station_for_restaurant(target_order.restaurant_id)
      where id = acting_staff.id
        and restaurant_id = acting_staff.restaurant_id
        and assigned_kitchen_station_id is null
      returning * into acting_staff;
    end if;
    effective_station_id := acting_staff.assigned_kitchen_station_id;
  elsif acting_staff.role = 'owner' then
    if target_station_id is null then
      raise exception 'Choose a kitchen station before completing items.';
    end if;

    select stations.id
    into effective_station_id
    from public.kitchen_stations stations
    where stations.id = target_station_id
      and stations.restaurant_id = target_order.restaurant_id
      and stations.active = true
      and stations.archived_at is null;
  else
    effective_station_id := null;
  end if;

  if acting_staff.role in ('kitchen', 'owner') and effective_station_id is null then
    raise exception 'Kitchen station not found.';
  end if;

  if acting_staff.role = 'cashier' then
    if exists (
      select 1
      from public.order_items items
      where items.restaurant_id = target_order.restaurant_id
        and items.order_id = target_order.id
        and items.kitchen_status not in ('ready', 'completed')
    ) then
      raise exception 'All kitchen items must be ready before the order can be completed.';
    end if;

    update public.order_items items
    set
      kitchen_status = 'completed',
      kitchen_completed_at = coalesce(kitchen_completed_at, now()),
      kitchen_completed_by = coalesce(kitchen_completed_by, acting_staff.id)
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and items.kitchen_status = 'ready';
  else
    if exists (
      select 1
      from public.order_items items
      where items.restaurant_id = target_order.restaurant_id
        and items.order_id = target_order.id
        and items.kitchen_station_id = effective_station_id
        and items.kitchen_status <> 'ready'
    ) then
      raise exception 'Every routed item for this station must be ready before completing the station.';
    end if;

    update public.order_items items
    set
      kitchen_status = 'completed',
      kitchen_completed_at = coalesce(kitchen_completed_at, now()),
      kitchen_completed_by = coalesce(kitchen_completed_by, acting_staff.id)
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and items.kitchen_station_id = effective_station_id
      and items.kitchen_status = 'ready';
  end if;

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'No ready items were found to complete.';
  end if;

  updated_order := public.derive_order_status_from_items(target_order.id, acting_staff.id);

  if acting_staff.role in ('kitchen', 'owner') then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      acting_staff.id,
      'kitchen_station_completed',
      null,
      jsonb_build_object(
        'order_id', target_order.id,
        'table_number', updated_order.table_number,
        'kitchen_station_id', effective_station_id,
        'item_count', updated_count
      )
    );
  end if;

  return updated_order;
end;
$$;

drop function if exists public.get_station_kitchen_orders(uuid, uuid, boolean, boolean);

create or replace function public.get_station_kitchen_orders(
  target_restaurant_id uuid,
  target_station_id uuid default null,
  include_all_stations boolean default false,
  log_queue_view boolean default false
)
returns table (
  id uuid,
  status text,
  customer_name text,
  table_number text,
  payment_method text,
  total_price numeric,
  created_at timestamptz,
  payment_verified_at timestamptz,
  preparation_started_at timestamptz,
  ready_marked_at timestamptz,
  items jsonb,
  station_progress jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  effective_station_id uuid;
  selected_station public.kitchen_stations;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view kitchen orders.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role in ('kitchen', 'owner')
    and active = true
  order by created_at asc
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may view kitchen orders.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      update public.restaurant_staff
      set assigned_kitchen_station_id = public.ensure_main_kitchen_station_for_restaurant(target_restaurant_id)
      where id = acting_staff.id
        and restaurant_id = acting_staff.restaurant_id
        and assigned_kitchen_station_id is null
      returning * into acting_staff;
    end if;

    effective_station_id := acting_staff.assigned_kitchen_station_id;
  elsif include_all_stations then
    effective_station_id := null;
  elsif target_station_id is not null then
    select *
    into selected_station
    from public.kitchen_stations
    where kitchen_stations.id = target_station_id
      and kitchen_stations.restaurant_id = target_restaurant_id
      and kitchen_stations.archived_at is null;

    if selected_station.id is null then
      raise exception 'Kitchen station not found.';
    end if;

    effective_station_id := target_station_id;
  else
    effective_station_id := null;
  end if;

  if log_queue_view then
    perform public.log_staff_activity(
      target_restaurant_id,
      acting_staff.id,
      'kitchen_station_queue_viewed',
      null,
      jsonb_build_object(
        'mode', case when acting_staff.role = 'owner' and effective_station_id is null then 'all_stations' else 'station' end,
        'station_id', effective_station_id,
        'role', acting_staff.role::text
      )
    );
  end if;

  return query
  with active_orders as (
    select distinct orders.id
    from public.orders orders
    join public.order_items items
      on items.restaurant_id = orders.restaurant_id
     and items.order_id = orders.id
    where orders.restaurant_id = target_restaurant_id
      and orders.status::text in ('paid', 'preparing', 'ready')
      and items.kitchen_status in ('paid', 'preparing', 'ready')
      and (effective_station_id is null or items.kitchen_station_id = effective_station_id)
  )
  select
    orders.id,
    case
      when effective_station_id is null then orders.status::text
      when max(progress.station_status) = 'waiting' then 'paid'
      else max(progress.station_status)
    end as status,
    orders.customer_name,
    orders.table_number,
    orders.payment_method,
    coalesce(sum(items.price * items.quantity), 0)::numeric as total_price,
    orders.created_at,
    orders.payment_verified_at,
    coalesce(min(items.kitchen_preparation_started_at), orders.preparation_started_at) as preparation_started_at,
    coalesce(max(items.kitchen_ready_marked_at), orders.ready_marked_at) as ready_marked_at,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', items.id,
        'order_id', items.order_id,
        'quantity', items.quantity,
        'price', items.price,
        'notes', items.notes,
        'appended_at', items.appended_at,
        'kitchen_station_id', items.kitchen_station_id,
        'kitchen_station_name', stations.name,
        'kitchen_status', items.kitchen_status,
        'menu_item_name', menu_items.name
      )
      order by items.created_at asc, items.id asc
    ), '[]'::jsonb) as items,
    (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'station_id', station_progress.kitchen_station_id,
          'station_name', progress_stations.name,
          'station_status', station_progress.station_status,
          'item_count', station_progress.item_count,
          'ready_count', station_progress.ready_count,
          'completed_count', station_progress.completed_count,
          'started_at', station_progress.started_at,
          'ready_at', station_progress.ready_at,
          'completed_at', station_progress.completed_at
        )
        order by progress_stations.priority asc, progress_stations.name asc
      ), '[]'::jsonb)
      from public.kitchen_order_station_progress station_progress
      join public.kitchen_stations progress_stations
        on progress_stations.restaurant_id = station_progress.restaurant_id
       and progress_stations.id = station_progress.kitchen_station_id
      where station_progress.restaurant_id = orders.restaurant_id
        and station_progress.order_id = orders.id
        and (effective_station_id is null or station_progress.kitchen_station_id = effective_station_id)
    ) as station_progress
  from active_orders active
  join public.orders orders
    on orders.id = active.id
   and orders.restaurant_id = target_restaurant_id
  join public.order_items items
    on items.restaurant_id = orders.restaurant_id
   and items.order_id = orders.id
   and items.kitchen_status in ('paid', 'preparing', 'ready')
   and (effective_station_id is null or items.kitchen_station_id = effective_station_id)
  left join public.kitchen_order_station_progress progress
    on progress.restaurant_id = items.restaurant_id
   and progress.order_id = items.order_id
   and progress.kitchen_station_id = items.kitchen_station_id
  left join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  left join public.kitchen_stations stations
    on stations.restaurant_id = items.restaurant_id
   and stations.id = items.kitchen_station_id
  group by orders.id
  order by orders.created_at asc;
end;
$$;

revoke all on function public.refresh_kitchen_order_station_progress(uuid) from public, anon, authenticated;
revoke all on function public.derive_order_status_from_items(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reconcile_order_status_from_item_change() from public, anon, authenticated;
revoke all on function public.start_order_preparation(uuid, uuid) from public, anon;
revoke all on function public.mark_order_ready(uuid, uuid) from public, anon;
revoke all on function public.mark_order_completed(uuid, uuid) from public, anon;
revoke all on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) from public, anon;

grant execute on function public.start_order_preparation(uuid, uuid) to authenticated;
grant execute on function public.mark_order_ready(uuid, uuid) to authenticated;
grant execute on function public.mark_order_completed(uuid, uuid) to authenticated;
grant execute on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) to authenticated;
