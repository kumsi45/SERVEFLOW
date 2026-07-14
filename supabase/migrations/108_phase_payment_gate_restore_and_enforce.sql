-- Restore the core POS payment gate:
-- submitted -> cashier pending -> cashier verified -> kitchen paid queue.

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
    -- create_waiter_order creates a pending invoice and HELD items.
    -- Do not release those items; cashier verification owns that transition.
    payload := public.create_waiter_order(
      restaurant.slug,
      submit_waiter_order_batch.table_number,
      customer_name,
      customer_phone,
      order_note,
      requested_items
    );
    select * into session from public.orders orders where orders.id = (payload->>'order_id')::uuid;
    payload := payload || jsonb_build_object('status', session.status);
  else
    select * into target_invoice
    from public.order_invoices invoices
    where invoices.order_id = session.id
      and invoices.status = 'pending'
      and invoices.verified_at is null
    order by invoices.invoice_number desc
    limit 1
    for update;

    if target_invoice.id is null then raise exception 'This dining session is paid. Ordering is closed.'; end if;

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
      menu.price, nullif(left(trim(coalesce(item->>'notes', '')), 500), ''), added_at, 'held'
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
        status = 'pending_payment',
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

-- Repair items prematurely released by the old waiter function.
update public.order_items items
set kitchen_status = 'held',
    kitchen_preparation_started_at = null,
    kitchen_preparation_started_by = null,
    kitchen_ready_marked_at = null,
    kitchen_ready_marked_by = null,
    kitchen_completed_at = null,
    kitchen_completed_by = null
from public.order_invoices invoices,
     public.orders orders
where invoices.id = items.invoice_id
  and orders.id = items.order_id
  and orders.dining_session_status = 'open'
  and orders.payment_verified_at is null
  and invoices.status in ('pending', 'paid', 'rejected')
  and invoices.verified_at is null
  and items.kitchen_status <> 'held';

update public.orders orders
set status = 'pending_payment', updated_at = now()
where orders.dining_session_status = 'open'
  and orders.payment_verified_at is null
  and exists (
    select 1 from public.order_invoices invoices
    where invoices.order_id = orders.id and invoices.status = 'pending' and invoices.verified_at is null
  );

delete from public.kitchen_order_station_progress progress
where exists (
    select 1 from public.orders orders
    where orders.id = progress.order_id
      and orders.dining_session_status = 'open'
      and orders.payment_verified_at is null
  )
  and exists (
    select 1 from public.order_invoices invoices
    where invoices.order_id = progress.order_id
      and invoices.status in ('pending', 'paid', 'rejected')
      and invoices.verified_at is null
  )
  and not exists (
    select 1 from public.order_invoices invoices
    where invoices.order_id = progress.order_id and invoices.status = 'verified' and invoices.verified_at is not null
  );

create or replace function public.enforce_verified_invoice_kitchen_gate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  invoice_verified boolean;
begin
  if new.kitchen_status = 'held' then return new; end if;
  select invoices.status = 'verified' and invoices.verified_at is not null
  into invoice_verified
  from public.order_invoices invoices
  where invoices.id = new.invoice_id and invoices.restaurant_id = new.restaurant_id;
  if not coalesce(invoice_verified, false) then
    raise exception 'Kitchen release requires cashier-verified payment.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_verified_invoice_kitchen_gate_trigger on public.order_items;
create trigger enforce_verified_invoice_kitchen_gate_trigger
before insert or update of kitchen_status, invoice_id on public.order_items
for each row execute function public.enforce_verified_invoice_kitchen_gate();

revoke all on function public.submit_waiter_order_batch(text, text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.submit_waiter_order_batch(text, text, text, text, text, jsonb, uuid) to authenticated, service_role;
