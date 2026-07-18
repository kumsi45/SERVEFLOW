-- Phase 7A.3: canonical lifecycle finalization.
-- The legacy order status column is no longer used by production kitchen decisions.

alter table public.order_items
  drop constraint if exists order_items_kitchen_status_check,
  drop constraint if exists order_items_kitchen_status_allowed;

update public.order_items
set kitchen_status = 'accepted'
where kitchen_status = 'paid';

alter table public.order_items
  add constraint order_items_kitchen_status_check
  check (kitchen_status in ('held', 'accepted', 'preparing', 'ready', 'completed'));

create or replace function public.normalize_legacy_kitchen_item_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kitchen_status = 'paid' then
    new.kitchen_status := 'accepted';
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_legacy_kitchen_item_status on public.order_items;
create trigger normalize_legacy_kitchen_item_status
before insert or update of kitchen_status on public.order_items
for each row execute function public.normalize_legacy_kitchen_item_status();

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
  next_operational_status text;
begin
  select * into target_order
  from public.orders
  where orders.id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  if target_order.operational_status in ('closed', 'served') then
    return target_order;
  end if;

  select case
    when count(*) = 0 then target_order.operational_status
    when bool_and(items.kitchen_status = 'completed') then 'served'
    when bool_and(items.kitchen_status in ('ready', 'completed')) then 'ready'
    when bool_or(items.kitchen_status in ('preparing', 'ready', 'completed')) then 'preparing'
    when bool_or(items.kitchen_status = 'accepted') then 'accepted'
    else target_order.operational_status
  end
  into next_operational_status
  from public.order_items items
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id;

  update public.orders
  set operational_status = next_operational_status,
      preparation_started_at = case
        when next_operational_status = 'preparing' then coalesce(preparation_started_at, now())
        else preparation_started_at
      end,
      ready_marked_at = case
        when next_operational_status = 'ready' then coalesce(ready_marked_at, now())
        else ready_marked_at
      end,
      completed_at = case
        when next_operational_status in ('served', 'completed') then coalesce(completed_at, now())
        else completed_at
      end,
      updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into target_order;

  return target_order;
end;
$$;

revoke all on function public.derive_order_status_from_items(uuid, uuid) from public, anon, authenticated;

drop function if exists public.get_station_kitchen_orders(uuid, uuid, boolean, boolean);
create or replace function public.get_station_kitchen_orders(
  target_restaurant_id uuid,
  target_station_id uuid default null,
  include_all_stations boolean default false,
  log_queue_view boolean default false
)
returns table (
  id uuid, display_number text, kitchen_ticket_number text, kitchen_batch_key text,
  status text, customer_name text, table_number text, payment_method text,
  total_price numeric, created_at timestamptz, payment_verified_at timestamptz,
  preparation_started_at timestamptz, ready_marked_at timestamptz,
  items jsonb, station_progress jsonb
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
  if auth.uid() is null then raise exception 'Authentication is required to view kitchen orders.'; end if;
  if target_restaurant_id is null then raise exception 'Restaurant is required.'; end if;

  select * into acting_staff
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
    select * into selected_station
    from public.kitchen_stations
    where id = target_station_id
      and restaurant_id = target_restaurant_id
      and active = true
      and archived_at is null;
    if selected_station.id is null then raise exception 'Kitchen station not found.'; end if;
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
      jsonb_build_object('station_id', effective_station_id, 'role', acting_staff.role::text)
    );
  end if;

  return query
  with active_batches as (
    select
      orders.id order_id,
      order_items.invoice_id,
      order_items.kitchen_station_id,
      coalesce(case
        when order_items.appended_at is null then null
        else ((extract(epoch from order_items.appended_at) * 1000000)::bigint)::text
      end, 'initial') kitchen_batch_key
    from public.orders
    join public.order_items
      on order_items.restaurant_id = orders.restaurant_id
     and order_items.order_id = orders.id
    join public.order_invoices
      on order_invoices.restaurant_id = order_items.restaurant_id
     and order_invoices.id = order_items.invoice_id
     and order_invoices.order_id = orders.id
    where orders.restaurant_id = target_restaurant_id
      and orders.operational_status in ('accepted', 'preparing', 'ready')
      and orders.dining_session_status = 'open'
      and orders.table_released_at is null
      and (
        order_invoices.payment_status = 'paid'
        or (
          order_invoices.payment_status = 'held'
          and orders.payment_timing = 'after_meal'
          and orders.order_source <> 'public_qr'
        )
      )
      and order_items.kitchen_status in ('accepted', 'preparing', 'ready')
      and order_items.kitchen_station_id is not null
      and (effective_station_id is null or order_items.kitchen_station_id = effective_station_id)
    group by orders.id, order_items.invoice_id, order_items.kitchen_station_id, order_items.appended_at
  )
  select
    orders.id,
    orders.display_number,
    invoices.kitchen_ticket_number,
    batches.kitchen_batch_key,
    case
      when count(*) filter (where order_items.kitchen_status = 'accepted') = count(*) then 'accepted'
      when count(*) filter (where order_items.kitchen_status = 'ready') = count(*) then 'ready'
      else 'preparing'
    end,
    orders.customer_name,
    orders.table_number,
    orders.payment_method,
    coalesce(sum(order_items.price * order_items.quantity), 0)::numeric,
    orders.created_at,
    invoices.paid_at,
    coalesce(min(order_items.kitchen_preparation_started_at), orders.preparation_started_at),
    coalesce(max(order_items.kitchen_ready_marked_at), orders.ready_marked_at),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', order_items.id,
      'order_id', order_items.order_id,
      'quantity', order_items.quantity,
      'price', order_items.price,
      'notes', order_items.notes,
      'appended_at', order_items.appended_at,
      'kitchen_station_id', order_items.kitchen_station_id,
      'kitchen_station_name', kitchen_stations.name,
      'kitchen_status', order_items.kitchen_status,
      'menu_item_name', menu_items.name
    ) order by order_items.created_at, order_items.id), '[]'::jsonb),
    jsonb_build_array(jsonb_build_object(
      'station_id', batches.kitchen_station_id,
      'station_name', max(kitchen_stations.name),
      'station_status', case
        when count(*) filter (where order_items.kitchen_status = 'accepted') = count(*) then 'accepted'
        when count(*) filter (where order_items.kitchen_status = 'ready') = count(*) then 'ready'
        else 'preparing'
      end,
      'item_count', count(*)::integer,
      'ready_count', count(*) filter (where order_items.kitchen_status = 'ready')::integer,
      'completed_count', count(*) filter (where order_items.kitchen_status = 'completed')::integer,
      'started_at', min(order_items.kitchen_preparation_started_at),
      'ready_at', max(order_items.kitchen_ready_marked_at),
      'completed_at', max(order_items.kitchen_completed_at)
    ))
  from active_batches batches
  join public.orders
    on orders.id = batches.order_id
   and orders.restaurant_id = target_restaurant_id
  join public.order_invoices invoices
    on invoices.restaurant_id = orders.restaurant_id
   and invoices.id = batches.invoice_id
   and invoices.order_id = orders.id
  join public.order_items
    on order_items.restaurant_id = orders.restaurant_id
   and order_items.order_id = orders.id
   and order_items.invoice_id = batches.invoice_id
   and order_items.kitchen_station_id = batches.kitchen_station_id
   and (
     (batches.kitchen_batch_key = 'initial' and order_items.appended_at is null)
     or (batches.kitchen_batch_key <> 'initial' and ((extract(epoch from order_items.appended_at) * 1000000)::bigint)::text = batches.kitchen_batch_key)
   )
   and order_items.kitchen_status in ('accepted', 'preparing', 'ready')
  left join public.menu_items
    on menu_items.restaurant_id = order_items.restaurant_id
   and menu_items.id = order_items.menu_item_id
  left join public.kitchen_stations
    on kitchen_stations.restaurant_id = order_items.restaurant_id
   and kitchen_stations.id = order_items.kitchen_station_id
  group by orders.id, invoices.kitchen_ticket_number, invoices.paid_at, batches.kitchen_station_id, batches.kitchen_batch_key
  order by coalesce(min(order_items.appended_at), invoices.paid_at, orders.created_at), orders.created_at;
end;
$$;

create or replace function public.get_canonical_station_kitchen_orders(
  target_restaurant_id uuid,
  target_station_id uuid default null,
  include_all_stations boolean default false,
  log_queue_view boolean default true
)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(queue_row)
  from public.get_station_kitchen_orders(
    target_restaurant_id,
    target_station_id,
    include_all_stations,
    log_queue_view
  ) queue_row;
$$;

create or replace function public.resolve_kitchen_action_context(
  target_order_id uuid,
  requested_station_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  staff public.restaurant_staff;
  station_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required to update kitchen tickets.'; end if;

  select * into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then raise exception 'Order not found.'; end if;

  select * into staff
  from public.restaurant_staff
  where restaurant_id = target_order.restaurant_id
    and user_id = auth.uid()
    and active
    and role::text in ('kitchen', 'owner')
  order by created_at
  limit 1;

  if staff.id is null then raise exception 'Order belongs to another restaurant.'; end if;

  if staff.role::text = 'kitchen' then
    station_id := staff.assigned_kitchen_station_id;
    if station_id is null then
      station_id := public.ensure_main_kitchen_station_for_restaurant(target_order.restaurant_id);
      update public.restaurant_staff
      set assigned_kitchen_station_id = station_id
      where id = staff.id
        and restaurant_id = staff.restaurant_id;
    end if;
  else
    station_id := requested_station_id;
  end if;

  if station_id is null then raise exception 'Kitchen station not found.'; end if;
  if not exists (
    select 1
    from public.kitchen_stations stations
    where stations.id = station_id
      and stations.restaurant_id = target_order.restaurant_id
      and stations.active
      and stations.archived_at is null
  ) then
    raise exception 'Wrong station.';
  end if;

  return jsonb_build_object(
    'restaurant_id', target_order.restaurant_id,
    'staff_id', staff.id,
    'station_id', station_id
  );
end;
$$;

create or replace function public.transition_station_kitchen_items(
  target_order_id uuid,
  target_station_id uuid,
  target_batch_key text,
  from_statuses text[],
  to_status text,
  acting_staff_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  batch_total integer;
  eligible_total integer;
  completed_total integer;
  seen_status text;
  changed integer;
begin
  target_batch_key := coalesce(target_batch_key, 'initial');

  select * into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then raise exception 'Order not found.'; end if;
  if target_order.operational_status in ('closed', 'served')
     or target_order.dining_session_status <> 'open'
     or target_order.table_released_at is not null then
    raise exception 'Order closed.';
  end if;
  if target_batch_key is null then raise exception 'Batch not found.'; end if;

  select count(*),
         count(*) filter (where items.kitchen_status = any(from_statuses)),
         count(*) filter (where items.kitchen_status = 'completed'),
         min(items.kitchen_status)
  into batch_total, eligible_total, completed_total, seen_status
  from public.order_items items
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id
   and invoices.id = items.invoice_id
   and invoices.order_id = items.order_id
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_station_id = target_station_id
    and (
      (target_batch_key = 'initial' and items.appended_at is null)
      or ((extract(epoch from items.appended_at) * 1000000)::bigint)::text = target_batch_key
    )
    and (
      invoices.payment_status = 'paid'
      or (
        invoices.payment_status = 'held'
        and target_order.payment_timing = 'after_meal'
        and target_order.order_source <> 'public_qr'
      )
    );

  if batch_total = 0 then
    if exists (
      select 1
      from public.order_items items
      where items.restaurant_id = target_order.restaurant_id
        and items.order_id = target_order.id
        and (
          (target_batch_key = 'initial' and items.appended_at is null)
          or ((extract(epoch from items.appended_at) * 1000000)::bigint)::text = target_batch_key
        )
    ) then
      raise exception 'Wrong station.';
    end if;
    raise exception 'Batch not found.';
  end if;

  if completed_total = batch_total then raise exception 'Batch completed.'; end if;
  if eligible_total = 0 then
    if seen_status = 'preparing' then raise exception 'Batch already preparing.'; end if;
    if seen_status = 'ready' then raise exception 'Batch already ready.'; end if;
    raise exception 'Batch cannot transition from its current state.';
  end if;

  update public.order_items items
  set kitchen_status = to_status,
      kitchen_preparation_started_at = case when to_status = 'preparing' then coalesce(items.kitchen_preparation_started_at, now()) else items.kitchen_preparation_started_at end,
      kitchen_preparation_started_by = case when to_status = 'preparing' then coalesce(items.kitchen_preparation_started_by, acting_staff_id) else items.kitchen_preparation_started_by end,
      kitchen_ready_marked_at = case when to_status = 'ready' then coalesce(items.kitchen_ready_marked_at, now()) else items.kitchen_ready_marked_at end,
      kitchen_ready_marked_by = case when to_status = 'ready' then coalesce(items.kitchen_ready_marked_by, acting_staff_id) else items.kitchen_ready_marked_by end,
      kitchen_completed_at = case when to_status = 'completed' then coalesce(items.kitchen_completed_at, now()) else items.kitchen_completed_at end,
      kitchen_completed_by = case when to_status = 'completed' then coalesce(items.kitchen_completed_by, acting_staff_id) else items.kitchen_completed_by end
  from public.order_invoices invoices
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_station_id = target_station_id
    and (
      (target_batch_key = 'initial' and items.appended_at is null)
      or ((extract(epoch from items.appended_at) * 1000000)::bigint)::text = target_batch_key
    )
    and items.kitchen_status = any(from_statuses)
    and invoices.restaurant_id = items.restaurant_id
    and invoices.id = items.invoice_id
    and invoices.order_id = items.order_id
    and (
      invoices.payment_status = 'paid'
      or (
        invoices.payment_status = 'held'
        and target_order.payment_timing = 'after_meal'
        and target_order.order_source <> 'public_qr'
      )
    );

  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.start_order_preparation(
  target_order_id uuid,
  target_station_id uuid default null,
  target_batch_key text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare context jsonb;
begin
  context := public.resolve_kitchen_action_context(target_order_id, target_station_id);
  perform public.transition_station_kitchen_items(
    target_order_id,
    (context->>'station_id')::uuid,
    target_batch_key,
    array['accepted'],
    'preparing',
    (context->>'staff_id')::uuid
  );
  return public.derive_order_status_from_items(target_order_id, (context->>'staff_id')::uuid);
end;
$$;

create or replace function public.mark_order_ready(
  target_order_id uuid,
  target_station_id uuid default null,
  target_batch_key text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare context jsonb;
begin
  context := public.resolve_kitchen_action_context(target_order_id, target_station_id);
  perform public.transition_station_kitchen_items(
    target_order_id,
    (context->>'station_id')::uuid,
    target_batch_key,
    array['preparing'],
    'ready',
    (context->>'staff_id')::uuid
  );
  return public.derive_order_status_from_items(target_order_id, (context->>'staff_id')::uuid);
end;
$$;

create or replace function public.mark_order_completed(
  target_order_id uuid,
  target_station_id uuid default null,
  target_batch_key text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare context jsonb;
begin
  context := public.resolve_kitchen_action_context(target_order_id, target_station_id);
  perform public.transition_station_kitchen_items(
    target_order_id,
    (context->>'station_id')::uuid,
    target_batch_key,
    array['ready'],
    'completed',
    (context->>'staff_id')::uuid
  );
  return public.derive_order_status_from_items(target_order_id, (context->>'staff_id')::uuid);
end;
$$;

create or replace function public.validate_canonical_lifecycle(target_restaurant_id uuid default null)
returns table (
  severity text,
  entity_type text,
  record_id uuid,
  restaurant_id uuid,
  rule text,
  detail jsonb
)
language sql
security definer
set search_path = public
as $$
  select 'FAIL', 'order', orders.id, orders.restaurant_id,
         'closed_order_has_active_kitchen_items',
         jsonb_build_object('operational_status', orders.operational_status)
  from public.orders
  where (target_restaurant_id is null or orders.restaurant_id = target_restaurant_id)
    and (
      orders.operational_status in ('served', 'closed')
      or orders.dining_session_status <> 'open'
      or orders.table_released_at is not null
    )
    and exists (
      select 1
      from public.order_items items
      where items.restaurant_id = orders.restaurant_id
        and items.order_id = orders.id
        and items.kitchen_status in ('accepted', 'preparing', 'ready')
    )
  union all
  select 'FAIL', 'item', items.id, items.restaurant_id,
         'kitchen_item_released_without_canonical_payment',
         jsonb_build_object('kitchen_status', items.kitchen_status, 'payment_status', invoices.payment_status)
  from public.order_items items
  join public.orders orders
    on orders.restaurant_id = items.restaurant_id
   and orders.id = items.order_id
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id
   and invoices.id = items.invoice_id
   and invoices.order_id = items.order_id
  where (target_restaurant_id is null or items.restaurant_id = target_restaurant_id)
    and items.kitchen_status in ('accepted', 'preparing', 'ready', 'completed')
    and invoices.payment_status <> 'paid'
    and not (
      invoices.payment_status = 'held'
      and orders.payment_timing = 'after_meal'
      and orders.order_source <> 'public_qr'
    )
  union all
  select 'FAIL', 'invoice', invoices.id, invoices.restaurant_id,
         'invoice_restaurant_mismatch',
         jsonb_build_object('order_id', invoices.order_id)
  from public.order_invoices invoices
  join public.orders orders on orders.id = invoices.order_id
  where (target_restaurant_id is null or invoices.restaurant_id = target_restaurant_id)
    and invoices.restaurant_id <> orders.restaurant_id
  union all
  select 'FAIL', 'item', items.id, items.restaurant_id,
         'item_restaurant_mismatch',
         jsonb_build_object('order_id', items.order_id, 'invoice_id', items.invoice_id)
  from public.order_items items
  join public.orders orders on orders.id = items.order_id
  join public.order_invoices invoices on invoices.id = items.invoice_id
  where (target_restaurant_id is null or items.restaurant_id = target_restaurant_id)
    and (items.restaurant_id <> orders.restaurant_id or items.restaurant_id <> invoices.restaurant_id)
;
$$;

-- Repair only impossible active-kitchen states. Historical order, invoice and
-- item rows remain in place; only the operational kitchen marker is finalized.
update public.order_items items
set kitchen_status = 'held'
from public.orders orders
join public.order_invoices invoices
  on invoices.restaurant_id = orders.restaurant_id
 and invoices.order_id = orders.id
where items.restaurant_id = orders.restaurant_id
  and items.order_id = orders.id
  and items.invoice_id = invoices.id
  and items.kitchen_status in ('accepted', 'preparing', 'ready')
  and invoices.payment_status <> 'paid'
  and not (
    invoices.payment_status = 'held'
    and orders.payment_timing = 'after_meal'
    and orders.order_source <> 'public_qr'
  );

update public.order_items items
set kitchen_status = 'completed',
    kitchen_completed_at = coalesce(
      items.kitchen_completed_at,
      orders.completed_at,
      orders.dining_session_closed_at,
      orders.table_released_at,
      orders.updated_at
    )
from public.orders orders
where items.restaurant_id = orders.restaurant_id
  and items.order_id = orders.id
  and items.kitchen_status in ('accepted', 'preparing', 'ready')
  and (
    orders.operational_status in ('served', 'closed')
    or orders.dining_session_status <> 'open'
    or orders.table_released_at is not null
  );

create or replace function public.assert_canonical_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.operational_status in ('served', 'closed')
    or new.dining_session_status <> 'open'
    or new.table_released_at is not null
  ) and exists (
    select 1
    from public.order_items items
    where items.restaurant_id = new.restaurant_id
      and items.order_id = new.id
      and items.kitchen_status in ('accepted', 'preparing', 'ready')
  ) then
    raise exception 'Closed orders cannot have active kitchen items.';
  end if;

  return new;
end;
$$;

drop trigger if exists assert_canonical_lifecycle_transition on public.orders;
create trigger assert_canonical_lifecycle_transition
before insert or update of operational_status on public.orders
for each row execute function public.assert_canonical_lifecycle_transition();

revoke all on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) from public, anon;
revoke all on function public.get_canonical_station_kitchen_orders(uuid, uuid, boolean, boolean) from public, anon;
revoke all on function public.resolve_kitchen_action_context(uuid, uuid) from public, anon, authenticated;
revoke all on function public.transition_station_kitchen_items(uuid, uuid, text, text[], text, uuid) from public, anon, authenticated;
revoke all on function public.start_order_preparation(uuid, uuid, text) from public, anon;
revoke all on function public.mark_order_ready(uuid, uuid, text) from public, anon;
revoke all on function public.mark_order_completed(uuid, uuid, text) from public, anon;
revoke all on function public.validate_canonical_lifecycle(uuid) from public, anon;

grant execute on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.get_canonical_station_kitchen_orders(uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.start_order_preparation(uuid, uuid, text) to authenticated;
grant execute on function public.mark_order_ready(uuid, uuid, text) to authenticated;
grant execute on function public.mark_order_completed(uuid, uuid, text) to authenticated;
grant execute on function public.validate_canonical_lifecycle(uuid) to authenticated;
