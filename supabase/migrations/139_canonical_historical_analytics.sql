-- Canonical historical timestamp contract:
-- revenue -> order_invoices.paid_at
-- order volume -> orders.created_at
-- kitchen served -> order_items.kitchen_completed_at
-- dining sessions closed -> orders.dining_session_closed_at

create index if not exists order_invoices_restaurant_paid_at_idx on public.order_invoices(restaurant_id, paid_at) where paid_at is not null;
create index if not exists order_items_restaurant_kitchen_completed_at_idx on public.order_items(restaurant_id, kitchen_completed_at) where kitchen_completed_at is not null;
create index if not exists orders_restaurant_dining_closed_at_idx on public.orders(restaurant_id, dining_session_closed_at) where dining_session_closed_at is not null;

create or replace function public.get_canonical_historical_analytics(target_restaurant_id uuid, range_start timestamptz, range_end timestamptz)
returns jsonb language sql stable security definer set search_path=public as $$
  select case
    when range_start >= range_end then jsonb_build_object('error','Invalid analytics window.')
    when not (
      public.owner_can_report(target_restaurant_id)
      or public.manager_can_report(target_restaurant_id)
    ) then jsonb_build_object('error','Permission denied.')
    else jsonb_build_object(
      'range_start', range_start,
      'range_end', range_end,
      'revenue', coalesce((select sum(i.total_price) from public.order_invoices i where i.restaurant_id=target_restaurant_id and i.paid_at>=range_start and i.paid_at<range_end and i.payment_status::text in('paid','refunded')),0),
      'order_volume', (select count(*) from public.orders o where o.restaurant_id=target_restaurant_id and o.created_at>=range_start and o.created_at<range_end),
      'kitchen_served', (select count(distinct x.order_id) from public.order_items x where x.restaurant_id=target_restaurant_id and x.kitchen_completed_at>=range_start and x.kitchen_completed_at<range_end),
      'dining_sessions_closed', (select count(*) from public.orders o where o.restaurant_id=target_restaurant_id and o.dining_session_closed_at>=range_start and o.dining_session_closed_at<range_end)
    )
  end
$$;

revoke all on function public.get_canonical_historical_analytics(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_canonical_historical_analytics(uuid,timestamptz,timestamptz) to authenticated,service_role;

-- Reassert owner Sales/Inventory/AI against paid_at. Late collections belong
-- to the period in which money was collected, never the order creation period.
create or replace function public.get_owner_sales_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with paid as(select i.* from order_invoices i where i.restaurant_id=target_restaurant_id and i.payment_status::text in('paid','refunded') and i.paid_at>=range_start and i.paid_at<range_end), refunds as(select count(*)::int count,coalesce(sum(total_price),0)::numeric value from paid where payment_status::text='refunded'), hours as(select extract(hour from paid_at)::int hour_of_day,count(*)::int orders,sum(total_price)::numeric revenue from paid group by 1), methods as(select coalesce(payment_method,'Other') method,count(*)::int invoices,sum(total_price)::numeric revenue from paid group by 1), totals as(select coalesce((select sum(total_price) from paid),0)::numeric revenue,(select count(*)::int from orders o where o.restaurant_id=target_restaurant_id and o.created_at>=range_start and o.created_at<range_end) orders)
select jsonb_build_object('summary',jsonb_build_array(jsonb_build_object('metric','Revenue','value',t.revenue),jsonb_build_object('metric','Orders','value',t.orders),jsonb_build_object('metric','Average Bill','value',case when t.orders=0 then 0 else t.revenue/t.orders end),jsonb_build_object('metric','Refunds','value',r.value)), 'top_hours',coalesce((select jsonb_agg(to_jsonb(h) order by revenue desc) from (select * from hours order by revenue desc limit 5) h),'[]'::jsonb),'payment_breakdown',coalesce((select jsonb_agg(to_jsonb(m) order by revenue desc) from methods m),'[]'::jsonb)) from totals t cross join refunds r where public.owner_can_report(target_restaurant_id);
$$;

create or replace function public.get_owner_financial_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz)
returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(
  select i.total_price::numeric total_price,
    case when lower(coalesce(i.payment_method,''))='cash' then 'Cash' when lower(coalesce(i.payment_method,'')) like '%telebirr%' then 'Telebirr' when lower(coalesce(i.payment_method,'')) like '%cbe%' then 'CBE Birr' when lower(coalesce(i.payment_method,'')) ~ '(card|credit|debit)' then 'Card' else 'Other Digital' end method
  from order_invoices i where i.restaurant_id=target_restaurant_id and i.payment_status::text in('paid','refunded') and i.paid_at>=range_start and i.paid_at<range_end
), totals as(select coalesce(sum(total_price),0) gross from eligible), methods as(select method,count(*)::int invoices,sum(total_price)::numeric revenue from eligible group by method)
select jsonb_build_object('revenue',jsonb_build_array(jsonb_build_object('metric','Total Revenue','value',gross),jsonb_build_object('metric','Gross Revenue','value',gross),jsonb_build_object('metric','VAT','value',gross-(gross/1.15)),jsonb_build_object('metric','Net Revenue','value',gross/1.15)),'payments',coalesce((select jsonb_agg(to_jsonb(m) order by revenue desc) from methods m),'[]'::jsonb),'tax',jsonb_build_array(jsonb_build_object('metric','Gross Revenue','value',gross),jsonb_build_object('metric','VAT','value',gross-(gross/1.15)),jsonb_build_object('metric','Net Revenue','value',gross/1.15))) from totals where public.owner_can_report(target_restaurant_id);
$$;

create or replace function public.get_owner_inventory_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with paid as(select id from order_invoices where restaurant_id=target_restaurant_id and payment_status::text in('paid','refunded') and paid_at>=range_start and paid_at<range_end), demand as(select ingredient,sum(oi.quantity)::int usage_units from paid p join order_items oi on oi.invoice_id=p.id join menu_items m on m.restaurant_id=oi.restaurant_id and m.id=oi.menu_item_id cross join lateral unnest(coalesce(m.ingredients,array[]::text[])) ingredient group by ingredient)
select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('ingredient',ingredient,'estimated_usage',usage_units,'forecast',case when usage_units>=20 then 'High demand — review stock' when usage_units>=8 then 'Monitor stock' else 'Stable' end) order by usage_units desc),'[]'::jsonb),'note','Ingredient demand uses invoices collected by paid_at.') from demand where public.owner_can_report(target_restaurant_id);
$$;

create or replace function public.get_owner_ai_business_insights(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with bounds as(select range_end-range_start span), current_paid as(select i.*,o.table_number from order_invoices i join orders o on o.restaurant_id=i.restaurant_id and o.id=i.order_id where i.restaurant_id=target_restaurant_id and i.payment_status::text in('paid','refunded') and i.paid_at>=range_start and i.paid_at<range_end), previous_paid as(select i.* from order_invoices i,bounds b where i.restaurant_id=target_restaurant_id and i.payment_status::text in('paid','refunded') and i.paid_at>=range_start-b.span and i.paid_at<range_start), totals as(select coalesce((select sum(total_price) from current_paid),0)::numeric current_revenue,coalesce((select sum(total_price) from previous_paid),0)::numeric previous_revenue), best_table as(select table_number,sum(total_price) revenue from current_paid where table_number is not null group by table_number order by revenue desc limit 1), busiest as(select extract(hour from paid_at)::int hour_of_day,count(*) orders from current_paid group by 1 order by orders desc limit 1), refund_stats as(select count(*) count from current_paid where payment_status::text='refunded')
select jsonb_build_object('insights',jsonb_build_array(jsonb_build_object('type','summary','title','Revenue trend','detail',case when previous_revenue=0 then 'No prior-period revenue is available for comparison.' else 'Revenue '||(case when current_revenue>=previous_revenue then 'increased' else 'decreased' end)||' '||round(abs((current_revenue-previous_revenue)/previous_revenue*100),1)::text||'% compared with the previous period.' end),jsonb_build_object('type','opportunity','title','Most profitable table','detail',coalesce((select 'Table '||table_number::text||' generated the highest collected revenue.' from best_table),'No table revenue is available yet.')),jsonb_build_object('type','operations','title','Busiest collection hour','detail',coalesce((select hour_of_day::text||':00–'||(hour_of_day+1)::text||':00 was the busiest collection hour.' from busiest),'No collection-hour pattern is available yet.')),jsonb_build_object('type',case when refund_stats.count>2 then 'warning' else 'control' end,'title','Refund activity','detail',refund_stats.count::text||' refunded invoice(s) were recorded in this period.'))) from totals cross join refund_stats where public.owner_can_report(target_restaurant_id);
$$;
