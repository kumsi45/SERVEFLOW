-- ServeFlow Manager Dashboard M6: operational reporting only.
-- No owner financial analytics. All aggregates are scoped to target_restaurant_id.

create or replace function public.manager_can_report(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_staff staff
    where staff.restaurant_id = target_restaurant_id
      and staff.user_id = auth.uid()
      and staff.role::text = 'manager'
      and staff.active = true
  )
$$;

create or replace function public.get_manager_operational_report(target_restaurant_id uuid, range_start timestamptz, range_end timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
guard as (
  select public.manager_can_report(target_restaurant_id) allowed
),
scoped_orders as (
  select orders.*
  from public.orders orders, guard
  where guard.allowed
    and orders.restaurant_id = target_restaurant_id
    and orders.created_at >= range_start
    and orders.created_at < range_end
),
scoped_items as (
  select items.*, orders.created_by_waiter_id, orders.table_number, orders.dining_session_opened_at, orders.table_released_at
  from public.order_items items
  join public.orders orders on orders.id = items.order_id and orders.restaurant_id = items.restaurant_id
  join guard on guard.allowed
  where items.restaurant_id = target_restaurant_id
    and items.created_at >= range_start
    and items.created_at < range_end
),
hours as (
  select
    to_char(hour_slot, 'HH24:00') label,
    count(scoped_orders.id)::int value
  from generate_series(date_trunc('hour', range_start), range_end - interval '1 hour', interval '1 hour') hour_slot
  left join scoped_orders on date_trunc('hour', scoped_orders.created_at) = hour_slot
  group by hour_slot
  order by hour_slot
),
prep as (
  select
    coalesce(round(avg(extract(epoch from (
      coalesce(items.kitchen_completed_at, items.kitchen_ready_marked_at, orders.ready_marked_at, orders.completed_at, orders.updated_at)
      - coalesce(items.kitchen_preparation_started_at, orders.preparation_started_at, items.appended_at, items.created_at)
    )) / 60))::int, 0) average_preparation_minutes
  from scoped_items items
  join public.orders orders on orders.id = items.order_id and orders.restaurant_id = items.restaurant_id
  where items.kitchen_status in ('ready', 'completed')
),
table_turnover as (
  select
    coalesce(scoped_orders.table_number, '-') table_number,
    count(*)::int sessions,
    coalesce(round(avg(extract(epoch from (
      coalesce(scoped_orders.table_released_at, scoped_orders.dining_session_closed_at, scoped_orders.completed_at, scoped_orders.updated_at)
      - coalesce(scoped_orders.dining_session_opened_at, scoped_orders.created_at)
    )) / 60))::int, 0) average_stay_minutes
  from scoped_orders
  where scoped_orders.table_number is not null
  group by scoped_orders.table_number
),
waiter_performance as (
  select
    staff.id staff_id,
    coalesce(staff.display_name, 'Waiter') waiter,
    count(distinct orders.id)::int orders,
    coalesce(round(avg(extract(epoch from (
      coalesce(orders.ready_marked_at, orders.completed_at, orders.updated_at)
      - coalesce(orders.dining_session_opened_at, orders.created_at)
    )) / 60))::int, 0) average_wait_minutes,
    count(distinct orders.id) filter (
      where extract(epoch from (
        coalesce(orders.ready_marked_at, orders.completed_at, orders.updated_at)
        - coalesce(orders.dining_session_opened_at, orders.created_at)
      )) / 60 >= 25
    )::int delayed_orders
  from public.restaurant_staff staff
  left join scoped_orders orders on orders.created_by_waiter_id = staff.id
  where staff.restaurant_id = target_restaurant_id
    and staff.role::text = 'waiter'
  group by staff.id, staff.display_name
),
kitchen_efficiency as (
  select
    stations.id station_id,
    stations.name station,
    count(items.id)::int tickets,
    count(items.id) filter (where items.kitchen_status = 'completed')::int completed,
    count(items.id) filter (
      where extract(epoch from (
        coalesce(items.kitchen_completed_at, items.kitchen_ready_marked_at, items.created_at)
        - coalesce(items.kitchen_preparation_started_at, items.appended_at, items.created_at)
      )) / 60 >= 25
    )::int delayed,
    coalesce(round(avg(extract(epoch from (
      coalesce(items.kitchen_completed_at, items.kitchen_ready_marked_at, items.created_at)
      - coalesce(items.kitchen_preparation_started_at, items.appended_at, items.created_at)
    )) / 60))::int, 0) average_prep_minutes
  from public.kitchen_stations stations
  left join scoped_items items on items.kitchen_station_id = stations.id
  where stations.restaurant_id = target_restaurant_id
    and stations.archived_at is null
  group by stations.id, stations.name
),
station_utilization as (
  select
    station label,
    tickets value,
    completed secondary
  from kitchen_efficiency
),
delayed_by_day as (
  select
    to_char(day_slot, 'Mon DD') label,
    count(distinct scoped_orders.id) filter (
      where extract(epoch from (
        coalesce(scoped_orders.ready_marked_at, scoped_orders.completed_at, scoped_orders.updated_at)
        - coalesce(scoped_orders.dining_session_opened_at, scoped_orders.created_at)
      )) / 60 >= 25
    )::int value
  from generate_series(date_trunc('day', range_start), range_end - interval '1 day', interval '1 day') day_slot
  left join scoped_orders on date_trunc('day', scoped_orders.created_at) = day_slot
  group by day_slot
  order by day_slot
),
cancelled_by_day as (
  select
    to_char(day_slot, 'Mon DD') label,
    count(scoped_orders.id) filter (where scoped_orders.status::text = 'cancelled')::int value
  from generate_series(date_trunc('day', range_start), range_end - interval '1 day', interval '1 day') day_slot
  left join scoped_orders on date_trunc('day', scoped_orders.created_at) = day_slot
  group by day_slot
  order by day_slot
),
wait_by_hour as (
  select
    to_char(hour_slot, 'HH24:00') label,
    coalesce(round(avg(extract(epoch from (
      coalesce(scoped_orders.ready_marked_at, scoped_orders.completed_at, scoped_orders.updated_at)
      - coalesce(scoped_orders.dining_session_opened_at, scoped_orders.created_at)
    )) / 60))::int, 0) value
  from generate_series(date_trunc('hour', range_start), range_end - interval '1 hour', interval '1 hour') hour_slot
  left join scoped_orders on date_trunc('hour', scoped_orders.created_at) = hour_slot
  group by hour_slot
  order by hour_slot
),
summary as (
  select
    count(*)::int orders,
    (select average_preparation_minutes from prep) average_preparation_minutes,
    coalesce((select sum(sessions) from table_turnover), 0)::int table_turnover,
    count(*) filter (
      where extract(epoch from (
        coalesce(scoped_orders.ready_marked_at, scoped_orders.completed_at, scoped_orders.updated_at)
        - coalesce(scoped_orders.dining_session_opened_at, scoped_orders.created_at)
      )) / 60 >= 25
    )::int delayed_orders,
    count(*) filter (where scoped_orders.status::text = 'cancelled')::int cancelled_orders,
    coalesce(round(avg(extract(epoch from (
      coalesce(scoped_orders.ready_marked_at, scoped_orders.completed_at, scoped_orders.updated_at)
      - coalesce(scoped_orders.dining_session_opened_at, scoped_orders.created_at)
    )) / 60))::int, 0) average_customer_wait_minutes,
    (select label from hours order by value desc, label asc limit 1) peak_hour
  from scoped_orders
)
select case
  when not exists (select 1 from guard where allowed) then
    jsonb_build_object('error', 'Permission denied.')
  else jsonb_build_object(
    'range_start', range_start,
    'range_end', range_end,
    'generated_at', now(),
    'summary', (select to_jsonb(summary) from summary),
    'orders_per_hour', coalesce((select jsonb_agg(to_jsonb(hours) order by label) from hours), '[]'::jsonb),
    'peak_hours', coalesce((select jsonb_agg(to_jsonb(x) order by value desc, label asc) from (select * from hours order by value desc, label asc limit 8) x), '[]'::jsonb),
    'table_turnover', coalesce((select jsonb_agg(to_jsonb(table_turnover) order by sessions desc, table_number asc) from table_turnover), '[]'::jsonb),
    'waiter_performance', coalesce((select jsonb_agg(to_jsonb(waiter_performance) order by orders desc, waiter asc) from waiter_performance), '[]'::jsonb),
    'kitchen_efficiency', coalesce((select jsonb_agg(to_jsonb(kitchen_efficiency) || jsonb_build_object('efficiency', case when tickets = 0 then 0 else round(completed::numeric / greatest(tickets, 1) * 100)::int end) order by station) from kitchen_efficiency), '[]'::jsonb),
    'station_utilization', coalesce((select jsonb_agg(to_jsonb(station_utilization) order by value desc, label asc) from station_utilization), '[]'::jsonb),
    'delayed_orders', coalesce((select jsonb_agg(to_jsonb(delayed_by_day) order by label) from delayed_by_day), '[]'::jsonb),
    'cancelled_orders', coalesce((select jsonb_agg(to_jsonb(cancelled_by_day) order by label) from cancelled_by_day), '[]'::jsonb),
    'customer_wait_time', coalesce((select jsonb_agg(to_jsonb(wait_by_hour) order by label) from wait_by_hour), '[]'::jsonb)
  )
end;
$$;

revoke all on function public.manager_can_report(uuid) from public, anon, authenticated;
revoke all on function public.get_manager_operational_report(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.manager_can_report(uuid) to authenticated, service_role;
grant execute on function public.get_manager_operational_report(uuid, timestamptz, timestamptz) to authenticated, service_role;
