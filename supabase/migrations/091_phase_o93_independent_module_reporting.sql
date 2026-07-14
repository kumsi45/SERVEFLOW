-- Phase O9.3: independent, verified-invoice reporting for each Owner module.
create or replace function public.owner_can_report(target_restaurant_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.restaurant_staff s where s.restaurant_id=target_restaurant_id and s.user_id=auth.uid() and s.active and s.role::text in ('owner','manager'));
$$;

create or replace function public.get_owner_menu_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(select i.id,i.status,i.total_price from order_invoices i where i.restaurant_id=target_restaurant_id and i.verified_at>=range_start and i.verified_at<range_end and i.status in('paid','verified')),
refunds as(select oi.menu_item_id,sum(oi.quantity)::int qty from order_invoices i join order_items oi on oi.invoice_id=i.id where i.restaurant_id=target_restaurant_id and i.status='refunded' and i.verified_at>=range_start and i.verified_at<range_end group by oi.menu_item_id),
rows as(select m.id,m.name,sum(oi.quantity)::int quantity_sold,sum(oi.quantity*oi.price)::numeric revenue,case when sum(oi.quantity)>0 then sum(oi.quantity*oi.price)/sum(oi.quantity) else 0 end average_price,coalesce(r.qty,0) refunds from eligible e join order_items oi on oi.invoice_id=e.id join menu_items m on m.id=oi.menu_item_id left join refunds r on r.menu_item_id=m.id group by m.id,m.name,r.qty)
select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by revenue desc),'[]'::jsonb),'top_seller',(select name from rows order by quantity_sold desc,revenue desc limit 1),'bottom_seller',(select name from rows order by quantity_sold,revenue limit 1)) from rows x where public.owner_can_report(target_restaurant_id);
$$;

create or replace function public.get_owner_kitchen_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(select id from order_invoices where restaurant_id=target_restaurant_id and verified_at>=range_start and verified_at<range_end and status in('paid','verified')),
rows as(select s.id,s.name,count(distinct oi.invoice_id)::int orders,round(avg(extract(epoch from (coalesce(o.completed_at,o.updated_at)-coalesce(oi.appended_at,o.payment_verified_at)))/60))::int average_prep_time,count(distinct oi.invoice_id) filter(where oi.kitchen_status='completed')::int completed,count(distinct oi.invoice_id) filter(where o.status='cancelled')::int cancelled from eligible e join order_items oi on oi.invoice_id=e.id join orders o on o.id=oi.order_id join kitchen_stations s on s.id=oi.kitchen_station_id group by s.id,s.name)
select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('performance',case when orders=0 then 0 else round(completed::numeric/greatest(orders,1)*100) end) order by name),'[]'::jsonb)) from rows x where public.owner_can_report(target_restaurant_id);
$$;

create or replace function public.get_owner_staff_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(select i.*,o.customer_name from order_invoices i join orders o on o.id=i.order_id where i.restaurant_id=target_restaurant_id and i.verified_at>=range_start and i.verified_at<range_end and i.status in('paid','verified')),
rows as(select s.id,s.display_name as staff,count(e.id)::int orders_taken,coalesce(sum(e.total_price),0)::numeric revenue_generated,coalesce(avg(e.total_price),0)::numeric average_bill,count(distinct coalesce(nullif(e.customer_name,''),e.order_id::text))::int customers_served,count(*) filter(where e.status in('paid','verified'))::int bills_requested from restaurant_staff s left join eligible e on e.created_by_staff_id=s.id where s.restaurant_id=target_restaurant_id group by s.id,s.display_name)
select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by revenue_generated desc),'[]'::jsonb)) from rows x where public.owner_can_report(target_restaurant_id);
$$;

create or replace function public.get_owner_tables_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(select i.*,o.table_number,o.dining_session_opened_at,o.completed_at from order_invoices i join orders o on o.id=i.order_id where i.restaurant_id=target_restaurant_id and i.verified_at>=range_start and i.verified_at<range_end and i.status in('paid','verified') and o.table_number is not null),
rows as(select table_number,coalesce(sum(total_price),0)::numeric revenue_per_table,count(*)::int invoices,round(avg(extract(epoch from(coalesce(completed_at,verified_at)-coalesce(dining_session_opened_at,created_at)))/60))::int average_stay,count(distinct order_id)::int table_turnover from eligible group by table_number)
select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by table_turnover desc,revenue_per_table desc),'[]'::jsonb),'most_used_table',(select table_number from rows order by table_turnover desc,revenue_per_table desc limit 1)) from rows x where public.owner_can_report(target_restaurant_id);
$$;

create or replace function public.get_owner_customers_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(select i.id,i.order_id,i.total_price,o.customer_name from order_invoices i join orders o on o.id=i.order_id where i.restaurant_id=target_restaurant_id and i.verified_at>=range_start and i.verified_at<range_end and i.status in('paid','verified') and nullif(trim(o.customer_name),'') is not null),
prior as(select distinct lower(trim(o.customer_name)) name from order_invoices i join orders o on o.id=i.order_id where i.restaurant_id=target_restaurant_id and i.status in('paid','verified') and i.verified_at<range_start),
items as(select lower(trim(e.customer_name)) customer,m.name,sum(oi.quantity) qty from eligible e join order_items oi on oi.invoice_id=e.id join menu_items m on m.id=oi.menu_item_id group by lower(trim(e.customer_name)),m.name),
rows as(select e.customer_name,count(distinct e.order_id)::int visit_frequency,avg(e.total_price)::numeric average_spend,case when p.name is null then 'New' else 'Returning' end customer_type,(select name from items x where x.customer=lower(trim(e.customer_name)) order by qty desc limit 1) most_ordered_item from eligible e left join prior p on p.name=lower(trim(e.customer_name)) group by e.customer_name,p.name)
select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by visit_frequency desc),'[]'::jsonb),'new_customers',count(*) filter(where customer_type='New'),'returning_customers',count(*) filter(where customer_type='Returning')) from rows x where public.owner_can_report(target_restaurant_id);
$$;

revoke all on function public.owner_can_report(uuid),public.get_owner_menu_module_report(uuid,timestamptz,timestamptz),public.get_owner_kitchen_module_report(uuid,timestamptz,timestamptz),public.get_owner_staff_module_report(uuid,timestamptz,timestamptz),public.get_owner_tables_module_report(uuid,timestamptz,timestamptz),public.get_owner_customers_module_report(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_owner_menu_module_report(uuid,timestamptz,timestamptz),public.get_owner_kitchen_module_report(uuid,timestamptz,timestamptz),public.get_owner_staff_module_report(uuid,timestamptz,timestamptz),public.get_owner_tables_module_report(uuid,timestamptz,timestamptz),public.get_owner_customers_module_report(uuid,timestamptz,timestamptz) to authenticated,service_role;
