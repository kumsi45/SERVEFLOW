-- An open dining session remains orderable across any number of paid batches.
alter table public.orders
  add column if not exists ordering_locked_at timestamptz,
  add column if not exists ordering_locked_by uuid,
  add column if not exists ordering_lock_reason text;

-- Explicit release owns closure; automatic timeouts no longer close dining sessions.
create or replace function public.expire_stale_dining_sessions(target_restaurant_id uuid default null)
returns integer
language sql
security definer
set search_path = public
as $$ select 0::integer $$;

create or replace function public.is_public_qr_dining_session_open(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    orders.dining_session_status = 'open'
    and orders.table_released_at is null
    and orders.status::text <> 'cancelled',
    false
  )
  from public.orders orders
  where orders.id = target_order_id
$$;

update public.orders
set dining_session_expires_at = null
where dining_session_status = 'open';

create or replace function public.get_waiter_ordering_policy(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.orders;
  waiter public.restaurant_staff;
begin
  select * into target from public.orders orders where orders.id = target_order_id;
  select * into waiter from public.restaurant_staff staff
  where staff.restaurant_id = target.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;
  if target.id is null or waiter.id is null then raise exception 'Active waiter session not found.'; end if;
  if target.dining_session_status <> 'open' then return jsonb_build_object('allowed', false, 'reason', 'Dining session closed.'); end if;
  if target.table_released_at is not null then return jsonb_build_object('allowed', false, 'reason', 'Table released.'); end if;
  if target.status::text = 'cancelled' then return jsonb_build_object('allowed', false, 'reason', 'Dining session cancelled.'); end if;
  if target.ordering_locked_at is not null then return jsonb_build_object('allowed', false, 'reason', coalesce(target.ordering_lock_reason, 'Ordering locked by management.')); end if;
  return jsonb_build_object('allowed', true, 'reason', null);
end;
$$;

create or replace function public.get_waiter_transfer_policy(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.orders;
  waiter public.restaurant_staff;
  restaurant public.restaurants;
  manager_allows boolean;
begin
  select * into target from public.orders orders where orders.id = target_order_id;
  select * into waiter from public.restaurant_staff staff
  where staff.restaurant_id = target.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;
  if target.id is null or waiter.id is null then raise exception 'Active waiter session not found.'; end if;
  select * into restaurant from public.restaurants restaurants where restaurants.id = target.restaurant_id;
  manager_allows := coalesce((restaurant.ordering_settings->>'allow_waiter_table_transfer')::boolean, true);
  if target.dining_session_status <> 'open' or target.table_released_at is not null then return jsonb_build_object('allowed', false, 'reason', 'This dining session is closed.'); end if;
  if exists (select 1 from public.order_items items where items.order_id = target.id and items.kitchen_status = 'preparing') then return jsonb_build_object('allowed', false, 'reason', 'Kitchen preparation is active. Transfer is available after preparation finishes.'); end if;
  if not manager_allows then return jsonb_build_object('allowed', false, 'reason', 'Table transfers are disabled by the manager.'); end if;
  return jsonb_build_object('allowed', true, 'reason', null);
end;
$$;

create or replace function public.submit_waiter_order_batch(
  target_restaurant_slug text,
  table_number text,
  customer_name text,
  customer_phone text,
  order_note text,
  requested_items jsonb,
  client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.waiter_batch_requests;
  restaurant public.restaurants;
  waiter public.restaurant_staff;
  session public.orders;
  new_invoice public.order_invoices;
  payload jsonb;
  added_at timestamptz := clock_timestamp();
  added_total numeric(12, 2);
  item_count integer;
  next_invoice_number integer;
  added_items jsonb;
begin
  select * into existing from public.waiter_batch_requests requests where requests.id = client_request_id;
  if existing.id is not null then return existing.response; end if;

  select * into restaurant from public.restaurants restaurants
  where restaurants.active
    and (restaurants.slug = lower(trim(target_restaurant_slug))
      or restaurants.id::text = lower(trim(target_restaurant_slug))
      or lower(trim(restaurants.name)) = lower(trim(target_restaurant_slug)))
  limit 1;
  select * into waiter from public.restaurant_staff staff
  where staff.restaurant_id = restaurant.id and staff.user_id = auth.uid()
    and staff.active and staff.role::text = 'waiter'
  limit 1;
  if waiter.id is null then raise exception 'Only active waiters may submit order batches.'; end if;
  if jsonb_typeof(requested_items) is distinct from 'array' or jsonb_array_length(requested_items) = 0 then raise exception 'Order must include at least one item.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(restaurant.id::text || ':' || trim(submit_waiter_order_batch.table_number), 0));
  select * into session from public.orders orders
  where orders.restaurant_id = restaurant.id
    and orders.table_number = trim(submit_waiter_order_batch.table_number)
    and orders.dining_session_status = 'open'
    and orders.table_released_at is null
  order by orders.created_at desc limit 1 for update;

  if session.id is null then
    payload := public.create_waiter_order(restaurant.slug, submit_waiter_order_batch.table_number, customer_name, customer_phone, order_note, requested_items);
    update public.orders set dining_session_expires_at = null where id = (payload->>'order_id')::uuid returning * into session;
  else
    if session.status::text = 'cancelled' then raise exception 'This dining session is cancelled.'; end if;
    if session.ordering_locked_at is not null then raise exception '%', coalesce(session.ordering_lock_reason, 'Ordering is locked by management.'); end if;

    with requested as (
      select (item->>'menu_item_id')::uuid menu_item_id,
             (item->>'quantity')::integer quantity,
             nullif(left(trim(coalesce(item->>'notes', '')), 500), '') notes
      from jsonb_array_elements(requested_items) item
    ), valid as (
      select requested.*, menu.name, menu.price
      from requested join public.menu_items menu
        on menu.id = requested.menu_item_id and menu.restaurant_id = restaurant.id and menu.available
      where requested.quantity between 1 and 99
    )
    select count(*), sum(price * quantity),
      jsonb_agg(jsonb_build_object('menu_item_id',menu_item_id,'name',name,'quantity',quantity,'unit_price',price,'line_total',price*quantity,'notes',notes))
    into item_count, added_total, added_items from valid;
    if item_count <> jsonb_array_length(requested_items) or added_total is null then raise exception 'Order contains invalid or unavailable menu items.'; end if;

    select coalesce(max(invoice_number), 0) + 1 into next_invoice_number
    from public.order_invoices invoices where invoices.order_id = session.id;
    insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
    values (restaurant.id, session.id, next_invoice_number, 'pending', added_total, coalesce(session.payment_method, 'Cash'), added_at, added_at)
    returning * into new_invoice;

    insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, appended_at, kitchen_status)
    select restaurant.id, session.id, new_invoice.id, (item->>'menu_item_id')::uuid,
           (item->>'quantity')::integer, menu.price,
           nullif(left(trim(coalesce(item->>'notes', '')),500),''), added_at, 'held'
    from jsonb_array_elements(requested_items) item
    join public.menu_items menu on menu.id=(item->>'menu_item_id')::uuid and menu.restaurant_id=restaurant.id and menu.available;

    update public.orders
    set total_price = total_price + added_total,
        customer_name = coalesce(orders.customer_name, nullif(trim(submit_waiter_order_batch.customer_name),'')),
        customer_phone = coalesce(orders.customer_phone, nullif(trim(submit_waiter_order_batch.customer_phone),'')),
        order_note = coalesce(orders.order_note, nullif(trim(submit_waiter_order_batch.order_note),'')),
        bill_requested_at = null,
        billing_started_at = null,
        dining_session_expires_at = null,
        dining_session_last_activity_at = added_at,
        updated_at = added_at
    where id = session.id returning * into session;

    payload := jsonb_build_object(
      'order_id',session.id,'invoice_id',new_invoice.id,'invoice_number',new_invoice.invoice_number,
      'invoice_status',new_invoice.status,'status',session.status,'total_price',session.total_price,
      'invoice_total',new_invoice.total_price,'table_number',session.table_number,'customer_name',session.customer_name,
      'created_at',session.created_at,'session_action','appended','appended_at',added_at,
      'added_total',added_total,'items_added',added_items
    );
  end if;

  insert into public.waiter_batch_requests (id,restaurant_id,order_id,waiter_staff_id,response)
  values (client_request_id,restaurant.id,(payload->>'order_id')::uuid,waiter.id,payload);
  return payload;
end;
$$;

revoke execute on function public.close_waiter_table(uuid) from authenticated;
revoke all on function public.get_waiter_ordering_policy(uuid) from public, anon;
revoke all on function public.get_waiter_transfer_policy(uuid) from public, anon;
revoke all on function public.submit_waiter_order_batch(text,text,text,text,text,jsonb,uuid) from public, anon;
grant execute on function public.get_waiter_ordering_policy(uuid) to authenticated, service_role;
grant execute on function public.get_waiter_transfer_policy(uuid) to authenticated, service_role;
grant execute on function public.submit_waiter_order_batch(text,text,text,text,text,jsonb,uuid) to authenticated, service_role;
