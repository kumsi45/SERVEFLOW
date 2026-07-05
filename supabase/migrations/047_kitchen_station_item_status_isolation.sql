-- SERVEFLOW kitchen station item status isolation bugfix.
-- Kitchen workflow actions are station-scoped: one station may only transition
-- its own routed order_items. The parent orders.status is derived from child
-- item kitchen_status values for existing dashboard/report compatibility.

alter table public.order_items
  add column if not exists kitchen_status text not null default 'paid',
  add column if not exists kitchen_preparation_started_at timestamptz,
  add column if not exists kitchen_preparation_started_by uuid,
  add column if not exists kitchen_ready_marked_at timestamptz,
  add column if not exists kitchen_ready_marked_by uuid,
  add column if not exists kitchen_completed_at timestamptz,
  add column if not exists kitchen_completed_by uuid;

alter table public.order_items
  drop constraint if exists order_items_kitchen_status_allowed,
  add constraint order_items_kitchen_status_allowed
    check (kitchen_status in ('paid', 'preparing', 'ready', 'completed'));

alter table public.order_items
  drop constraint if exists order_items_kitchen_preparation_started_by_same_restaurant,
  add constraint order_items_kitchen_preparation_started_by_same_restaurant
    foreign key (restaurant_id, kitchen_preparation_started_by)
    references public.restaurant_staff (restaurant_id, id);

alter table public.order_items
  drop constraint if exists order_items_kitchen_ready_marked_by_same_restaurant,
  add constraint order_items_kitchen_ready_marked_by_same_restaurant
    foreign key (restaurant_id, kitchen_ready_marked_by)
    references public.restaurant_staff (restaurant_id, id);

alter table public.order_items
  drop constraint if exists order_items_kitchen_completed_by_same_restaurant,
  add constraint order_items_kitchen_completed_by_same_restaurant
    foreign key (restaurant_id, kitchen_completed_by)
    references public.restaurant_staff (restaurant_id, id);

create index if not exists order_items_station_kitchen_status_idx
on public.order_items (restaurant_id, order_id, kitchen_station_id, kitchen_status);

update public.order_items items
set kitchen_status = case
  when orders.status::text = 'completed' then 'completed'
  when orders.status::text = 'ready' then 'ready'
  when orders.status::text = 'preparing' then 'preparing'
  else 'paid'
end
from public.orders orders
where orders.id = items.order_id
  and orders.restaurant_id = items.restaurant_id
  and items.kitchen_status = 'paid'
  and orders.status::text in ('preparing', 'ready', 'completed');

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

  select case
    when count(*) = 0 then target_order.status
    when bool_and(items.kitchen_status = 'completed') then 'completed'::public.order_status
    when bool_and(items.kitchen_status in ('ready', 'completed')) then 'ready'::public.order_status
    when bool_or(items.kitchen_status in ('preparing', 'ready', 'completed')) then 'preparing'::public.order_status
    else 'paid'::public.order_status
  end
  into next_status
  from public.order_items items
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id;

  update public.orders
  set
    status = next_status,
    preparation_started_at = case
      when next_status::text in ('preparing', 'ready', 'completed') and preparation_started_at is null and acting_staff_id is not null then now()
      else preparation_started_at
    end,
    preparation_started_by = case
      when next_status::text in ('preparing', 'ready', 'completed') and preparation_started_by is null and acting_staff_id is not null then acting_staff_id
      else preparation_started_by
    end,
    ready_marked_at = case
      when next_status::text in ('ready', 'completed') and ready_marked_at is null and acting_staff_id is not null then now()
      else ready_marked_at
    end,
    ready_marked_by = case
      when next_status::text in ('ready', 'completed') and ready_marked_by is null and acting_staff_id is not null then acting_staff_id
      else ready_marked_by
    end,
    completed_at = case
      when next_status::text = 'completed' and completed_at is null and acting_staff_id is not null then now()
      else completed_at
    end,
    completed_by = case
      when next_status::text = 'completed' and completed_by is null and acting_staff_id is not null then acting_staff_id
      else completed_by
    end
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

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
after insert or update of kitchen_status on public.order_items
for each row
execute function public.reconcile_order_status_from_item_change();

drop function if exists public.start_order_preparation(uuid);
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

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'start_preparation',
      target_order.id,
      jsonb_build_object(
        'table_number', updated_order.table_number,
        'staff_id', acting_staff.id,
        'kitchen_station_id', effective_station_id,
        'item_count', updated_count
      )
    );
  end if;

  return updated_order;
end;
$$;

drop function if exists public.mark_order_ready(uuid);
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

  if target_order.status::text not in ('preparing', 'ready') then
    raise exception 'Only preparing kitchen orders may be marked ready.';
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

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'mark_ready',
      target_order.id,
      jsonb_build_object(
        'table_number', updated_order.table_number,
        'staff_id', acting_staff.id,
        'kitchen_station_id', effective_station_id,
        'item_count', updated_count
      )
    );
  end if;

  return updated_order;
end;
$$;

drop function if exists public.mark_order_completed(uuid);
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

  if target_order.status::text not in ('ready', 'preparing') then
    raise exception 'Only ready kitchen items may be completed.';
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

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'complete_order',
      target_order.id,
      jsonb_build_object(
        'table_number', updated_order.table_number,
        'staff_id', acting_staff.id,
        'kitchen_station_id', effective_station_id,
        'item_count', updated_count
      )
    );
  end if;

  return updated_order;
end;
$$;

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
  items jsonb
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
  select
    orders.id,
    case
      when bool_and(items.kitchen_status = 'ready') then 'ready'
      when bool_or(items.kitchen_status in ('preparing', 'ready')) then 'preparing'
      else 'paid'
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
    ), '[]'::jsonb) as items
  from public.orders orders
  join public.order_items items
    on items.restaurant_id = orders.restaurant_id
   and items.order_id = orders.id
   and (effective_station_id is null or items.kitchen_station_id = effective_station_id)
   and items.kitchen_status in ('paid', 'preparing', 'ready')
  left join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  left join public.kitchen_stations stations
    on stations.restaurant_id = items.restaurant_id
   and stations.id = items.kitchen_station_id
  where orders.restaurant_id = target_restaurant_id
    and orders.status::text in ('paid', 'preparing', 'ready')
  group by orders.id
  order by orders.created_at asc;
end;
$$;

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
