-- Cashier theft-prevention Phase B: persistent restaurant obligation visibility.
-- Restaurant obligations are invoice-owned and restaurant-wide. Cashier shifts
-- remain settlement/accounting containers and never become debt owners.

create or replace function public.restaurant_unresolved_obligation_summary(
  target_restaurant_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'unresolved_obligation_count', count(*)::integer,
    'served_unpaid_count', count(*) filter (
      where orders.operational_status = 'served'
    )::integer,
    'unresolved_total', coalesce(sum(invoices.grand_total), 0)::numeric(12, 2),
    'oldest_unresolved_created_at', min(invoices.created_at),
    'oldest_unresolved_age_seconds', case
      when min(invoices.created_at) is null then null
      else floor(extract(epoch from (now() - min(invoices.created_at))))::bigint
    end
  )
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  where invoices.restaurant_id = target_restaurant_id
    and invoices.payment_status in ('pending', 'held')
$$;

revoke all on function public.restaurant_unresolved_obligation_summary(uuid)
from public, anon, authenticated;
grant execute on function public.restaurant_unresolved_obligation_summary(uuid)
to service_role;

comment on function public.restaurant_unresolved_obligation_summary(uuid) is
  'Internal restaurant-wide pending/held invoice summary. Independent of cashier shifts, cashier identity, session state, and invoice age.';

create index if not exists order_invoices_unresolved_obligations_idx
on public.order_invoices (restaurant_id, created_at, id)
where payment_status in ('pending', 'held');

create index if not exists order_cancellation_requests_unresolved_lookup_idx
on public.order_cancellation_requests (restaurant_id, order_id, status)
where status in ('pending_review', 'manager_review_required');

create or replace function public.get_restaurant_unresolved_obligations(
  target_restaurant_id uuid
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor public.restaurant_staff;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view restaurant obligations.';
  end if;

  select *
  into actor
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text in ('cashier', 'manager', 'owner')
  limit 1;

  if actor.id is null then
    raise exception 'Only active cashiers, managers, and owners may view restaurant obligations.';
  end if;

  return query
  select jsonb_build_object(
    'obligation_id', invoices.id,
    'invoice_id', invoices.id,
    'invoice_number', invoices.invoice_number,
    'invoice_display_number', invoices.display_number,
    'kitchen_ticket_number', invoices.kitchen_ticket_number,
    'order_id', orders.id,
    'dining_session_id', orders.id,
    'order_display_number', orders.display_number,
    'dining_session_display_number', orders.dining_session_display_number,
    'table_id', orders.table_id,
    'table_number', orders.table_number,
    'service_location_label', tables.label,
    'source', case
      when coalesce(invoices.invoice_source, 'unknown') = 'unknown'
        then coalesce(orders.order_source, 'unknown')
      else invoices.invoice_source
    end,
    'operational_status', orders.operational_status,
    'financial_status', invoices.payment_status,
    'payment_status', invoices.payment_status,
    'total_amount', invoices.grand_total,
    'amount_due', invoices.grand_total,
    'created_at', invoices.created_at,
    'served_at', orders.completed_at,
    'age_seconds', floor(extract(epoch from (now() - invoices.created_at)))::bigint,
    'served_unpaid', orders.operational_status = 'served',
    'bill_requested', orders.bill_requested_at is not null,
    'bill_requested_at', orders.bill_requested_at,
    'dining_session_status', orders.dining_session_status,
    'session_is_open', orders.dining_session_status = 'open',
    'settlement_eligible', true,
    'requires_open_cashier_shift_to_settle', true,
    'cashier_shift_id', invoices.cashier_shift_id,
    'receipt_status', receipt.status,
    'receipt_event_type', receipt.event_type,
    'receipt_created_at', receipt.created_at,
    'pending_cancellation_request', exists (
      select 1
      from public.order_cancellation_requests requests
      where requests.restaurant_id = invoices.restaurant_id
        and requests.order_id = invoices.order_id
        and requests.status in ('pending_review', 'manager_review_required')
    )
  )
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  left join public.restaurant_tables tables
    on tables.restaurant_id = orders.restaurant_id
   and tables.id = orders.table_id
  left join lateral (
    select events.status, events.event_type, events.created_at
    from public.receipt_generation_events events
    where events.restaurant_id = invoices.restaurant_id
      and events.invoice_id = invoices.id
    order by events.created_at desc
    limit 1
  ) receipt on true
  where invoices.restaurant_id = target_restaurant_id
    and invoices.payment_status in ('pending', 'held')
  order by
    case when orders.operational_status = 'served' then 0 else 1 end,
    invoices.created_at,
    invoices.id;
end;
$$;

revoke all on function public.get_restaurant_unresolved_obligations(uuid)
from public, anon;
grant execute on function public.get_restaurant_unresolved_obligations(uuid)
to authenticated;

comment on function public.get_restaurant_unresolved_obligations(uuid) is
  'Canonical tenant-scoped restaurant obligation ledger for active cashier, manager, and owner staff. Pending/held invoices remain visible without shift or age filtering.';

-- Preserve bounded terminal history while ensuring unresolved debt never ages
-- out of the existing operational cashier queue.
do $$
declare
  definition text;
  old_filter text := 'and (o.dining_session_status=''open'' or i.created_at>=now()-interval ''36 hours'')';
  new_filter text := 'and (i.payment_status in (''pending'',''held'') or o.dining_session_status=''open'' or i.created_at>=now()-interval ''36 hours'')';
begin
  select pg_get_functiondef('public.get_cashier_payment_queue(uuid)'::regprocedure)
  into definition;

  if position(old_filter in definition) > 0 then
    execute replace(definition, old_filter, new_filter);
  elsif position(new_filter in definition) = 0 then
    raise exception 'Cashier payment queue age filter could not be updated safely.';
  end if;
end $$;

-- The authenticated customer RPC was a dormant legacy path that created
-- financially relevant items without an invoice. Keep its public contract but
-- make the order, invoice, and item linkage atomic. Public QR and waiter RPCs
-- are separate, already invoice-backed paths and are not changed here.
create or replace function public.create_customer_order(
  target_restaurant_slug text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  target_order public.orders;
  target_invoice public.order_invoices;
  requested_count integer;
  computed_total numeric(12, 2);
  added_items jsonb := '[]'::jsonb;
  created_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Authentication required to place an order.';
  end if;

  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then
    raise exception 'Order must include at least one item.';
  end if;
  if requested_count > 50 then
    raise exception 'Order cannot include more than 50 line items.';
  end if;

  select *
  into target_restaurant
  from public.restaurants restaurants
  where restaurants.slug = target_restaurant_slug
    and restaurants.active = true
  limit 1;

  if target_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  with normalized_items as (
    select
      case when line_item ? 'menu_item_id'
        and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (line_item->>'menu_item_id')::uuid else null end as menu_item_id,
      case when line_item ? 'quantity' and (line_item->>'quantity') ~ '^[0-9]+$'
        then (line_item->>'quantity')::integer else null end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1
    from normalized_items
    where menu_item_id is null
       or quantity is null
       or quantity < 1
       or quantity > 99
  ),
  valid_items as (
    select normalized_items.menu_item_id, normalized_items.quantity, menu_items.price
    from normalized_items
    join public.menu_items
      on menu_items.id = normalized_items.menu_item_id
     and menu_items.restaurant_id = target_restaurant.id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_total
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_total is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  insert into public.orders (
    restaurant_id,
    customer_user_id,
    status,
    total_price,
    order_source
  )
  values (
    target_restaurant.id,
    auth.uid(),
    'pending_payment',
    computed_total,
    'authenticated'
  )
  returning * into target_order;

  insert into public.order_invoices (
    restaurant_id,
    order_id,
    invoice_number,
    status,
    total_price,
    payment_method
  )
  values (
    target_order.restaurant_id,
    target_order.id,
    1,
    'pending',
    computed_total,
    target_order.payment_method
  )
  returning * into target_invoice;

  perform public.stamp_invoice_ownership(
    target_invoice.id,
    'authenticated',
    null,
    'Customer'
  );

  update public.order_items items
  set invoice_id = target_invoice.id,
      kitchen_status = 'held'
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.invoice_id is null;

  insert into public.order_items (
    restaurant_id,
    order_id,
    invoice_id,
    menu_item_id,
    quantity,
    price,
    kitchen_status,
    created_at,
    updated_at
  )
  select
    target_order.restaurant_id,
    target_order.id,
    target_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    'held',
    created_at,
    created_at
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_order.restaurant_id
   and menu_items.available = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', normalized_items.quantity,
        'unit_price', menu_items.price,
        'line_total', (menu_items.price * normalized_items.quantity)::numeric(12, 2)
      )
      order by menu_items.name
    ),
    '[]'::jsonb
  )
  into added_items
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_order.restaurant_id;

  return jsonb_build_object(
    'order_id', target_order.id,
    'status', target_order.status,
    'total_price', target_order.total_price,
    'created_at', target_order.created_at,
    'invoice_id', target_invoice.id,
    'invoice_number', target_invoice.invoice_number,
    'invoice_status', target_invoice.status,
    'payment_status', target_invoice.payment_status,
    'invoice_total', target_invoice.grand_total,
    'order_source', target_order.order_source,
    'session_action', 'created',
    'items_added', added_items
  );
end;
$$;

revoke all on function public.create_customer_order(text, jsonb)
from public, anon;
grant execute on function public.create_customer_order(text, jsonb)
to authenticated;

comment on function public.create_customer_order(text, jsonb) is
  'Authenticated customer order creation with an atomic canonical invoice and item-to-invoice linkage.';

-- Replace close with an acknowledgment-aware contract. The existing close
-- implementation remains the Phase A/Manager-controls authority and is called
-- only after the restaurant-wide snapshot is acknowledged.
alter function public.close_cashier_shift(uuid, numeric, text)
rename to close_cashier_shift_phase258_base;

revoke all on function public.close_cashier_shift_phase258_base(uuid, numeric, text)
from public, anon, authenticated;
grant execute on function public.close_cashier_shift_phase258_base(uuid, numeric, text)
to service_role;

create or replace function public.close_cashier_shift(
  target_shift_id uuid,
  actual_cash_amount numeric,
  variance_explanation text default null,
  unresolved_obligations_acknowledged boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_shift public.cashier_shifts;
  obligation_summary jsonb;
  obligation_count integer;
  payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to close a shift.';
  end if;

  select *
  into target_shift
  from public.cashier_shifts shifts
  where shifts.id = target_shift_id
  for update;

  if target_shift.id is null then
    raise exception 'Shift not found.';
  end if;

  if target_shift.closed_at is not null then
    raise exception 'Shift is already closed.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff staff
  where staff.user_id = auth.uid()
    and staff.restaurant_id = target_shift.restaurant_id
    and staff.active
    and staff.role::text in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null or acting_staff.id <> target_shift.opened_by then
    raise exception 'Only the cashier who opened this shift may close it.';
  end if;

  obligation_summary := public.restaurant_unresolved_obligation_summary(
    target_shift.restaurant_id
  );
  obligation_count := coalesce(
    (obligation_summary->>'unresolved_obligation_count')::integer,
    0
  );

  if obligation_count > 0
    and not coalesce(unresolved_obligations_acknowledged, false)
  then
    raise exception 'Restaurant has % unresolved obligation(s). Explicit acknowledgment is required before shift close.', obligation_count
      using detail = obligation_summary::text,
            hint = 'Review the restaurant obligation summary and retry with unresolved_obligations_acknowledged=true.';
  end if;

  if obligation_count > 0 then
    insert into public.shift_activity_logs (
      restaurant_id,
      shift_id,
      actor_staff_id,
      action,
      message,
      amount,
      metadata
    ) values (
      target_shift.restaurant_id,
      target_shift.id,
      acting_staff.id,
      'restaurant_obligations_acknowledged',
      'Restaurant-wide unresolved obligations acknowledged at shift close',
      (obligation_summary->>'unresolved_total')::numeric,
      obligation_summary || jsonb_build_object(
        'acknowledged_at', clock_timestamp(),
        'acknowledged_by_staff_id', acting_staff.id,
        'shift_id', target_shift.id,
        'restaurant_id', target_shift.restaurant_id
      )
    );
  end if;

  payload := public.close_cashier_shift_phase258_base(
    target_shift.id,
    actual_cash_amount,
    variance_explanation
  );

  return payload || jsonb_build_object(
    'restaurant_unresolved_obligations', obligation_summary,
    'unresolved_obligations_acknowledged', obligation_count = 0
      or coalesce(unresolved_obligations_acknowledged, false)
  );
end;
$$;

revoke all on function public.close_cashier_shift(
  uuid, numeric, text, boolean
) from public, anon;
grant execute on function public.close_cashier_shift(
  uuid, numeric, text, boolean
) to authenticated;

comment on function public.close_cashier_shift(uuid, numeric, text, boolean) is
  'Phase A close authority plus a durable restaurant-wide unresolved-obligation acknowledgment snapshot. Acknowledgment never settles, assigns, closes, or releases obligations.';
