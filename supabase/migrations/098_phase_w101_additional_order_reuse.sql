-- Phase W10.1: reuse the open dining session and its single pending final invoice.
create or replace function public.submit_waiter_order_batch(target_restaurant_slug text,table_number text,customer_name text,customer_phone text,order_note text,requested_items jsonb,client_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare existing waiter_batch_requests; restaurant restaurants; waiter restaurant_staff; session orders; final_invoice order_invoices; payload jsonb; added_at timestamptz:=clock_timestamp(); added_total numeric(12,2); item_count int; added_items jsonb;
begin
 select * into existing from waiter_batch_requests w where w.id=client_request_id;if existing.id is not null then return existing.response;end if;
 select * into restaurant from restaurants r where r.active and (r.slug=lower(trim(target_restaurant_slug)) or r.id::text=lower(trim(target_restaurant_slug)) or lower(trim(r.name))=lower(trim(target_restaurant_slug))) limit 1;
 select * into waiter from restaurant_staff s where s.restaurant_id=restaurant.id and s.user_id=auth.uid() and s.active and s.role::text='waiter' limit 1;if waiter.id is null then raise exception 'Only active waiters may submit order batches.';end if;
 if jsonb_typeof(requested_items) is distinct from 'array' or jsonb_array_length(requested_items)=0 then raise exception 'Order must include at least one item.';end if;
 perform pg_advisory_xact_lock(hashtextextended(restaurant.id::text||':'||trim(submit_waiter_order_batch.table_number),0));
 select * into session from orders o where o.restaurant_id=restaurant.id and o.table_number=trim(submit_waiter_order_batch.table_number) and o.dining_session_status='open' order by o.created_at desc limit 1 for update;
 -- A terminal paid/expired row is stale occupancy, not the customer's current seating.
 if session.id is not null and not public.is_public_qr_dining_session_open(session.id) and session.status::text in('completed','paid','cancelled') then update orders set dining_session_status=case when status::text='cancelled' then 'expired' else 'closed' end,updated_at=now() where id=session.id;session:=null;end if;
 if session.id is null then
   payload:=public.create_waiter_order(restaurant.slug,submit_waiter_order_batch.table_number,customer_name,customer_phone,order_note,requested_items);
   update order_items set kitchen_status='paid' where order_id=(payload->>'order_id')::uuid and invoice_id=(payload->>'invoice_id')::uuid and kitchen_status='held';
   update orders set status='paid',updated_at=now() where id=(payload->>'order_id')::uuid returning * into session;
   payload:=payload||jsonb_build_object('status',session.status);
 else
   if session.billing_started_at is not null or exists(select 1 from dining_session_bills b where b.dining_session_id=session.id) then raise exception 'Cashier billing has started. Reopen billing before adding items.';end if;
   select * into final_invoice from order_invoices i where i.order_id=session.id and i.status='pending' order by i.invoice_number limit 1 for update;
   if final_invoice.id is null then raise exception 'This dining session is already paid. Start a new seating after closing the table.';end if;
   with requested as(select (x->>'menu_item_id')::uuid menu_item_id,(x->>'quantity')::int quantity,nullif(left(trim(coalesce(x->>'notes','')),500),'') notes from jsonb_array_elements(requested_items)x),valid as(select q.*,m.name,m.price from requested q join menu_items m on m.id=q.menu_item_id and m.restaurant_id=restaurant.id and m.available where q.quantity between 1 and 99)
   select count(*),sum(price*quantity),jsonb_agg(jsonb_build_object('menu_item_id',menu_item_id,'name',name,'quantity',quantity,'unit_price',price,'line_total',price*quantity,'notes',notes)) into item_count,added_total,added_items from valid;
   if item_count<>jsonb_array_length(requested_items) or added_total is null then raise exception 'Order contains invalid or unavailable menu items.';end if;
   insert into order_items(restaurant_id,order_id,invoice_id,menu_item_id,quantity,price,notes,appended_at,kitchen_status) select restaurant.id,session.id,final_invoice.id,(x->>'menu_item_id')::uuid,(x->>'quantity')::int,m.price,nullif(left(trim(coalesce(x->>'notes','')),500),''),added_at,'paid' from jsonb_array_elements(requested_items)x join menu_items m on m.id=(x->>'menu_item_id')::uuid and m.restaurant_id=restaurant.id and m.available;
   update order_invoices set total_price=total_price+added_total,updated_at=added_at where id=final_invoice.id returning * into final_invoice;
   update orders set total_price=total_price+added_total,status='paid',customer_name=coalesce(orders.customer_name,nullif(trim(submit_waiter_order_batch.customer_name),'')),customer_phone=coalesce(orders.customer_phone,nullif(trim(submit_waiter_order_batch.customer_phone),'')),order_note=coalesce(orders.order_note,nullif(trim(submit_waiter_order_batch.order_note),'')),dining_session_expires_at=added_at+get_dining_session_timeout(restaurant.id),dining_session_last_activity_at=added_at,updated_at=added_at where id=session.id returning * into session;
   payload:=jsonb_build_object('order_id',session.id,'invoice_id',final_invoice.id,'invoice_number',final_invoice.invoice_number,'invoice_status',final_invoice.status,'status',session.status,'total_price',session.total_price,'invoice_total',final_invoice.total_price,'table_number',session.table_number,'customer_name',session.customer_name,'created_at',session.created_at,'session_action','appended','appended_at',added_at,'added_total',added_total,'items_added',added_items);
 end if;
 insert into waiter_batch_requests(id,restaurant_id,order_id,waiter_staff_id,response) values(client_request_id,restaurant.id,(payload->>'order_id')::uuid,waiter.id,payload);return payload;
end;$$;
revoke all on function public.submit_waiter_order_batch(text,text,text,text,text,jsonb,uuid) from public,anon;
grant execute on function public.submit_waiter_order_batch(text,text,text,text,text,jsonb,uuid) to authenticated,service_role;
