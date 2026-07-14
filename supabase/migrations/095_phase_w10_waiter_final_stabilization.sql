-- Phase W10 final waiter workflow stabilization.
alter table public.orders add column if not exists bill_requested_at timestamptz, add column if not exists billing_started_at timestamptz, add column if not exists cleaning_started_at timestamptz;
create table if not exists public.waiter_batch_requests(id uuid primary key,restaurant_id uuid not null references restaurants(id) on delete cascade,order_id uuid references orders(id) on delete cascade,waiter_staff_id uuid not null references restaurant_staff(id) on delete cascade,response jsonb,created_at timestamptz not null default now());
alter table public.waiter_batch_requests enable row level security;

create or replace function public.submit_waiter_order_batch(target_restaurant_slug text,table_number text,customer_name text,customer_phone text,order_note text,requested_items jsonb,client_request_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare existing waiter_batch_requests; target_restaurant restaurants; active_order orders; acting_waiter restaurant_staff; payload jsonb;
begin
 select * into existing from waiter_batch_requests where id=client_request_id; if existing.id is not null then return existing.response; end if;
 select * into target_restaurant from restaurants r where r.active and (r.slug=lower(trim(target_restaurant_slug)) or r.id::text=lower(trim(target_restaurant_slug))) limit 1;
 select * into acting_waiter from restaurant_staff s where s.restaurant_id=target_restaurant.id and s.user_id=auth.uid() and s.active and s.role::text='waiter' limit 1;
 if acting_waiter.id is null then raise exception 'Only active waiters may submit order batches.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_restaurant.id::text||':'||trim(table_number),0));
 select * into active_order from orders o where o.restaurant_id=target_restaurant.id and o.table_number=trim(table_number) and public.is_public_qr_dining_session_open(o.id) order by o.created_at desc limit 1 for update;
 if active_order.billing_started_at is not null or exists(select 1 from dining_session_bills b where b.dining_session_id=active_order.id) then raise exception 'Cashier billing has started. Reopen billing before adding items.'; end if;
 payload:=public.create_waiter_order(target_restaurant.slug,table_number,customer_name,customer_phone,order_note,requested_items);
 insert into waiter_batch_requests(id,restaurant_id,order_id,waiter_staff_id,response) values(client_request_id,target_restaurant.id,(payload->>'order_id')::uuid,acting_waiter.id,payload);
 return payload;
end;$$;

create or replace function public.request_waiter_final_bill(target_order_id uuid) returns orders language plpgsql security definer set search_path=public as $$
declare result orders; waiter restaurant_staff;
begin select s.* into waiter from restaurant_staff s join orders o on o.restaurant_id=s.restaurant_id where o.id=target_order_id and s.user_id=auth.uid() and s.active and s.role::text='waiter' limit 1;if waiter.id is null then raise exception 'Active waiter access required.';end if;
 update orders set bill_requested_at=coalesce(bill_requested_at,now()),updated_at=now() where id=target_order_id and dining_session_status='open' returning * into result;if result.id is null then raise exception 'Open dining session not found.';end if;return result;end;$$;

create or replace function public.close_waiter_table(target_order_id uuid) returns orders language plpgsql security definer set search_path=public as $$
declare result orders; waiter restaurant_staff;
begin select s.* into waiter from restaurant_staff s join orders o on o.restaurant_id=s.restaurant_id where o.id=target_order_id and s.user_id=auth.uid() and s.active and s.role::text='waiter' limit 1;if waiter.id is null then raise exception 'Active waiter access required.';end if;
 if exists(select 1 from order_invoices i where i.order_id=target_order_id and i.status not in('verified','refunded','cancelled')) then raise exception 'Table cannot close until every invoice is paid.';end if;
 update orders set dining_session_status='closed',cleaning_started_at=now(),updated_at=now() where id=target_order_id and dining_session_status='open' returning * into result;if result.id is null then raise exception 'Open dining session not found.';end if;return result;end;$$;

revoke all on function public.submit_waiter_order_batch(text,text,text,text,text,jsonb,uuid),public.request_waiter_final_bill(uuid),public.close_waiter_table(uuid) from public,anon;
grant execute on function public.submit_waiter_order_batch(text,text,text,text,text,jsonb,uuid),public.request_waiter_final_bill(uuid),public.close_waiter_table(uuid) to authenticated,service_role;
