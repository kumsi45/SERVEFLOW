-- Owner dashboard staff metrics treat owners as account holders, not operational staff.

create or replace function public.get_owner_reporting_center(
  target_restaurant_id uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  report jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view reports.';
  end if;

  if target_restaurant_id is null or range_start is null or range_end is null or range_start >= range_end then
    raise exception 'Valid restaurant and reporting range are required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may view reports.';
  end if;

  with scoped_orders as (
    select *
    from public.orders
    where restaurant_id = target_restaurant_id
      and created_at >= range_start
      and created_at < range_end
  ),
  revenue_orders as (
    select *
    from scoped_orders
    where payment_verified_at is not null
       or status::text in ('paid', 'preparing', 'ready', 'completed')
  ),
  item_rows as (
    select
      oi.menu_item_id,
      coalesce(mi.name, 'Menu item') as name,
      coalesce(c.name, 'Uncategorized') as category_name,
      oi.quantity,
      oi.price,
      oi.quantity * oi.price as line_total
    from public.order_items oi
    join revenue_orders o on o.id = oi.order_id and o.restaurant_id = oi.restaurant_id
    left join public.menu_items mi on mi.id = oi.menu_item_id and mi.restaurant_id = oi.restaurant_id
    left join public.categories c on c.id = mi.category_id and c.restaurant_id = mi.restaurant_id
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'revenue', coalesce((select sum(total_price) from revenue_orders), 0),
      'orders', (select count(*) from scoped_orders),
      'average_order_value', coalesce((select avg(total_price) from revenue_orders), 0),
      'completed_orders', (select count(*) from scoped_orders where status::text = 'completed'),
      'cancelled_orders', (select count(*) from scoped_orders where status::text = 'cancelled'),
      'unique_customers', (select count(distinct nullif(customer_name, '')) from scoped_orders)
    ),
    'sales_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', day::date, 'revenue', revenue, 'orders', orders) order by day)
      from (
        select date_trunc('day', created_at) as day, sum(total_price) as revenue, count(*) as orders
        from revenue_orders
        group by 1
      ) daily
    ), '[]'::jsonb),
    'orders_by_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', status::text, 'orders', count) order by status)
      from (
        select status, count(*) as count
        from scoped_orders
        group by status
      ) statuses
    ), '[]'::jsonb),
    'menu_performance', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'category', category_name, 'quantity', quantity, 'revenue', revenue) order by revenue desc)
      from (
        select name, category_name, sum(quantity) as quantity, sum(line_total) as revenue
        from item_rows
        group by name, category_name
        order by revenue desc
        limit 25
      ) menu
    ), '[]'::jsonb),
    'staff_performance', coalesce((
      select jsonb_agg(jsonb_build_object('name', display_name, 'role', role, 'orders_completed', orders_completed, 'payments_verified', payments_verified) order by orders_completed desc, payments_verified desc)
      from (
        select
          rs.display_name,
          rs.role::text as role,
          count(o.id) filter (where o.completed_by = rs.id) as orders_completed,
          count(o.id) filter (where o.payment_verified_by = rs.id) as payments_verified
        from public.restaurant_staff rs
        left join scoped_orders o on o.restaurant_id = rs.restaurant_id
        where rs.restaurant_id = target_restaurant_id
          and rs.role::text <> 'owner'
        group by rs.id, rs.display_name, rs.role
      ) staff
    ), '[]'::jsonb),
    'table_usage', coalesce((
      select jsonb_agg(jsonb_build_object('table_number', table_number, 'orders', orders, 'revenue', revenue) order by table_number)
      from (
        select
          rt.table_number,
          count(o.id) as orders,
          coalesce(sum(o.total_price) filter (
            where o.payment_verified_at is not null
               or o.status::text in ('paid', 'preparing', 'ready', 'completed')
          ), 0) as revenue
        from public.restaurant_tables rt
        left join scoped_orders o
          on o.restaurant_id = rt.restaurant_id
         and o.table_number = rt.table_number::text
        where rt.restaurant_id = target_restaurant_id
          and rt.active = true
        group by rt.table_number
      ) tables
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object('customer_name', customer_name, 'orders', orders, 'revenue', revenue, 'last_order_at', last_order_at) order by revenue desc)
      from (
        select
          coalesce(nullif(customer_name, ''), 'Guest') as customer_name,
          count(*) as orders,
          coalesce(sum(total_price), 0) as revenue,
          max(created_at) as last_order_at
        from revenue_orders
        group by coalesce(nullif(customer_name, ''), 'Guest')
        order by revenue desc
        limit 25
      ) customers
    ), '[]'::jsonb),
    'ai_insights', jsonb_build_array(
      jsonb_build_object('title', 'Peak sales window', 'detail', 'Use the hourly order chart to staff cashier and kitchen roles around proven demand.'),
      jsonb_build_object('title', 'Menu focus', 'detail', 'Promote top revenue items and review low-performing items for photos, price, or availability.'),
      jsonb_build_object('title', 'Table coverage', 'detail', 'Tables with low QR usage may need clearer table signage or staff prompts.')
    )
  )
  into report;

  return report;
end;
$$;

revoke all on function public.get_owner_reporting_center(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_owner_reporting_center(uuid, timestamptz, timestamptz) to authenticated;
