-- Phase O10.1: enrich the independent staff module report for the Owner staff center.
create or replace function public.get_owner_staff_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz) returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(
 select i.*,o.customer_name,o.table_number from order_invoices i join orders o on o.id=i.order_id
 where i.restaurant_id=target_restaurant_id and i.verified_at>=range_start and i.verified_at<range_end and i.status in('paid','verified')
), item_metrics as(
 select i.created_by_staff_id staff_id,count(*) filter(where oi.kitchen_status='completed')::int kitchen_tickets_completed,
 round(avg(extract(epoch from(coalesce(o.completed_at,o.updated_at)-coalesce(oi.appended_at,o.payment_verified_at)))/60))::int kitchen_speed
 from eligible i join order_items oi on oi.invoice_id=i.id join orders o on o.id=i.order_id group by i.created_by_staff_id
), shift_metrics as(
 select opened_by staff_id,count(*)::int attendance,round(avg(extract(epoch from(coalesce(closed_at,now())-opened_at))/60))::int average_shift_minutes
 from cashier_shifts where restaurant_id=target_restaurant_id and opened_at>=range_start and opened_at<range_end group by opened_by
), rows as(
 select s.id,s.display_name staff,s.role::text,count(e.id)::int orders_taken,coalesce(sum(e.total_price),0)::numeric revenue_generated,
 coalesce(avg(e.total_price),0)::numeric average_bill,count(distinct coalesce(nullif(e.customer_name,''),e.order_id::text))::int customers_served,
 count(distinct e.table_number) filter(where e.table_number is not null)::int tables_served,count(e.id)::int bills_requested,
 coalesce(im.kitchen_tickets_completed,0) kitchen_tickets_completed,coalesce(im.kitchen_speed,0) kitchen_speed,
 coalesce(sm.attendance,0) attendance,coalesce(sm.average_shift_minutes,0) average_shift_minutes
 from restaurant_staff s left join eligible e on e.created_by_staff_id=s.id left join item_metrics im on im.staff_id=s.id left join shift_metrics sm on sm.staff_id=s.id
 where s.restaurant_id=target_restaurant_id group by s.id,s.display_name,s.role,im.kitchen_tickets_completed,im.kitchen_speed,sm.attendance,sm.average_shift_minutes
)
select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by revenue_generated desc),'[]'::jsonb),'average_shift_minutes',coalesce(avg(average_shift_minutes) filter(where average_shift_minutes>0),0)) from rows x where public.owner_can_report(target_restaurant_id);
$$;
revoke all on function public.get_owner_staff_module_report(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_owner_staff_module_report(uuid,timestamptz,timestamptz) to authenticated,service_role;
