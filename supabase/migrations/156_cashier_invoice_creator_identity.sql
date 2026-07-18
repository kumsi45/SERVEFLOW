-- Make cashier identity authoritative for new and historical cashier batches.

alter function public.create_cashier_order(uuid, text, text, jsonb)
rename to create_cashier_order_phase156_base;

create or replace function public.create_cashier_order(
  target_restaurant_id uuid,
  table_number text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  actor public.restaurant_staff;
  target_invoice_id uuid;
begin
  payload := public.create_cashier_order_phase156_base(
    target_restaurant_id, table_number, selected_payment_method, requested_items
  );

  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text in ('cashier', 'owner')
  limit 1;

  target_invoice_id := nullif(payload->>'invoice_id', '')::uuid;
  if target_invoice_id is null then
    select invoices.id into target_invoice_id
    from public.order_invoices invoices
    where invoices.restaurant_id = target_restaurant_id
      and invoices.order_id = nullif(payload->>'order_id', '')::uuid
    order by invoices.created_at desc, invoices.invoice_number desc
    limit 1;
  end if;

  if actor.id is null or target_invoice_id is null then
    raise exception 'Cashier invoice ownership could not be established.';
  end if;

  perform public.stamp_invoice_ownership(
    target_invoice_id, 'cashier', actor.id, actor.display_name
  );

  return payload || jsonb_build_object(
    'invoice_id', target_invoice_id,
    'invoice_source', 'cashier',
    'invoice_creator_name', actor.display_name,
    'created_by_staff_id', actor.id
  );
end;
$$;

revoke all on function public.create_cashier_order(uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.create_cashier_order(uuid, text, text, jsonb)
  to authenticated, service_role;

-- Repair historical cashier invoices using the immutable order-created audit.
with ownership as (
  select distinct on (invoices.id)
    invoices.id as invoice_id,
    logs.actor_staff_id,
    staff.display_name
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  join public.shift_activity_logs logs
    on logs.restaurant_id = orders.restaurant_id
   and logs.order_id = orders.id
   and logs.action = 'order_created'
   and logs.actor_staff_id is not null
  join public.restaurant_staff staff
    on staff.restaurant_id = logs.restaurant_id
   and staff.id = logs.actor_staff_id
  where orders.order_source = 'cashier'
    and (invoices.invoice_source is null
      or invoices.invoice_source = 'unknown'
      or invoices.created_by_staff_id is null)
  order by invoices.id, logs.created_at
)
update public.order_invoices invoices
set invoice_source = 'cashier',
    created_by_staff_id = ownership.actor_staff_id,
    created_by_display_name = ownership.display_name,
    updated_at = clock_timestamp()
from ownership
where invoices.id = ownership.invoice_id;

create or replace function public.get_cashier_payment_queue(target_restaurant_id uuid)
returns setof jsonb language plpgsql security definer set search_path=public as $$
declare actor public.restaurant_staff;
begin
  select * into actor from public.restaurant_staff where restaurant_id=target_restaurant_id and user_id=auth.uid() and active and role in ('cashier','owner') limit 1;
  if actor.id is null then raise exception 'Only active cashiers and owners may view payment queue.'; end if;
  return query
  select jsonb_build_object(
    'invoice_id',i.id,'invoice_number',i.invoice_number,'invoice_display_number',i.display_number,
    'kitchen_ticket_number',i.kitchen_ticket_number,
    'invoice_source',case when coalesce(i.invoice_source,'unknown')='unknown' then coalesce(o.order_source,'unknown') else i.invoice_source end,
    'invoice_creator_name',coalesce(c.display_name,nullif(i.created_by_display_name,'Unknown'),audit_actor.display_name,
      case when o.order_source='cashier' then 'Cashier' when o.order_source='waiter' then 'Waiter' end),
    'invoice_kitchen_status',public.invoice_kitchen_status(i.id),
    'payment_status',i.payment_status,'invoice_status',i.payment_status,'paid_at',coalesce(i.verified_at,i.paid_at),
    'collected_by',v.display_name,'dining_session_id',o.id,'dining_session_display_number',o.dining_session_display_number,
    'dining_session_status',o.dining_session_status::text,'id',o.id,'display_number',o.display_number,
    'operational_status',o.operational_status,'status',o.operational_status,'customer_name',o.customer_name,
    'customer_phone',o.customer_phone,'table_number',o.table_number,
    'order_source',case when coalesce(i.invoice_source,'unknown')='unknown' then coalesce(o.order_source,'unknown') else i.invoice_source end,
    'waiter_name',coalesce(c.display_name,nullif(i.created_by_display_name,'Unknown'),audit_actor.display_name),
    'order_note',o.order_note,
    'payment_method',coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method)),
    'total_price',i.total_price,'order_total_price',o.total_price,'created_at',i.created_at,
    'payment_timing',o.payment_timing,'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',x.id,'order_id',x.order_id,'invoice_id',x.invoice_id,'quantity',x.quantity,'price',x.price,
      'notes',x.notes,'appended_at',x.appended_at,'kitchen_status',x.kitchen_status,'menu_item_name',m.name)
      order by x.created_at,x.id) from public.order_items x left join public.menu_items m on m.restaurant_id=x.restaurant_id and m.id=x.menu_item_id
      where x.restaurant_id=i.restaurant_id and x.invoice_id=i.id),'[]'::jsonb))
  from public.order_invoices i join public.orders o on o.restaurant_id=i.restaurant_id and o.id=i.order_id
  left join public.restaurant_staff c on c.restaurant_id=i.restaurant_id and c.id=i.created_by_staff_id
  left join public.restaurant_staff v on v.restaurant_id=i.restaurant_id and v.id=i.verified_by
  left join lateral (
    select staff.display_name from public.shift_activity_logs logs
    join public.restaurant_staff staff on staff.restaurant_id=logs.restaurant_id and staff.id=logs.actor_staff_id
    where logs.restaurant_id=o.restaurant_id and logs.order_id=o.id and logs.action='order_created'
    order by logs.created_at limit 1
  ) audit_actor on true
  where i.restaurant_id=target_restaurant_id and i.payment_status<>'cancelled'
    and (o.dining_session_status='open' or i.created_at>=now()-interval '36 hours')
  order by case i.payment_status when 'held' then 0 when 'pending' then 1 else 2 end,i.created_at desc;
end;$$;

revoke all on function public.get_cashier_payment_queue(uuid) from public,anon;
grant execute on function public.get_cashier_payment_queue(uuid) to authenticated;

