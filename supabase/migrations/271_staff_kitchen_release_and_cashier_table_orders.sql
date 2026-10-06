-- C1.1: staff-origin invoice batches release to Kitchen while payment remains due.
-- Existing held rows are not backfilled or touched by this migration.

create or replace function public.resolve_order_workflow(workflow_input jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  restaurant_id text := nullif(btrim(workflow_input->>'restaurant_id'), '');
  waiter_policy text := coalesce(workflow_input->>'waiter_policy', 'pay_before_kitchen');
  order_source text := coalesce(workflow_input->>'order_source', 'unknown');
  session_state text := coalesce(workflow_input->>'dining_session_state', 'open');
  payment_status text := coalesce(workflow_input->>'payment_status', 'unpaid');
  kitchen_status text := coalesce(workflow_input->>'kitchen_status', 'not_started');
  paid boolean;
  released boolean;
begin
  if restaurant_id is null then
    raise exception 'restaurant_id is required for tenant-safe workflow resolution.';
  end if;
  if waiter_policy not in ('pay_before_kitchen', 'kitchen_before_payment', 'mixed') then
    raise exception 'Unsupported waiter workflow policy: %', waiter_policy;
  end if;
  if session_state = 'closed' then
    return jsonb_build_object('next_state', 'closed', 'release_to_kitchen', false,
      'payment_required', false, 'close_dining_session', false,
      'reason', 'Dining session is already closed.');
  end if;
  paid := payment_status = 'paid';
  -- This pure resolver is a projection. Database callers must first establish
  -- staff origin from an authenticated RPC or a tenant-scoped invoice creator.
  released := paid or order_source in ('waiter', 'cashier_pos');
  if not released then
    return jsonb_build_object('next_state', 'cashier_queue', 'release_to_kitchen', false,
      'payment_required', true, 'close_dining_session', false,
      'reason', 'Payment must be verified before kitchen release.');
  elsif kitchen_status = 'ready' then
    return jsonb_build_object('next_state', 'ready', 'release_to_kitchen', true,
      'payment_required', not paid, 'close_dining_session', false,
      'reason', 'Kitchen work is ready for service.');
  elsif kitchen_status = 'completed' and not paid then
    return jsonb_build_object('next_state', 'payment_due', 'release_to_kitchen', true,
      'payment_required', true, 'close_dining_session', false,
      'reason', 'Staff-origin work completed kitchen service before payment.');
  elsif kitchen_status = 'completed' then
    return jsonb_build_object('next_state', 'completed', 'release_to_kitchen', true,
      'payment_required', false, 'close_dining_session', true,
      'reason', 'Kitchen service and payment are complete.');
  end if;
  return jsonb_build_object('next_state', 'kitchen_queue', 'release_to_kitchen', true,
    'payment_required', not paid, 'close_dining_session', false,
    'reason', case when paid then 'Verified payment releases the order to kitchen.'
      else 'Authenticated staff submission releases the items to kitchen.' end);
end;
$$;

-- Public compatibility RPC: a free table opens one dining session. A stale
-- client sees a domain error instead of a raw unique-index diagnostic.
create or replace function public.create_cashier_order(
  target_restaurant_id uuid, table_number text,
  selected_payment_method text, requested_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor public.restaurant_staff;
  payload jsonb;
  target_invoice_id uuid;
  conflict_name text;
begin
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id and staff.user_id = auth.uid()
    and staff.active and staff.role::text = 'cashier' limit 1;
  if actor.id is null then raise exception 'Only active cashiers may create cashier orders.'; end if;
  if nullif(trim(table_number), '') is null then raise exception 'Table number is required.'; end if;
  perform pg_advisory_xact_lock(
    public.service_location_session_lock_key(target_restaurant_id, table_number));
  if exists (
    select 1 from public.orders orders
    where orders.restaurant_id = target_restaurant_id
      and orders.table_number = trim(create_cashier_order.table_number)
      and orders.dining_session_status = 'open'
  ) then
    raise exception 'This table already has an active order. Add items to the existing order.';
  end if;
  payload := public.create_cashier_order_phase234_base(
    target_restaurant_id, table_number, selected_payment_method, requested_items);
  target_invoice_id := nullif(payload->>'invoice_id', '')::uuid;
  if target_invoice_id is null or not exists (
    select 1 from public.order_invoices invoices
    where invoices.id = target_invoice_id
      and invoices.restaurant_id = target_restaurant_id
      and invoices.invoice_source = 'cashier'
      and invoices.created_by_staff_id = actor.id
  ) then raise exception 'Cashier order attribution could not be verified.'; end if;

  update public.order_invoices
  set payment_status = 'held', updated_at = clock_timestamp()
  where id = target_invoice_id and restaurant_id = target_restaurant_id
    and payment_status in ('pending','held');
  update public.order_items items set kitchen_status = 'accepted'
  where items.restaurant_id = target_restaurant_id
    and items.invoice_id = target_invoice_id and items.kitchen_status = 'held';
  return payload || jsonb_build_object(
    'payment_status', 'held', 'created_by_staff_id', actor.id,
    'kitchen_release_item_ids', coalesce((
      select jsonb_agg(items.id order by items.id)
      from public.order_items items
      where items.restaurant_id = target_restaurant_id
        and items.invoice_id = target_invoice_id
    ), '[]'::jsonb));
exception when unique_violation then
  get stacked diagnostics conflict_name = constraint_name;
  if conflict_name in ('orders_one_open_dining_session_per_table',
                       'orders_one_open_dining_session_per_table_id') then
    raise exception 'This table already has an active order. Add items to the existing order.';
  end if;
  raise;
end;
$$;
revoke all on function public.create_cashier_order(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_cashier_order(uuid, text, text, jsonb) to authenticated;

-- A cashier addition is its own invoice batch. This retains the source and
-- payment of earlier QR/Waiter batches on the same dining session.
create or replace function public.append_cashier_order_batch_v271(
  target_order_id uuid, requested_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_order public.orders;
  actor public.restaurant_staff;
  invoice public.order_invoices;
  updated_order public.orders;
  next_invoice_number integer;
  added_at timestamptz := clock_timestamp();
  item_count integer;
  computed_addition numeric(12,2);
  added_item_ids jsonb;
  active_shift_id uuid;
begin
  select * into target_order from public.orders orders
  where orders.id = target_order_id for update;
  if target_order.id is null then raise exception 'Order not found.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target_order.restaurant_id
    and staff.user_id = auth.uid() and staff.active
    and staff.role::text = 'cashier' limit 1;
  if actor.id is null then raise exception 'Only active cashiers may append order items.'; end if;
  if target_order.dining_session_status <> 'open'
    or target_order.table_released_at is not null
    or target_order.status::text = 'cancelled'
    or target_order.ordering_locked_at is not null then
    raise exception 'This table no longer has an order that accepts new items.';
  end if;
  if jsonb_typeof(requested_items) is distinct from 'array'
    or jsonb_array_length(requested_items) not between 1 and 50 then
    raise exception 'Order must include between 1 and 50 line items.';
  end if;
  with normalized as (
    select case when line ? 'menu_item_id' and (line->>'menu_item_id')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (line->>'menu_item_id')::uuid else null end menu_item_id,
      case when (line->>'quantity') ~ '^[0-9]+$'
      then (line->>'quantity')::integer else null end quantity
    from jsonb_array_elements(requested_items) line
  )
  select count(*), sum(menu.price * normalized.quantity)::numeric(12,2)
  into item_count, computed_addition
  from normalized join public.menu_items menu
    on menu.id = normalized.menu_item_id
   and menu.restaurant_id = target_order.restaurant_id and menu.available
  where normalized.quantity between 1 and 99;
  if item_count <> jsonb_array_length(requested_items)
    or computed_addition is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  select coalesce(max(invoices.invoice_number),0)+1 into next_invoice_number
  from public.order_invoices invoices
  where invoices.restaurant_id = target_order.restaurant_id
    and invoices.order_id = target_order.id;
  insert into public.order_invoices (
    restaurant_id, order_id, invoice_number, status, total_price,
    payment_method, invoice_source, created_by_staff_id, created_by_display_name,
    created_at, updated_at
  ) values (
    target_order.restaurant_id, target_order.id, next_invoice_number, 'pending',
    computed_addition, target_order.payment_method, 'cashier', actor.id,
    actor.display_name, added_at, added_at
  ) returning * into invoice;

  with inserted as (
    insert into public.order_items (
      restaurant_id, order_id, invoice_id, menu_item_id,
      quantity, price, notes, appended_at, kitchen_status
    )
    select target_order.restaurant_id, target_order.id, invoice.id, menu.id,
      (line->>'quantity')::integer, menu.price,
      nullif(left(trim(coalesce(line->>'notes','')),500),''), added_at, 'held'
    from jsonb_array_elements(requested_items) line
    join public.menu_items menu
      on menu.id = (line->>'menu_item_id')::uuid
     and menu.restaurant_id = target_order.restaurant_id and menu.available
    returning id
  ) select coalesce(jsonb_agg(id order by id),'[]'::jsonb)
    into added_item_ids from inserted;

  update public.order_invoices
  set payment_status = 'held', updated_at = clock_timestamp()
  where id = invoice.id and restaurant_id = invoice.restaurant_id;
  update public.order_items items set kitchen_status = 'accepted'
  where items.restaurant_id = target_order.restaurant_id
    and items.invoice_id = invoice.id and items.kitchen_status = 'held';

  -- The item-insert financial trigger replaces the invoice's seed amount with
  -- its authoritative subtotal, charges and grand total.
  select * into invoice from public.order_invoices invoices
  where invoices.id = invoice.id and invoices.restaurant_id = target_order.restaurant_id;

  update public.orders orders
  set bill_requested_at = null, billing_started_at = null,
      dining_session_last_activity_at = added_at, updated_at = added_at
  where orders.id = target_order.id and orders.restaurant_id = target_order.restaurant_id
  returning * into updated_order;
  select shifts.id into active_shift_id from public.cashier_shifts shifts
  where shifts.restaurant_id = target_order.restaurant_id
    and shifts.opened_by = actor.id and shifts.closed_at is null
  order by shifts.opened_at desc limit 1;
  insert into public.shift_activity_logs (
    restaurant_id, shift_id, order_id, actor_staff_id,
    action, message, amount, metadata
  ) values (
    target_order.restaurant_id, active_shift_id, target_order.id, actor.id,
    'order_items_appended',
    'Table ' || coalesce(target_order.table_number,'-') || ' added ' || item_count || ' item(s)',
    computed_addition,
    jsonb_build_object('invoice_id',invoice.id,'item_ids',added_item_ids,
      'table_number',target_order.table_number,'timestamp',added_at)
  );
  return public.enrich_business_number_payload(jsonb_build_object(
    'order_id', updated_order.id, 'invoice_id', invoice.id,
    'invoice_number', invoice.invoice_number, 'invoice_status', invoice.status,
    'payment_status', 'held', 'status', updated_order.status,
    'total_price', updated_order.total_price, 'invoice_total', invoice.total_price,
    'table_number', updated_order.table_number, 'payment_method', invoice.payment_method,
    'order_source', updated_order.order_source, 'invoice_source', 'cashier',
    'created_at', updated_order.created_at, 'appended_at', added_at,
    'created_by_staff_id', actor.id, 'kitchen_release_item_ids', added_item_ids,
    'kitchen_batch_key', ((extract(epoch from added_at)*1000000)::bigint)::text,
    'session_action', 'appended'));
end;
$$;
revoke all on function public.append_cashier_order_batch_v271(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_cashier_order_batch_v271(uuid, jsonb)
  to service_role;

create or replace function public.append_items_to_order(
  target_order_id uuid, requested_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare hint public.orders;
begin
  select * into hint from public.orders where id = target_order_id;
  if hint.id is null then raise exception 'Order not found.'; end if;
  if not exists (
    select 1 from public.restaurant_staff staff
    where staff.restaurant_id = hint.restaurant_id
      and staff.user_id = auth.uid() and staff.active and staff.role::text = 'cashier'
  ) then raise exception 'Only active cashiers may append order items.'; end if;
  perform pg_advisory_xact_lock(public.service_location_session_lock_key(
    hint.restaurant_id, hint.table_number));
  select * into hint from public.orders
  where id = target_order_id and restaurant_id = hint.restaurant_id;
  if hint.dining_session_status <> 'open' or hint.table_released_at is not null then
    return public.create_cashier_order(
      hint.restaurant_id, hint.table_number, hint.payment_method, requested_items)
      || jsonb_build_object('session_action','new_after_release',
        'previous_order_id',target_order_id);
  end if;
  return public.append_cashier_order_batch_v271(target_order_id, requested_items);
end;
$$;
revoke all on function public.append_items_to_order(uuid, jsonb) from public, anon;
grant execute on function public.append_items_to_order(uuid, jsonb) to authenticated;
revoke all on function public.resolve_order_workflow(jsonb) from public, anon;
grant execute on function public.resolve_order_workflow(jsonb) to authenticated, service_role;

-- This is the authoritative per-invoice eligibility gate. It never takes a
-- browser-supplied source. Staff origin requires a persisted tenant staff ID.
create or replace function public.invoice_is_kitchen_eligible(
  target_restaurant_id uuid, target_invoice_id uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (public.resolve_order_workflow(jsonb_build_object(
      'restaurant_id', i.restaurant_id,
      'waiter_policy', o.workflow_policy_snapshot,
      'order_source', case
        when i.invoice_source in ('waiter','cashier')
          and exists (
            select 1 from public.restaurant_staff staff
            where staff.id = i.created_by_staff_id
              and staff.restaurant_id = i.restaurant_id
              and staff.role::text = i.invoice_source
          ) then case i.invoice_source when 'cashier' then 'cashier_pos' else 'waiter' end
        when i.invoice_source = 'public_qr' then 'customer_qr'
        else 'unknown' end,
      'dining_session_state', case when o.dining_session_status = 'open'
        then 'open' else 'closed' end,
      'payment_status', case when i.payment_status = 'paid' then 'paid' else 'unpaid' end,
      'kitchen_status', 'not_started'
    ))->>'release_to_kitchen')::boolean
    from public.order_invoices i
    join public.orders o on o.id = i.order_id and o.restaurant_id = i.restaurant_id
    where i.id = target_invoice_id and i.restaurant_id = target_restaurant_id
  ), false);
$$;
revoke all on function public.invoice_is_kitchen_eligible(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.invoice_is_kitchen_eligible(uuid, uuid) to service_role;

create or replace function public.resolve_order_payment_timing(
  target_restaurant_id uuid, target_order_source text
) returns text language sql stable security definer set search_path = public as $$
  select case when target_order_source in ('waiter', 'cashier')
    then 'after_meal' else 'before_kitchen' end
  from public.restaurants where id = target_restaurant_id;
$$;
revoke all on function public.resolve_order_payment_timing(uuid, text) from public, anon;
grant execute on function public.resolve_order_payment_timing(uuid, text) to authenticated, service_role;

create or replace function public.resolve_dining_session_payment_timing(
  target_dining_session_id uuid, target_order_source text
) returns text language sql stable security definer set search_path = public as $$
  select case when coalesce(target_order_source, orders.order_source) in ('waiter', 'cashier')
    then 'after_meal' else 'before_kitchen' end
  from public.orders where id = target_dining_session_id;
$$;
revoke all on function public.resolve_dining_session_payment_timing(uuid, text)
  from public, anon;
grant execute on function public.resolve_dining_session_payment_timing(uuid, text)
  to authenticated, service_role;

create or replace function public.sync_normalized_order_lifecycle()
returns trigger language plpgsql set search_path = public as $$
declare current_policy text;
begin
  if tg_op = 'INSERT' then
    select restaurants.payment_policy into current_policy
    from public.restaurants where restaurants.id = new.restaurant_id;
    if current_policy not in ('pay_before_kitchen','kitchen_before_payment','mixed') then
      raise exception 'Restaurant workflow policy could not be captured.';
    end if;
    new.workflow_policy_snapshot := current_policy;
    new.workflow_version := 2;
    new.workflow_captured_at := clock_timestamp();
  else
    if new.workflow_policy_snapshot is distinct from old.workflow_policy_snapshot
       or new.workflow_version is distinct from old.workflow_version
       or new.workflow_captured_at is distinct from old.workflow_captured_at then
      raise exception 'Dining-session workflow snapshot is immutable.';
    end if;
  end if;

  if tg_op = 'INSERT'
     or new.restaurant_id is distinct from old.restaurant_id
     or new.order_source is distinct from old.order_source then
    new.payment_timing := case when new.order_source in ('waiter','cashier')
      then 'after_meal' else 'before_kitchen' end;
  elsif new.payment_timing is distinct from old.payment_timing then
    raise exception 'Order payment timing is frozen by the dining-session workflow snapshot.';
  end if;
  if new.order_source = 'public_qr' and new.payment_timing <> 'before_kitchen' then
    raise exception 'QR customer orders must be paid before kitchen release.';
  end if;
  if new.payment_timing = 'after_meal'
     and (tg_op = 'INSERT' or new.order_source is distinct from old.order_source
       or new.created_by_waiter_id is distinct from old.created_by_waiter_id) then
    if new.order_source = 'waiter' then
      if new.created_by_waiter_id is null or not exists (
        select 1 from public.restaurant_staff staff
        where staff.id = new.created_by_waiter_id
          and staff.restaurant_id = new.restaurant_id
          and staff.role::text = 'waiter' and staff.active
          and staff.user_id = auth.uid()
      ) then raise exception 'Deferred staff payment requires an authenticated waiter.'; end if;
    elsif new.order_source = 'cashier' then
      if not exists (
        select 1 from public.restaurant_staff staff
        where staff.restaurant_id = new.restaurant_id
          and staff.role::text in ('cashier','owner') and staff.active
          and staff.user_id = auth.uid()
      ) then raise exception 'Deferred staff payment requires an authenticated cashier.'; end if;
    else
      raise exception 'Deferred staff payment requires authenticated staff origin.';
    end if;
  end if;

  if new.dining_session_status::text in ('closed','expired','abandoned')
     or new.table_released_at is not null then new.operational_status := 'closed';
  elsif new.status::text = 'completed' then new.operational_status := 'served';
  elsif new.status::text = 'ready' then new.operational_status := 'ready';
  elsif new.status::text = 'preparing' then new.operational_status := 'preparing';
  elsif new.status::text = 'paid' and new.operational_status = 'new' then
    new.operational_status := 'accepted';
  end if;
  return new;
end;
$$;

-- Preserve canonical cancellation authorization while replacing the release
-- decision with the persisted invoice gate.
create or replace function public.enforce_official_waiter_kitchen_release()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kitchen_status = 'cancelled' then
    if new.cancellation_request_id is null or new.cancelled_by_staff_id is null
      or not exists (
        select 1 from public.order_cancellation_requests requests
        join public.restaurant_staff staff
          on staff.restaurant_id = requests.restaurant_id
         and staff.id = new.cancelled_by_staff_id
         and staff.user_id = auth.uid()
         and staff.active and staff.role::text = 'cashier'
        where requests.id = new.cancellation_request_id
          and requests.restaurant_id = new.restaurant_id
          and requests.order_id = new.order_id
          and requests.status = 'pending_review'
          and (requests.order_item_id = new.id or requests.request_scope = 'order')
      ) then
      raise exception 'Only an authorized pending cashier cancellation may cancel this item.';
    end if;
    return new;
  end if;
  if new.kitchen_status = 'held' then return new; end if;
  if not public.invoice_is_kitchen_eligible(new.restaurant_id, new.invoice_id) then
    new.kitchen_status := 'held';
  end if;
  return new;
end;
$$;

-- One durable response per cashier intent makes an interrupted submission safe
-- to retry. No browser role/source field participates in authorization.
create table public.cashier_batch_requests (
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id),
  cashier_staff_id uuid not null,
  request_fingerprint text not null,
  order_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint cashier_batch_requests_staff_same_restaurant
    foreign key (restaurant_id, cashier_staff_id)
    references public.restaurant_staff(restaurant_id, id),
  constraint cashier_batch_requests_order_same_restaurant
    foreign key (restaurant_id, order_id)
    references public.orders(restaurant_id, id)
);
create index cashier_batch_requests_restaurant_created_idx
  on public.cashier_batch_requests(restaurant_id, created_at desc);
alter table public.cashier_batch_requests enable row level security;
revoke all on public.cashier_batch_requests from public, anon, authenticated;
grant all on public.cashier_batch_requests to service_role;

create or replace function public.submit_cashier_order_batch(
  target_restaurant_id uuid, table_number text,
  selected_payment_method text, requested_items jsonb,
  requested_action text, target_order_id uuid, client_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor public.restaurant_staff;
  existing_request public.cashier_batch_requests;
  active_order public.orders;
  payload jsonb;
  fingerprint text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid() and staff.active
    and staff.role::text = 'cashier' limit 1;
  if actor.id is null then raise exception 'Only active cashiers may submit orders.'; end if;
  if client_request_id is null then raise exception 'A submission request ID is required.'; end if;
  if requested_action not in ('create','append') then
    raise exception 'Unsupported order submission action.';
  end if;
  if nullif(trim(table_number),'') is null then raise exception 'Table number is required.'; end if;
  fingerprint := md5(jsonb_build_object(
    'restaurant_id',target_restaurant_id, 'table_number',trim(table_number),
    'payment_method',selected_payment_method,'items',requested_items,
    'action',requested_action,'target_order_id',target_order_id)::text);
  perform pg_advisory_xact_lock(hashtextextended(client_request_id::text, 271));
  select * into existing_request from public.cashier_batch_requests requests
  where requests.id = client_request_id;
  if existing_request.id is not null then
    if existing_request.restaurant_id <> target_restaurant_id
      or existing_request.cashier_staff_id <> actor.id
      or existing_request.request_fingerprint <> fingerprint then
      raise exception 'This submission ID belongs to a different order request.';
    end if;
    return existing_request.response;
  end if;

  if not exists (
    select 1 from public.restaurant_tables tables
    where tables.restaurant_id = target_restaurant_id
      and tables.table_number::text = trim(submit_cashier_order_batch.table_number) and tables.active
  ) then raise exception 'Select an active table in this restaurant.'; end if;
  perform pg_advisory_xact_lock(public.service_location_session_lock_key(
    target_restaurant_id, table_number));
  select * into active_order from public.orders orders
  where orders.restaurant_id = target_restaurant_id
    and orders.table_number = trim(submit_cashier_order_batch.table_number)
    and orders.dining_session_status = 'open'
    and orders.table_released_at is null
  limit 1 for update;
  if requested_action = 'create' then
    if active_order.id is not null then
      raise exception 'This table already has an active order. Add items to the existing order.';
    end if;
    if target_order_id is not null then
      raise exception 'A new order cannot specify an existing order ID.';
    end if;
    payload := public.create_cashier_order(
      target_restaurant_id, table_number, selected_payment_method, requested_items)
      || jsonb_build_object('session_action','created');
  else
    if active_order.id is null or target_order_id is null
      or active_order.id <> target_order_id then
      raise exception 'The active order changed. Refresh the table and try again.';
    end if;
    payload := public.append_cashier_order_batch_v271(active_order.id, requested_items);
  end if;
  insert into public.cashier_batch_requests (
    id, restaurant_id, cashier_staff_id, request_fingerprint, order_id, response
  ) values (
    client_request_id,target_restaurant_id,actor.id,fingerprint,
    (payload->>'order_id')::uuid,payload
  );
  return payload;
end;
$$;
revoke all on function public.submit_cashier_order_batch(
  uuid, text, text, jsonb, text, uuid, uuid
) from public, anon;
grant execute on function public.submit_cashier_order_batch(
  uuid, text, text, jsonb, text, uuid, uuid
) to authenticated;

-- Replace order-wide payment filtering with the authoritative invoice gate.
CREATE OR REPLACE FUNCTION public.get_station_kitchen_orders(target_restaurant_id uuid, target_station_id uuid DEFAULT NULL::uuid, include_all_stations boolean DEFAULT false, log_queue_view boolean DEFAULT false)
 RETURNS TABLE(id uuid, display_number text, kitchen_ticket_number text, kitchen_batch_key text, status text, customer_name text, table_number text, payment_method text, total_price numeric, created_at timestamp with time zone, payment_verified_at timestamp with time zone, preparation_started_at timestamp with time zone, ready_marked_at timestamp with time zone, items jsonb, station_progress jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  acting_staff public.restaurant_staff;
  effective_station_id uuid;
  selected_station public.kitchen_stations;
begin
  if auth.uid() is null then raise exception 'Authentication is required to view kitchen orders.'; end if;
  if target_restaurant_id is null then raise exception 'Restaurant is required.'; end if;

  select * into acting_staff
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role in ('kitchen', 'owner')
    and active = true
  order by created_at asc
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may view kitchen orders.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      raise exception 'Kitchen station assignment required.';
    end if;
    effective_station_id := acting_staff.assigned_kitchen_station_id;
  elsif include_all_stations then
    effective_station_id := null;
  elsif target_station_id is not null then
    select * into selected_station
    from public.kitchen_stations
    where id = target_station_id
      and restaurant_id = target_restaurant_id
      and active = true
      and archived_at is null;
    if selected_station.id is null then raise exception 'Kitchen station not found.'; end if;
    effective_station_id := target_station_id;
  else
    effective_station_id := null;
  end if;

  if log_queue_view then
    perform public.log_staff_activity(
      target_restaurant_id,
      acting_staff.id,
      'kitchen_station_queue_viewed',
      null,
      jsonb_build_object('station_id', effective_station_id, 'role', acting_staff.role::text)
    );
  end if;

  return query
  with active_batches as (
    select
      orders.id order_id,
      order_items.invoice_id,
      order_items.kitchen_station_id,
      coalesce(case
        when order_items.appended_at is null then null
        else ((extract(epoch from order_items.appended_at) * 1000000)::bigint)::text
      end, 'initial') kitchen_batch_key
    from public.orders
    join public.order_items
      on order_items.restaurant_id = orders.restaurant_id
     and order_items.order_id = orders.id
    join public.order_invoices
      on order_invoices.restaurant_id = order_items.restaurant_id
     and order_invoices.id = order_items.invoice_id
     and order_invoices.order_id = orders.id
    where orders.restaurant_id = target_restaurant_id
      and orders.operational_status in ('accepted', 'preparing', 'ready')
      and orders.dining_session_status = 'open'
      and orders.table_released_at is null
      and public.invoice_is_kitchen_eligible(order_invoices.restaurant_id, order_invoices.id)
      and order_items.kitchen_status in ('accepted', 'preparing', 'ready')
      and order_items.kitchen_station_id is not null
      and (effective_station_id is null or order_items.kitchen_station_id = effective_station_id)
    group by orders.id, order_items.invoice_id, order_items.kitchen_station_id, order_items.appended_at
  )
  select
    orders.id,
    orders.display_number,
    invoices.kitchen_ticket_number,
    batches.kitchen_batch_key,
    case
      when count(*) filter (where order_items.kitchen_status = 'accepted') = count(*) then 'accepted'
      when count(*) filter (where order_items.kitchen_status = 'ready') = count(*) then 'ready'
      else 'preparing'
    end,
    orders.customer_name,
    orders.table_number,
    orders.payment_method,
    coalesce(sum(order_items.price * order_items.quantity), 0)::numeric,
    orders.created_at,
    invoices.paid_at,
    coalesce(min(order_items.kitchen_preparation_started_at), orders.preparation_started_at),
    coalesce(max(order_items.kitchen_ready_marked_at), orders.ready_marked_at),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', order_items.id,
      'order_id', order_items.order_id,
      'quantity', order_items.quantity,
      'price', order_items.price,
      'notes', order_items.notes,
      'appended_at', order_items.appended_at,
      'kitchen_station_id', order_items.kitchen_station_id,
      'kitchen_station_name', kitchen_stations.name,
      'kitchen_status', order_items.kitchen_status,
      'menu_item_name', menu_items.name
    ) order by order_items.created_at, order_items.id), '[]'::jsonb),
    jsonb_build_array(jsonb_build_object(
      'station_id', batches.kitchen_station_id,
      'station_name', max(kitchen_stations.name),
      'station_status', case
        when count(*) filter (where order_items.kitchen_status = 'accepted') = count(*) then 'accepted'
        when count(*) filter (where order_items.kitchen_status = 'ready') = count(*) then 'ready'
        else 'preparing'
      end,
      'item_count', count(*)::integer,
      'ready_count', count(*) filter (where order_items.kitchen_status = 'ready')::integer,
      'completed_count', count(*) filter (where order_items.kitchen_status = 'completed')::integer,
      'started_at', min(order_items.kitchen_preparation_started_at),
      'ready_at', max(order_items.kitchen_ready_marked_at),
      'completed_at', max(order_items.kitchen_completed_at)
    ))
  from active_batches batches
  join public.orders
    on orders.id = batches.order_id
   and orders.restaurant_id = target_restaurant_id
  join public.order_invoices invoices
    on invoices.restaurant_id = orders.restaurant_id
   and invoices.id = batches.invoice_id
   and invoices.order_id = orders.id
  join public.order_items
    on order_items.restaurant_id = orders.restaurant_id
   and order_items.order_id = orders.id
   and order_items.invoice_id = batches.invoice_id
   and order_items.kitchen_station_id = batches.kitchen_station_id
   and (
     (batches.kitchen_batch_key = 'initial' and order_items.appended_at is null)
     or (batches.kitchen_batch_key <> 'initial' and ((extract(epoch from order_items.appended_at) * 1000000)::bigint)::text = batches.kitchen_batch_key)
   )
   and order_items.kitchen_status in ('accepted', 'preparing', 'ready')
  left join public.menu_items
    on menu_items.restaurant_id = order_items.restaurant_id
   and menu_items.id = order_items.menu_item_id
  left join public.kitchen_stations
    on kitchen_stations.restaurant_id = order_items.restaurant_id
   and kitchen_stations.id = order_items.kitchen_station_id
  group by orders.id, invoices.kitchen_ticket_number, invoices.paid_at, batches.kitchen_station_id, batches.kitchen_batch_key
  order by coalesce(min(order_items.appended_at), invoices.paid_at, orders.created_at), orders.created_at;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transition_station_kitchen_items(target_order_id uuid, target_station_id uuid, target_batch_key text, from_statuses text[], to_status text, acting_staff_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_order public.orders;
  batch_total integer;
  eligible_total integer;
  completed_total integer;
  seen_status text;
  changed integer;
begin
  target_batch_key := coalesce(target_batch_key, 'initial');

  select * into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then raise exception 'Order not found.'; end if;
  if target_order.operational_status in ('closed', 'served')
     or target_order.dining_session_status <> 'open'
     or target_order.table_released_at is not null then
    raise exception 'Order closed.';
  end if;
  if target_batch_key is null then raise exception 'Batch not found.'; end if;

  select count(*),
         count(*) filter (where items.kitchen_status = any(from_statuses)),
         count(*) filter (where items.kitchen_status = 'completed'),
         min(items.kitchen_status)
  into batch_total, eligible_total, completed_total, seen_status
  from public.order_items items
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id
   and invoices.id = items.invoice_id
   and invoices.order_id = items.order_id
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_station_id = target_station_id
    and (
      (target_batch_key = 'initial' and items.appended_at is null)
      or ((extract(epoch from items.appended_at) * 1000000)::bigint)::text = target_batch_key
    )
    and public.invoice_is_kitchen_eligible(invoices.restaurant_id, invoices.id);

  if batch_total = 0 then
    if exists (
      select 1
      from public.order_items items
      where items.restaurant_id = target_order.restaurant_id
        and items.order_id = target_order.id
        and (
          (target_batch_key = 'initial' and items.appended_at is null)
          or ((extract(epoch from items.appended_at) * 1000000)::bigint)::text = target_batch_key
        )
    ) then
      raise exception 'Wrong station.';
    end if;
    raise exception 'Batch not found.';
  end if;

  if completed_total = batch_total then raise exception 'Batch completed.'; end if;
  if eligible_total = 0 then
    if seen_status = 'preparing' then raise exception 'Batch already preparing.'; end if;
    if seen_status = 'ready' then raise exception 'Batch already ready.'; end if;
    raise exception 'Batch cannot transition from its current state.';
  end if;

  update public.order_items items
  set kitchen_status = to_status,
      kitchen_preparation_started_at = case when to_status = 'preparing' then coalesce(items.kitchen_preparation_started_at, now()) else items.kitchen_preparation_started_at end,
      kitchen_preparation_started_by = case when to_status = 'preparing' then coalesce(items.kitchen_preparation_started_by, acting_staff_id) else items.kitchen_preparation_started_by end,
      kitchen_ready_marked_at = case when to_status = 'ready' then coalesce(items.kitchen_ready_marked_at, now()) else items.kitchen_ready_marked_at end,
      kitchen_ready_marked_by = case when to_status = 'ready' then coalesce(items.kitchen_ready_marked_by, acting_staff_id) else items.kitchen_ready_marked_by end,
      kitchen_completed_at = case when to_status = 'completed' then coalesce(items.kitchen_completed_at, now()) else items.kitchen_completed_at end,
      kitchen_completed_by = case when to_status = 'completed' then coalesce(items.kitchen_completed_by, acting_staff_id) else items.kitchen_completed_by end
  from public.order_invoices invoices
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_station_id = target_station_id
    and (
      (target_batch_key = 'initial' and items.appended_at is null)
      or ((extract(epoch from items.appended_at) * 1000000)::bigint)::text = target_batch_key
    )
    and items.kitchen_status = any(from_statuses)
    and invoices.restaurant_id = items.restaurant_id
    and invoices.id = items.invoice_id
    and invoices.order_id = items.order_id
    and public.invoice_is_kitchen_eligible(invoices.restaurant_id, invoices.id);

  get diagnostics changed = row_count;
  return changed;
end;
$function$
;

-- Keep cashier queue labels and lifecycle diagnostics invoice-specific.
CREATE OR REPLACE FUNCTION public.get_cashier_workflow_foundation(target_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare actor public.restaurant_staff; result jsonb;
begin
  select * into actor from public.restaurant_staff
  where restaurant_id=target_restaurant_id and user_id=auth.uid() and active
    and role in ('cashier','owner') limit 1;
  if actor.id is null then raise exception 'Only active cashiers and owners may view cashier workflow.'; end if;

  with invoice_rows as (
    select i.*,o.table_number,o.customer_name,o.display_number as order_number,o.bill_requested_at,o.bill_prepared_at,o.bill_printed_at,o.bill_request_ignored_at,
      o.payment_timing,o.operational_status as order_status,
      coalesce(i.invoice_source,o.order_source,'unknown') as source,
      creator.display_name as waiter_name,
      r.id as receipt_job_id,r.status as receipt_job_status,r.processed_at as receipt_processed_at,
      case
        when i.payment_status='cancelled' then 'cancelled'
        when i.payment_status='refunded' then 'refunded'
        when r.status in ('printed','reprinted','processed') and o.dining_session_status='closed' then 'closed'
        when r.status in ('printed','reprinted','processed') then 'receipt_printed'
        when i.payment_status='paid' then 'paid'
        when i.payment_status='held' and i.payment_recorded_at is not null then 'payment_submitted'
        else 'pending_payment'
      end as invoice_lifecycle,
      case
        when i.status='rejected' or i.rejected_at is not null then 'rejected'
        when i.duplicate_override_at is not null then 'duplicate'
        when i.payment_status='paid' then 'verified'
        when i.payment_status='cancelled' then 'expired'
        when i.payment_recorded_at is not null then 'submitted'
        else 'waiting'
      end as verification_status
    from public.order_invoices i
    join public.orders o on o.restaurant_id=i.restaurant_id and o.id=i.order_id
    left join public.restaurant_staff creator on creator.restaurant_id=i.restaurant_id and creator.id=i.created_by_staff_id
    left join public.receipt_generation_events r on r.restaurant_id=i.restaurant_id and r.invoice_id=i.id
    where i.restaurant_id=target_restaurant_id
      and (o.dining_session_status='open' or i.created_at>=now()-interval '36 hours')
  ), queue as (
    select jsonb_build_object(
      'invoice_id',id,'invoice_number',invoice_number,'invoice_display_number',display_number,
      'invoice_lifecycle',invoice_lifecycle,'verification_status',verification_status,
      'payment_status',payment_status,'table_number',table_number,'order_number',order_number,
      'customer_name',customer_name,'waiter_name',waiter_name,'source',source,
      'payment_method',public.normalize_payment_method(payment_method),'amount',grand_total,
      'submitted_at',payment_recorded_at,'reference_number',reference_number,
      'screenshot_available',(screenshot_url is not null),'screenshot_url',screenshot_url,
      'rejection_reason',rejection_reason,'created_at',created_at,'bill_requested_at',bill_requested_at,'bill_status',case when bill_request_ignored_at is not null then 'ignored' when bill_printed_at is not null then 'printed' when bill_prepared_at is not null then 'prepared' when bill_requested_at is not null then 'requested' else null end,
      'receipt_job_id',receipt_job_id,
      'receipt_status',case receipt_job_status when 'pending' then 'waiting' when 'processing' then 'waiting' when 'processed' then 'printed' else receipt_job_status end
    ) row_json,* from invoice_rows
  ), assistance as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'request_id',a.id,'request_type',a.request_type,'table_number',t.table_number,
      'requested_at',a.requested_at,'priority',case when a.priority='urgent' or a.requested_at<now()-interval '5 minutes' then 'urgent' else 'normal' end,
      'status',a.status,'order_id',a.order_id) order by a.requested_at),'[]'::jsonb) rows
    from public.waiter_assistance_requests a
    join public.restaurant_tables t on t.restaurant_id=a.restaurant_id and t.id=a.table_id
    where a.restaurant_id=target_restaurant_id and a.status in ('pending','acknowledged')
  ), settlement as (
    select jsonb_build_object(
      'cash_collected',coalesce(sum(grand_total) filter(where payment_status='paid' and public.normalize_payment_method(payment_method)='Cash'),0),
      'digital_collected',coalesce(sum(grand_total) filter(where payment_status='paid' and public.normalize_payment_method(payment_method)<>'Cash'),0),
      'pending_payments',count(*) filter(where payment_status in ('pending','held')),
      'verified_payments',count(*) filter(where payment_status='paid'),
      'rejected_payments',count(*) filter(where verification_status='rejected'),
      'ready_for_daily_closing',count(*) filter(where payment_status in ('pending','held'))=0
    ) row_json from invoice_rows where created_at>=date_trunc('day',now())
  )
  select jsonb_build_object(
    'restaurant_id',target_restaurant_id,'viewer_role',actor.role,'generated_at',now(),
    'payment_submitted_queue',coalesce((select jsonb_agg(row_json order by payment_recorded_at desc) from queue where verification_status='submitted'),'[]'::jsonb),
    'waiter_payment_due_queue',coalesce((select jsonb_agg(row_json order by created_at) from queue where source='waiter' and payment_status in ('pending','held')),'[]'::jsonb),
    'cash_payment_queue',coalesce((select jsonb_agg(row_json order by created_at) from queue where public.normalize_payment_method(payment_method)='Cash' and payment_status in ('pending','held')),'[]'::jsonb),
    'digital_payment_queue',coalesce((select jsonb_agg(row_json order by payment_recorded_at) from queue where public.normalize_payment_method(payment_method)<>'Cash' and verification_status='submitted'),'[]'::jsonb),
    'verification_queue',coalesce((select jsonb_agg(row_json order by payment_recorded_at desc nulls last) from queue where verification_status in ('submitted','rejected','expired','duplicate')),'[]'::jsonb),
    'receipt_queue',coalesce((select jsonb_agg(row_json order by created_at) from queue where receipt_job_id is not null and receipt_job_status<>'cancelled'),'[]'::jsonb),
    'daily_settlement',(select row_json from settlement),
    'bill_requested_queue',coalesce((select jsonb_agg(row_json order by bill_requested_at) from queue where bill_requested_at is not null and bill_request_ignored_at is null),'[]'::jsonb),
    'payment_retry_queue',coalesce((select jsonb_agg(row_json order by retry_requested_at desc) from queue where retry_requested_at is not null or verification_status='rejected'),'[]'::jsonb),
    'receipt_pending_queue',coalesce((select jsonb_agg(row_json order by created_at) from queue where receipt_job_status in('pending','processing','waiting')),'[]'::jsonb),
    'invoice_settlement_queue',coalesce((select jsonb_agg(row_json order by created_at) from queue where payment_status='paid' and invoice_lifecycle<>'closed'),'[]'::jsonb),
    'customer_assistance_queue',(select rows from assistance)
  ) into result;
  return result;
end;$function$
;
CREATE OR REPLACE FUNCTION public.validate_canonical_lifecycle(target_restaurant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(severity text, entity_type text, record_id uuid, restaurant_id uuid, rule text, detail jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'FAIL', 'order', orders.id, orders.restaurant_id,
         'closed_order_has_active_kitchen_items',
         jsonb_build_object('operational_status', orders.operational_status)
  from public.orders
  where (target_restaurant_id is null or orders.restaurant_id = target_restaurant_id)
    and (
      orders.operational_status in ('served', 'closed')
      or orders.dining_session_status <> 'open'
      or orders.table_released_at is not null
    )
    and exists (
      select 1
      from public.order_items items
      where items.restaurant_id = orders.restaurant_id
        and items.order_id = orders.id
        and items.kitchen_status in ('accepted', 'preparing', 'ready')
    )
  union all
  select 'FAIL', 'item', items.id, items.restaurant_id,
         'kitchen_item_released_without_canonical_payment',
         jsonb_build_object('kitchen_status', items.kitchen_status, 'payment_status', invoices.payment_status)
  from public.order_items items
  join public.orders orders
    on orders.restaurant_id = items.restaurant_id
   and orders.id = items.order_id
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id
   and invoices.id = items.invoice_id
   and invoices.order_id = items.order_id
  where (target_restaurant_id is null or items.restaurant_id = target_restaurant_id)
    and items.kitchen_status in ('accepted', 'preparing', 'ready', 'completed')
    and not public.invoice_is_kitchen_eligible(invoices.restaurant_id, invoices.id)
  union all
  select 'FAIL', 'invoice', invoices.id, invoices.restaurant_id,
         'invoice_restaurant_mismatch',
         jsonb_build_object('order_id', invoices.order_id)
  from public.order_invoices invoices
  join public.orders orders on orders.id = invoices.order_id
  where (target_restaurant_id is null or invoices.restaurant_id = target_restaurant_id)
    and invoices.restaurant_id <> orders.restaurant_id
  union all
  select 'FAIL', 'item', items.id, items.restaurant_id,
         'item_restaurant_mismatch',
         jsonb_build_object('order_id', items.order_id, 'invoice_id', items.invoice_id)
  from public.order_items items
  join public.orders orders on orders.id = items.order_id
  join public.order_invoices invoices on invoices.id = items.invoice_id
  where (target_restaurant_id is null or items.restaurant_id = target_restaurant_id)
    and (items.restaurant_id <> orders.restaurant_id or items.restaurant_id <> invoices.restaurant_id)
;
$function$
;

-- C1.1: Waiter append financial correction
-- Item insertion refreshes invoice and order totals; do not add raw item value again.
CREATE OR REPLACE FUNCTION public.submit_waiter_order_batch_phase7a1_base(target_restaurant_slug text, table_number text, customer_name text, customer_phone text, order_note text, requested_items jsonb, client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if client_request_id is null then raise exception 'A Waiter request ID is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(client_request_id::text, 155));
  select * into existing from public.waiter_batch_requests requests where requests.id = client_request_id;
  if existing.id is not null then
    if existing.restaurant_id <> restaurant.id or existing.waiter_staff_id <> waiter.id
      or not exists (
        select 1 from public.orders orders where orders.id = existing.order_id
          and orders.restaurant_id = restaurant.id
          and orders.table_number = trim(submit_waiter_order_batch_phase7a1_base.table_number)
      ) then
      raise exception 'This Waiter request ID belongs to another order request.';
    end if;
    return existing.response;
  end if;
  if jsonb_typeof(requested_items) is distinct from 'array' or jsonb_array_length(requested_items) = 0 then raise exception 'Order must include at least one item.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(restaurant.id::text || ':' || trim(submit_waiter_order_batch_phase7a1_base.table_number), 0));
  select * into session from public.orders orders
  where orders.restaurant_id = restaurant.id
    and orders.table_number = trim(submit_waiter_order_batch_phase7a1_base.table_number)
    and orders.dining_session_status = 'open'
    and orders.table_released_at is null
  order by orders.created_at desc limit 1 for update;

  if session.id is null then
    payload := public.create_waiter_order(restaurant.slug, submit_waiter_order_batch_phase7a1_base.table_number, customer_name, customer_phone, order_note, requested_items);
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
    set customer_name = coalesce(orders.customer_name, nullif(trim(submit_waiter_order_batch_phase7a1_base.customer_name),'')),
        customer_phone = coalesce(orders.customer_phone, nullif(trim(submit_waiter_order_batch_phase7a1_base.customer_phone),'')),
        order_note = coalesce(orders.order_note, nullif(trim(submit_waiter_order_batch_phase7a1_base.order_note),'')),
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
$function$
;
