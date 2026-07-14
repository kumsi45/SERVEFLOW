-- Phase W10.2: state-driven waiter POS.
-- A table tap owns navigation; an open dining session owns all later batches.

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
  target_invoice public.order_invoices;
  payload jsonb;
  added_at timestamptz := clock_timestamp();
  added_total numeric(12, 2);
  item_count integer;
  added_items jsonb;
begin
  select * into existing from public.waiter_batch_requests requests where requests.id = client_request_id;
  if existing.id is not null then return existing.response; end if;

  select * into restaurant
  from public.restaurants restaurants
  where restaurants.active
    and (
      restaurants.slug = lower(trim(target_restaurant_slug))
      or restaurants.id::text = lower(trim(target_restaurant_slug))
      or lower(trim(restaurants.name)) = lower(trim(target_restaurant_slug))
    )
  limit 1;

  select * into waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = restaurant.id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;

  if waiter.id is null then raise exception 'Only active waiters may submit order batches.'; end if;
  if jsonb_typeof(requested_items) is distinct from 'array' or jsonb_array_length(requested_items) = 0 then
    raise exception 'Order must include at least one item.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(restaurant.id::text || ':' || trim(submit_waiter_order_batch.table_number), 0));

  select * into session
  from public.orders orders
  where orders.restaurant_id = restaurant.id
    and orders.table_number = trim(submit_waiter_order_batch.table_number)
    and orders.dining_session_status = 'open'
  order by orders.created_at desc
  limit 1
  for update;

  if session.id is not null
     and not public.is_public_qr_dining_session_open(session.id)
     and session.status::text in ('completed', 'paid', 'cancelled')
     and not exists (
       select 1 from public.order_invoices invoices
       where invoices.order_id = session.id and invoices.status in ('pending', 'paid', 'rejected')
     ) then
    update public.orders
    set dining_session_status = case when status::text = 'cancelled' then 'expired' else 'closed' end,
        updated_at = now()
    where id = session.id;
    session := null;
  end if;

  if session.id is null then
    payload := public.create_waiter_order(
      restaurant.slug,
      submit_waiter_order_batch.table_number,
      customer_name,
      customer_phone,
      order_note,
      requested_items
    );
    update public.order_items
    set kitchen_status = 'paid'
    where order_id = (payload->>'order_id')::uuid
      and invoice_id = (payload->>'invoice_id')::uuid
      and kitchen_status = 'held';
    update public.orders
    set status = 'paid', updated_at = now()
    where id = (payload->>'order_id')::uuid
    returning * into session;
    payload := payload || jsonb_build_object('status', session.status);
  else
    -- Bill requested / cashier waiting are service states, not ordering locks.
    -- Only a fully paid session has no mutable pending invoice.
    select * into target_invoice
    from public.order_invoices invoices
    where invoices.order_id = session.id
      and invoices.status = 'pending'
      and invoices.verified_at is null
    order by invoices.invoice_number desc
    limit 1
    for update;

    if target_invoice.id is null then
      raise exception 'This dining session is paid. Ordering is closed.';
    end if;

    with requested as (
      select
        (item->>'menu_item_id')::uuid as menu_item_id,
        (item->>'quantity')::integer as quantity,
        nullif(left(trim(coalesce(item->>'notes', '')), 500), '') as notes
      from jsonb_array_elements(requested_items) item
    ), valid as (
      select requested.*, menu.name, menu.price
      from requested
      join public.menu_items menu
        on menu.id = requested.menu_item_id
       and menu.restaurant_id = restaurant.id
       and menu.available
      where requested.quantity between 1 and 99
    )
    select count(*), sum(price * quantity),
      jsonb_agg(jsonb_build_object(
        'menu_item_id', menu_item_id,
        'name', name,
        'quantity', quantity,
        'unit_price', price,
        'line_total', price * quantity,
        'notes', notes
      ))
    into item_count, added_total, added_items
    from valid;

    if item_count <> jsonb_array_length(requested_items) or added_total is null then
      raise exception 'Order contains invalid or unavailable menu items.';
    end if;

    insert into public.order_items (
      restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, appended_at, kitchen_status
    )
    select
      restaurant.id, session.id, target_invoice.id,
      (item->>'menu_item_id')::uuid, (item->>'quantity')::integer,
      menu.price, nullif(left(trim(coalesce(item->>'notes', '')), 500), ''), added_at, 'paid'
    from jsonb_array_elements(requested_items) item
    join public.menu_items menu
      on menu.id = (item->>'menu_item_id')::uuid
     and menu.restaurant_id = restaurant.id
     and menu.available;

    update public.order_invoices
    set total_price = total_price + added_total, updated_at = added_at
    where id = target_invoice.id
    returning * into target_invoice;

    update public.orders
    set total_price = total_price + added_total,
        status = 'paid',
        customer_name = coalesce(orders.customer_name, nullif(trim(submit_waiter_order_batch.customer_name), '')),
        customer_phone = coalesce(orders.customer_phone, nullif(trim(submit_waiter_order_batch.customer_phone), '')),
        order_note = coalesce(orders.order_note, nullif(trim(submit_waiter_order_batch.order_note), '')),
        dining_session_expires_at = added_at + public.get_dining_session_timeout(restaurant.id),
        dining_session_last_activity_at = added_at,
        updated_at = added_at
    where id = session.id
    returning * into session;

    payload := jsonb_build_object(
      'order_id', session.id,
      'invoice_id', target_invoice.id,
      'invoice_number', target_invoice.invoice_number,
      'invoice_status', target_invoice.status,
      'status', session.status,
      'total_price', session.total_price,
      'invoice_total', target_invoice.total_price,
      'table_number', session.table_number,
      'customer_name', session.customer_name,
      'created_at', session.created_at,
      'session_action', 'appended',
      'appended_at', added_at,
      'added_total', added_total,
      'items_added', added_items
    );
  end if;

  insert into public.waiter_batch_requests (id, restaurant_id, order_id, waiter_staff_id, response)
  values (client_request_id, restaurant.id, (payload->>'order_id')::uuid, waiter.id, payload);
  return payload;
end;
$$;

create or replace function public.split_waiter_bill(target_order_id uuid, target_item_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.orders;
  waiter public.restaurant_staff;
  new_invoice public.order_invoices;
  selected_total numeric(12, 2);
  selected_count integer;
  pending_item_count integer;
  next_invoice_number integer;
begin
  select * into session from public.orders orders where orders.id = target_order_id for update;
  select * into waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = session.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;

  if waiter.id is null then raise exception 'Active waiter access required.'; end if;
  if session.dining_session_status <> 'open' then raise exception 'This dining session is closed.'; end if;
  if coalesce(array_length(target_item_ids, 1), 0) = 0 then raise exception 'Select items to split.'; end if;

  select count(*) into pending_item_count
  from public.order_items items
  join public.order_invoices invoices on invoices.id = items.invoice_id
  where items.order_id = session.id and invoices.status = 'pending' and invoices.verified_at is null;

  select count(*), sum(items.quantity * items.price)
  into selected_count, selected_total
  from public.order_items items
  join public.order_invoices invoices on invoices.id = items.invoice_id
  where items.order_id = session.id
    and items.id = any(target_item_ids)
    and invoices.status = 'pending'
    and invoices.verified_at is null;

  if selected_count <> coalesce(array_length(target_item_ids, 1), 0) then
    raise exception 'Only unpaid items can be split.';
  end if;
  if selected_count >= pending_item_count then raise exception 'At least one item must remain on the original bill.'; end if;

  select coalesce(max(invoice_number), 0) + 1 into next_invoice_number
  from public.order_invoices invoices where invoices.order_id = session.id;

  insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method)
  values (session.restaurant_id, session.id, next_invoice_number, 'pending', selected_total, session.payment_method)
  returning * into new_invoice;

  update public.order_items
  set invoice_id = new_invoice.id
  where order_id = session.id and id = any(target_item_ids);

  update public.order_invoices invoices
  set total_price = totals.total, updated_at = now()
  from (
    select items.invoice_id, sum(items.quantity * items.price)::numeric(12, 2) as total
    from public.order_items items where items.order_id = session.id group by items.invoice_id
  ) totals
  where invoices.order_id = session.id and invoices.id = totals.invoice_id;

  delete from public.order_invoices invoices
  where invoices.order_id = session.id
    and invoices.id <> new_invoice.id
    and invoices.status = 'pending'
    and not exists (select 1 from public.order_items items where items.invoice_id = invoices.id);

  return jsonb_build_object(
    'order_id', session.id,
    'invoice_id', new_invoice.id,
    'invoice_number', new_invoice.invoice_number,
    'invoice_total', new_invoice.total_price,
    'items_moved', selected_count
  );
end;
$$;

create or replace function public.get_waiter_session_detail(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.orders;
  waiter public.restaurant_staff;
  result jsonb;
begin
  select * into target from public.orders orders where orders.id = target_order_id;
  select * into waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;
  if target.id is null or waiter.id is null then raise exception 'Active waiter session not found.'; end if;

  select jsonb_build_object(
    'order_id', target.id,
    'session_number', coalesce(target.dining_session_display_number, target.display_number, target.id::text),
    'opened_at', coalesce(target.dining_session_opened_at, target.created_at),
    'order_status', target.status,
    'dining_session_status', target.dining_session_status,
    'bill_requested_at', target.bill_requested_at,
    'billing_started_at', target.billing_started_at,
    'payment_verified_at', target.payment_verified_at,
    'customer_name', target.customer_name,
    'source', target.order_source,
    'creator_name', creator.display_name,
    'waiter_name', coalesce(creator.display_name, waiter.display_name),
    'total', target.total_price,
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invoices.id,
        'display_number', coalesce(invoices.display_number, 'Bill ' || invoices.invoice_number),
        'status', invoices.status,
        'total', invoices.total_price,
        'created_at', invoices.created_at,
        'creator_name', coalesce(staff.display_name, invoices.created_by_display_name),
        'source', invoices.invoice_source,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', items.id,
            'name', menu.name,
            'quantity', items.quantity,
            'price', items.price,
            'kitchen_status', items.kitchen_status
          ) order by items.created_at)
          from public.order_items items
          join public.menu_items menu on menu.id = items.menu_item_id
          where items.invoice_id = invoices.id
        ), '[]'::jsonb)
      ) order by invoices.invoice_number)
      from public.order_invoices invoices
      left join public.restaurant_staff staff on staff.id = invoices.created_by_staff_id
      where invoices.order_id = target.id
    ), '[]'::jsonb)
  ) into result
  from public.restaurant_staff creator
  where creator.id = target.created_by_waiter_id;

  if result is null then
    result := jsonb_build_object(
      'order_id', target.id,
      'session_number', coalesce(target.dining_session_display_number, target.display_number, target.id::text),
      'opened_at', coalesce(target.dining_session_opened_at, target.created_at),
      'order_status', target.status,
      'dining_session_status', target.dining_session_status,
      'bill_requested_at', target.bill_requested_at,
      'billing_started_at', target.billing_started_at,
      'payment_verified_at', target.payment_verified_at,
      'customer_name', target.customer_name,
      'source', target.order_source,
      'creator_name', waiter.display_name,
      'waiter_name', waiter.display_name,
      'total', target.total_price,
      'invoices', '[]'::jsonb
    );
  end if;
  return result;
end;
$$;

create or replace function public.get_waiter_order_metrics(target_order_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  waiter public.restaurant_staff;
  result jsonb;
begin
  select * into waiter from public.restaurant_staff staff
  where staff.user_id = auth.uid() and staff.active and staff.role::text = 'waiter' limit 1;
  if waiter.id is null then raise exception 'Active waiter access required.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id', orders.id,
    'total', orders.total_price,
    'invoice_count', (select count(*) from public.order_invoices invoices where invoices.order_id = orders.id),
    'session_number', coalesce(orders.dining_session_display_number, orders.display_number, orders.id::text),
    'invoice_numbers', coalesce((select jsonb_agg(coalesce(invoices.display_number, 'Bill ' || invoices.invoice_number) order by invoices.invoice_number) from public.order_invoices invoices where invoices.order_id = orders.id), '[]'::jsonb),
    'ready_item_count', (select count(*) from public.order_items items where items.order_id = orders.id and items.kitchen_status = 'ready'),
    'item_count', (select coalesce(sum(items.quantity), 0) from public.order_items items where items.order_id = orders.id),
    'bill_requested_at', orders.bill_requested_at,
    'billing_started_at', orders.billing_started_at,
    'payment_verified_at', case when exists (select 1 from public.order_invoices invoices where invoices.order_id = orders.id and invoices.status = 'verified') and not exists (select 1 from public.order_invoices invoices where invoices.order_id = orders.id and invoices.status not in ('verified', 'refunded', 'cancelled')) then orders.payment_verified_at else null end
  )), '[]'::jsonb)
  into result
  from public.orders orders
  where orders.restaurant_id = waiter.restaurant_id and orders.id = any(target_order_ids);
  return result;
end;
$$;

revoke all on function public.submit_waiter_order_batch(text, text, text, text, text, jsonb, uuid) from public, anon;
revoke all on function public.split_waiter_bill(uuid, uuid[]) from public, anon;
revoke all on function public.get_waiter_session_detail(uuid) from public, anon;
revoke all on function public.get_waiter_order_metrics(uuid[]) from public, anon;
grant execute on function public.submit_waiter_order_batch(text, text, text, text, text, jsonb, uuid) to authenticated, service_role;
grant execute on function public.split_waiter_bill(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.get_waiter_session_detail(uuid) to authenticated, service_role;
grant execute on function public.get_waiter_order_metrics(uuid[]) to authenticated, service_role;
