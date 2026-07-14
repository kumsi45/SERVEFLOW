-- Phase O9.4: financial and audit module services consumed by Reports Center.
create or replace function public.get_owner_financial_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz)
returns jsonb language sql stable security definer set search_path=public as $$
with eligible as(
  select i.total_price::numeric total_price,
    case when lower(coalesce(i.payment_method,''))='cash' then 'Cash' when lower(coalesce(i.payment_method,'')) like '%telebirr%' then 'Telebirr' when lower(coalesce(i.payment_method,'')) like '%cbe%' then 'CBE Birr' when lower(coalesce(i.payment_method,'')) ~ '(card|credit|debit)' then 'Card' else 'Other Digital' end method
  from order_invoices i where i.restaurant_id=target_restaurant_id and i.status in('paid','verified') and i.verified_at>=range_start and i.verified_at<range_end
), totals as(select coalesce(sum(total_price),0) gross from eligible), methods as(select method,count(*)::int invoices,sum(total_price)::numeric revenue from eligible group by method)
select jsonb_build_object(
 'revenue',jsonb_build_array(jsonb_build_object('metric','Total Revenue','value',gross),jsonb_build_object('metric','Gross Revenue','value',gross),jsonb_build_object('metric','VAT','value',gross-(gross/1.15)),jsonb_build_object('metric','Net Revenue','value',gross/1.15)),
 'payments',coalesce((select jsonb_agg(to_jsonb(m) order by revenue desc) from methods m),'[]'::jsonb),
 'tax',jsonb_build_array(jsonb_build_object('metric','Gross Revenue','value',gross),jsonb_build_object('metric','VAT','value',gross-(gross/1.15)),jsonb_build_object('metric','Net Revenue','value',gross/1.15))
) from totals where public.owner_can_report(target_restaurant_id);
$$;

create or replace function public.get_owner_audit_module_report(target_restaurant_id uuid,range_start timestamptz,range_end timestamptz)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('timestamp',a.created_at,'action',a.action::text,'performed_by',coalesce(s.display_name,'System'),'target',coalesce(t.display_name,a.target_staff_email,'—')) order by a.created_at desc),'[]'::jsonb))
from staff_activity_log a left join restaurant_staff s on s.id=a.performed_by_staff_id left join restaurant_staff t on t.id=a.target_staff_id
where a.restaurant_id=target_restaurant_id and a.created_at>=range_start and a.created_at<range_end and public.owner_can_report(target_restaurant_id);
$$;

revoke all on function public.get_owner_financial_module_report(uuid,timestamptz,timestamptz),public.get_owner_audit_module_report(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_owner_financial_module_report(uuid,timestamptz,timestamptz),public.get_owner_audit_module_report(uuid,timestamptz,timestamptz) to authenticated,service_role;
