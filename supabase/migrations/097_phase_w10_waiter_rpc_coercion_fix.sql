-- Phase W10: remove waiter direct-select coercion failures and ambiguous parameters.
create or replace function public.submit_waiter_order_batch(target_restaurant_slug text,table_number text,customer_name text,customer_phone text,order_note text,requested_items jsonb,client_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare existing waiter_batch_requests; target_restaurant restaurants; active_order orders; acting_waiter restaurant_staff; payload jsonb;
begin
 select * into existing from waiter_batch_requests w where w.id=client_request_id; if existing.id is not null then return existing.response; end if;
 select * into target_restaurant from restaurants r where r.active and (r.slug=lower(trim(target_restaurant_slug)) or r.id::text=lower(trim(target_restaurant_slug))) limit 1;
 select * into acting_waiter from restaurant_staff s where s.restaurant_id=target_restaurant.id and s.user_id=auth.uid() and s.active and s.role::text='waiter' limit 1;
 if acting_waiter.id is null then raise exception 'Only active waiters may submit order batches.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_restaurant.id::text||':'||trim(submit_waiter_order_batch.table_number),0));
 select * into active_order from orders o where o.restaurant_id=target_restaurant.id and o.table_number=trim(submit_waiter_order_batch.table_number) and public.is_public_qr_dining_session_open(o.id) order by o.created_at desc limit 1 for update;
 if active_order.billing_started_at is not null or exists(select 1 from dining_session_bills b where b.dining_session_id=active_order.id) then raise exception 'Cashier billing has started. Reopen billing before adding items.'; end if;
 payload:=public.create_waiter_order(target_restaurant.slug,submit_waiter_order_batch.table_number,customer_name,customer_phone,order_note,requested_items);
 insert into waiter_batch_requests(id,restaurant_id,order_id,waiter_staff_id,response) values(client_request_id,target_restaurant.id,(payload->>'order_id')::uuid,acting_waiter.id,payload);
 return payload;
end;$$;

create or replace function public.get_waiter_session_detail(target_order_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare target orders; waiter restaurant_staff; result jsonb;
begin
 select * into target from orders o where o.id=target_order_id;
 select * into waiter from restaurant_staff s where s.restaurant_id=target.restaurant_id and s.user_id=auth.uid() and s.active and s.role::text='waiter' limit 1;
 if target.id is null or waiter.id is null then raise exception 'Active waiter session not found.'; end if;
 select jsonb_build_object('order_id',target.id,'session_number',coalesce(target.dining_session_display_number,target.display_number,target.id::text),'opened_at',coalesce(target.dining_session_opened_at,target.created_at),'customer_name',target.customer_name,'source',target.order_source,'creator_name',creator.display_name,'total',target.total_price,'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'display_number',coalesce(i.display_number,'Batch '||i.invoice_number),'status',i.status,'total',i.total_price,'created_at',i.created_at,'creator_name',coalesce(s.display_name,i.created_by_display_name),'source',i.invoice_source,'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',m.name,'quantity',x.quantity,'price',x.price,'kitchen_status',x.kitchen_status) order by x.created_at) from order_items x join menu_items m on m.id=x.menu_item_id where x.invoice_id=i.id),'[]'::jsonb)) order by i.created_at) from order_invoices i left join restaurant_staff s on s.id=i.created_by_staff_id where i.order_id=target.id),'[]'::jsonb)) into result from restaurant_staff creator where creator.id=target.created_by_waiter_id;
 if result is null then select jsonb_build_object('order_id',target.id,'session_number',coalesce(target.dining_session_display_number,target.display_number,target.id::text),'opened_at',coalesce(target.dining_session_opened_at,target.created_at),'customer_name',target.customer_name,'source',target.order_source,'creator_name',waiter.display_name,'total',target.total_price,'invoices','[]'::jsonb) into result;end if;
 return result;
end;$$;

create or replace function public.get_waiter_order_metrics(target_order_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare waiter restaurant_staff; result jsonb;
begin select * into waiter from restaurant_staff s where s.user_id=auth.uid() and s.active and s.role::text='waiter' limit 1;if waiter.id is null then raise exception 'Active waiter access required.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('order_id',o.id,'total',o.total_price,'invoice_count',(select count(*) from order_invoices i where i.order_id=o.id),'session_number',coalesce(o.dining_session_display_number,o.display_number,o.id::text),'invoice_numbers',coalesce((select jsonb_agg(coalesce(i.display_number,'Batch '||i.invoice_number) order by i.created_at) from order_invoices i where i.order_id=o.id),'[]'::jsonb),'ready_item_count',(select count(*) from order_items x where x.order_id=o.id and x.kitchen_status='ready'),'item_count',(select count(*) from order_items x where x.order_id=o.id),'bill_requested_at',o.bill_requested_at,'billing_started_at',o.billing_started_at,'payment_verified_at',o.payment_verified_at)),'[]'::jsonb) into result from orders o where o.restaurant_id=waiter.restaurant_id and o.id=any(target_order_ids);return result;end;$$;

revoke all on function public.get_waiter_session_detail(uuid),public.get_waiter_order_metrics(uuid[]) from public,anon;
grant execute on function public.get_waiter_session_detail(uuid),public.get_waiter_order_metrics(uuid[]) to authenticated,service_role;
