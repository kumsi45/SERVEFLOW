-- ServeFlow Cancellation Phase 2: cashier review, low-risk direct cancellation,
-- and manager escalation. Phase 3 manager decisions are intentionally absent.

alter type public.staff_activity_action add value if not exists 'cancellation_cancelled_by_cashier';
alter type public.staff_activity_action add value if not exists 'cancellation_escalated_by_cashier';

alter table public.order_cancellation_requests
  add column if not exists handled_by_staff_id uuid,
  add column if not exists handled_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists cashier_decision text,
  add column if not exists decision_order_status text,
  add column if not exists decision_kitchen_status text,
  add column if not exists decision_payment_status text,
  add column if not exists affected_amount numeric(12,2),
  add column if not exists updated_at timestamptz not null default now();

alter table public.order_cancellation_requests
  drop constraint if exists order_cancellation_requests_status_check,
  add constraint order_cancellation_requests_status_check
    check (status in ('pending_review', 'manager_review_required', 'resolved')),
  drop constraint if exists order_cancellation_requests_cashier_decision_check,
  add constraint order_cancellation_requests_cashier_decision_check
    check (cashier_decision is null or cashier_decision in ('cancelled_directly', 'sent_to_manager')),
  drop constraint if exists order_cancellation_requests_handling_complete_check,
  add constraint order_cancellation_requests_handling_complete_check check (
    (status = 'pending_review' and handled_by_staff_id is null and handled_at is null
      and cashier_decision is null and escalated_at is null and resolved_at is null)
    or
    (status = 'manager_review_required' and handled_by_staff_id is not null and handled_at is not null
      and cashier_decision = 'sent_to_manager' and escalated_at is not null and resolved_at is null)
    or
    (status = 'resolved' and handled_by_staff_id is not null and handled_at is not null
      and cashier_decision = 'cancelled_directly' and resolved_at is not null and escalated_at is null)
  ),
  drop constraint if exists order_cancellation_requests_amount_nonnegative_check,
  add constraint order_cancellation_requests_amount_nonnegative_check
    check (affected_amount is null or affected_amount >= 0),
  add constraint order_cancellation_requests_restaurant_id_id_unique unique (restaurant_id, id),
  add constraint order_cancellation_requests_handler_same_restaurant
    foreign key (restaurant_id, handled_by_staff_id)
    references public.restaurant_staff(restaurant_id, id)
    on delete restrict;

drop index if exists public.order_cancellation_requests_pending_item_key;
drop index if exists public.order_cancellation_requests_pending_order_key;
create unique index order_cancellation_requests_open_item_key
  on public.order_cancellation_requests(restaurant_id, order_item_id)
  where status in ('pending_review', 'manager_review_required') and order_item_id is not null;
create unique index order_cancellation_requests_open_order_key
  on public.order_cancellation_requests(restaurant_id, order_id)
  where status in ('pending_review', 'manager_review_required') and order_item_id is null;
create index if not exists order_cancellation_requests_cashier_queue_idx
  on public.order_cancellation_requests(restaurant_id, status, requested_at, id);

create or replace function public.preserve_cancellation_request_origin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id
    or new.order_id is distinct from old.order_id
    or new.order_item_id is distinct from old.order_item_id
    or new.request_scope is distinct from old.request_scope
    or new.requested_by_staff_id is distinct from old.requested_by_staff_id
    or new.requested_by_user_id is distinct from old.requested_by_user_id
    or new.requester_role is distinct from old.requester_role
    or new.reason is distinct from old.reason
    or new.note is distinct from old.note
    or new.requested_at is distinct from old.requested_at
    or new.metadata is distinct from old.metadata
  then
    raise exception 'Cancellation request origin is immutable.';
  end if;
  if old.handled_by_staff_id is not null
    and new.handled_by_staff_id is distinct from old.handled_by_staff_id
  then
    raise exception 'Cancellation handler identity is immutable.';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists preserve_cancellation_request_origin_trigger
  on public.order_cancellation_requests;
create trigger preserve_cancellation_request_origin_trigger
before update on public.order_cancellation_requests
for each row execute function public.preserve_cancellation_request_origin();

revoke all on function public.preserve_cancellation_request_origin()
from public, anon, authenticated;

alter table public.order_items
  add column if not exists cancellation_request_id uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_staff_id uuid;

alter table public.order_items
  drop constraint if exists order_items_kitchen_status_check,
  add constraint order_items_kitchen_status_check
    check (kitchen_status in ('held', 'accepted', 'preparing', 'ready', 'completed', 'cancelled')),
  drop constraint if exists order_items_cancellation_audit_complete,
  add constraint order_items_cancellation_audit_complete check (
    (kitchen_status <> 'cancelled' and cancellation_request_id is null
      and cancelled_at is null and cancelled_by_staff_id is null)
    or
    (kitchen_status = 'cancelled' and cancellation_request_id is not null
      and cancelled_at is not null and cancelled_by_staff_id is not null)
  ),
  add constraint order_items_cancellation_request_same_restaurant
    foreign key (restaurant_id, cancellation_request_id)
    references public.order_cancellation_requests(restaurant_id, id)
    on delete restrict,
  add constraint order_items_cancelled_by_same_restaurant
    foreign key (restaurant_id, cancelled_by_staff_id)
    references public.restaurant_staff(restaurant_id, id)
    on delete restrict;

create index if not exists order_items_cancellation_request_idx
  on public.order_items(restaurant_id, cancellation_request_id)
  where cancellation_request_id is not null;

-- A cancelled kitchen item is writable only as part of the authenticated,
-- still-pending cashier request that targets that exact item or its order.
create or replace function public.enforce_official_waiter_kitchen_release()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  decision jsonb;
begin
  if new.kitchen_status = 'cancelled' then
    if new.cancellation_request_id is null or new.cancelled_by_staff_id is null
      or not exists (
        select 1
        from public.order_cancellation_requests requests
        join public.restaurant_staff staff
          on staff.restaurant_id = requests.restaurant_id
         and staff.id = new.cancelled_by_staff_id
         and staff.user_id = auth.uid()
         and staff.active
         and staff.role::text = 'cashier'
        where requests.id = new.cancellation_request_id
          and requests.restaurant_id = new.restaurant_id
          and requests.order_id = new.order_id
          and requests.status = 'pending_review'
          and (requests.order_item_id = new.id or requests.request_scope = 'order')
      )
    then
      raise exception 'Only an authorized pending cashier cancellation may cancel this item.';
    end if;
    return new;
  end if;
  if new.kitchen_status = 'held' then return new; end if;
  select public.resolve_order_workflow(jsonb_build_object(
    'restaurant_id', orders.restaurant_id,
    'waiter_policy', orders.workflow_policy_snapshot,
    'order_source', case invoices.invoice_source
      when 'public_qr' then 'customer_qr'
      when 'cashier' then 'cashier_pos'
      else coalesce(invoices.invoice_source, orders.order_source, 'unknown') end,
    'dining_session_state', case when orders.dining_session_status = 'open' then 'open' else 'closed' end,
    'payment_status', case when invoices.payment_status = 'paid' then 'paid' else 'unpaid' end,
    'kitchen_status', 'not_started'
  )) into decision
  from public.order_invoices invoices
  join public.orders orders on orders.restaurant_id = invoices.restaurant_id
    and orders.id = invoices.order_id
  where invoices.id = new.invoice_id
    and invoices.order_id = new.order_id
    and invoices.restaurant_id = new.restaurant_id;
  if not coalesce((decision->>'release_to_kitchen')::boolean, false) then
    new.kitchen_status := 'held';
  end if;
  return new;
end;
$$;

create or replace function public.reconcile_canonical_operational_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order uuid := coalesce(new.order_id, old.order_id);
  next_status text;
begin
  select case
    when count(*) = 0 then 'new'
    when bool_and(kitchen_status = 'completed') then 'served'
    when bool_and(kitchen_status in ('ready', 'completed')) then 'ready'
    when bool_or(kitchen_status = 'preparing') then 'preparing'
    when bool_or(kitchen_status in ('accepted', 'paid', 'ready', 'completed')) then 'accepted'
    else 'new'
  end into next_status
  from public.order_items
  where order_id = target_order and kitchen_status <> 'cancelled';
  update public.orders
  set operational_status = next_status
  where id = target_order and operational_status <> 'closed';
  return coalesce(new, old);
end;
$$;

create or replace function public.derive_order_status_from_items(
  target_order_id uuid,
  acting_staff_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  next_operational_status text;
begin
  select * into target_order from public.orders where id = target_order_id for update;
  if target_order.id is null then raise exception 'Order not found.'; end if;
  if target_order.operational_status = 'closed' then return target_order; end if;
  select case
    when count(*) = 0 then 'new'
    when bool_and(items.kitchen_status = 'completed') then 'served'
    when bool_and(items.kitchen_status in ('ready', 'completed')) then 'ready'
    when bool_or(items.kitchen_status in ('preparing', 'ready', 'completed')) then 'preparing'
    when bool_or(items.kitchen_status = 'accepted') then 'accepted'
    else 'new'
  end into next_operational_status
  from public.order_items items
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_status <> 'cancelled';
  update public.orders
  set operational_status = next_operational_status,
      preparation_started_at = case when next_operational_status = 'preparing' then coalesce(preparation_started_at, now()) else preparation_started_at end,
      preparation_started_by = case when next_operational_status = 'preparing' then coalesce(preparation_started_by, acting_staff_id) else preparation_started_by end,
      ready_marked_at = case when next_operational_status = 'ready' then coalesce(ready_marked_at, now()) else ready_marked_at end,
      ready_marked_by = case when next_operational_status = 'ready' then coalesce(ready_marked_by, acting_staff_id) else ready_marked_by end,
      completed_at = case when next_operational_status = 'served' then coalesce(completed_at, now()) else completed_at end,
      completed_by = case when next_operational_status = 'served' then coalesce(completed_by, acting_staff_id) else completed_by end,
      updated_at = now()
  where id = target_order.id and restaurant_id = target_order.restaurant_id
  returning * into target_order;
  return target_order;
end;
$$;

create or replace function public.invoice_kitchen_status(target_invoice_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  with target_invoice as (
    select id, restaurant_id, status from public.order_invoices where id = target_invoice_id
  ), item_statuses as (
    select items.kitchen_status from public.order_items items
    join target_invoice invoice on invoice.restaurant_id = items.restaurant_id and invoice.id = items.invoice_id
    where items.kitchen_status <> 'cancelled'
  )
  select case
    when not exists (select 1 from target_invoice) then 'unknown'
    when (select status from target_invoice) = 'cancelled' then 'cancelled'
    when (select status from target_invoice) in ('pending', 'rejected') then 'waiting_payment'
    when not exists (select 1 from item_statuses) then 'cancelled'
    when bool_and(kitchen_status = 'held') then 'waiting_payment'
    when bool_and(kitchen_status = 'completed') then 'completed'
    when bool_and(kitchen_status in ('ready', 'completed')) then 'ready'
    when bool_or(kitchen_status = 'preparing') then 'preparing'
    when bool_or(kitchen_status in ('accepted', 'paid', 'ready', 'completed')) then 'waiting_kitchen'
    else 'waiting_kitchen'
  end
  from item_statuses right join target_invoice on true
  group by target_invoice.status
$$;

create or replace function public.refresh_invoice_financial_totals(target_invoice_id uuid)
returns public.order_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice public.order_invoices;
  base numeric(12,2);
  totals jsonb;
  effective_discount numeric(12,2);
begin
  select * into invoice from public.order_invoices where id = target_invoice_id for update;
  if invoice.id is null then return null; end if;
  if invoice.payment_status in ('paid', 'refunded', 'cancelled') then return invoice; end if;
  select coalesce(sum(price * quantity), 0)::numeric(12,2) into base
  from public.order_items
  where restaurant_id = invoice.restaurant_id and invoice_id = invoice.id
    and kitchen_status <> 'cancelled';
  totals := public.calculate_restaurant_financial_totals(invoice.restaurant_id, base, 0);
  effective_discount := least(coalesce(invoice.discount_amount, 0), (totals->>'grand_total')::numeric);
  totals := public.calculate_restaurant_financial_totals(invoice.restaurant_id, base, effective_discount);
  update public.order_invoices set
    subtotal = (totals->>'subtotal')::numeric,
    vat_rate = (totals->>'vat_rate')::numeric,
    vat_amount = (totals->>'vat_amount')::numeric,
    service_charge_rate = (totals->>'service_charge_rate')::numeric,
    service_charge_amount = (totals->>'service_charge_amount')::numeric,
    discount_amount = (totals->>'discount_amount')::numeric,
    grand_total = (totals->>'grand_total')::numeric,
    total_price = (totals->>'grand_total')::numeric,
    updated_at = now()
  where id = invoice.id returning * into invoice;
  update public.orders orders set
    total_price = (
      select coalesce(sum(invoices.grand_total), 0)
      from public.order_invoices invoices
      where invoices.restaurant_id = orders.restaurant_id
        and invoices.order_id = orders.id
        and invoices.payment_status <> 'cancelled'
    ),
    updated_at = now()
  where orders.id = invoice.order_id and orders.restaurant_id = invoice.restaurant_id;
  return invoice;
end;
$$;

-- Cancelled items are terminal for a later legitimate release, but this Phase 2
-- RPC never calls the release helper itself.
do $$
declare
  definition text;
  old_predicate text := 'not in (''completed'', ''served'', ''delivered'')';
  new_predicate text := 'not in (''completed'', ''served'', ''delivered'', ''cancelled'')';
begin
  select pg_get_functiondef('public.try_auto_release_settled_service_location(uuid,text)'::regprocedure)
  into definition;
  if position(new_predicate in definition) = 0 then
    if position(old_predicate in definition) = 0 then
      raise exception 'Service-location release item predicate was not found.';
    end if;
    definition := replace(definition, old_predicate, new_predicate);
    execute definition;
  end if;
end;
$$;

create or replace function public.evaluate_cancellation_request(target_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  request_row public.order_cancellation_requests;
  order_row public.orders;
  items jsonb := '[]'::jsonb;
  item_count integer := 0;
  affected numeric(12,2) := 0;
  kitchen_state text := 'not_started';
  payment_state text := 'pending';
  financial_document boolean := false;
  authority text;
  risk_reason text;
begin
  select * into request_row from public.order_cancellation_requests where id = target_request_id;
  if request_row.id is null then raise exception 'Cancellation request not found.'; end if;
  select * into order_row from public.orders
  where id = request_row.order_id and restaurant_id = request_row.restaurant_id;
  if order_row.id is null then raise exception 'Cancellation order not found.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', scoped.id, 'name', scoped.item_name, 'quantity', scoped.quantity,
      'price', scoped.price, 'kitchen_status', scoped.kitchen_status
    ) order by scoped.created_at, scoped.id), '[]'::jsonb),
    count(*)::integer,
    coalesce(sum(scoped.price * scoped.quantity), 0)::numeric(12,2),
    case
      when bool_or(scoped.kitchen_status = 'completed') then 'served'
      when bool_or(scoped.kitchen_status = 'ready') then 'ready'
      when bool_or(scoped.kitchen_status = 'preparing' or scoped.kitchen_preparation_started_at is not null) then 'preparing'
      when bool_or(scoped.kitchen_status = 'accepted') then 'accepted'
      else 'not_started'
    end
  into items, item_count, affected, kitchen_state
  from (
    select order_items.*, menu_items.name item_name
    from public.order_items
    join public.menu_items on menu_items.restaurant_id = order_items.restaurant_id
      and menu_items.id = order_items.menu_item_id
    where order_items.restaurant_id = request_row.restaurant_id
      and order_items.order_id = request_row.order_id
      and (request_row.request_scope = 'order' or order_items.id = request_row.order_item_id)
      and order_items.kitchen_status <> 'cancelled'
  ) scoped;

  select coalesce(case
      when bool_or(invoices.payment_status = 'paid' or invoices.status in ('paid', 'verified')
        or invoices.verified_at is not null or invoices.paid_at is not null) then 'paid'
      when bool_or(invoices.payment_status = 'refunded' or invoices.status = 'refunded') then 'refunded'
      when bool_or(invoices.payment_status = 'cancelled' or invoices.status = 'cancelled') then 'cancelled'
      when bool_or(invoices.payment_status = 'held') then 'held'
      else 'pending'
    end, 'pending'),
    coalesce(bool_or(
      invoices.locked_at is not null
      or exists (select 1 from public.receipt_generation_events receipts
        where receipts.restaurant_id = invoices.restaurant_id and receipts.invoice_id = invoices.id)
    ), false)
  into payment_state, financial_document
  from public.order_invoices invoices
  where invoices.restaurant_id = request_row.restaurant_id
    and invoices.order_id = request_row.order_id
    and (
      request_row.request_scope = 'order'
      or invoices.id = (select items.invoice_id from public.order_items items
        where items.restaurant_id = request_row.restaurant_id and items.id = request_row.order_item_id)
    );

  financial_document := financial_document
    or order_row.bill_printed_at is not null
    or exists (select 1 from public.dining_session_bills bills
      where bills.restaurant_id = request_row.restaurant_id
        and bills.dining_session_id = request_row.order_id and bills.status = 'printed');

  if request_row.status <> 'pending_review' then
    authority := 'not_actionable'; risk_reason := 'Request is no longer pending cashier review.';
  elsif item_count = 0 then
    authority := 'not_actionable'; risk_reason := 'Requested items are no longer active.';
  elsif payment_state in ('paid', 'refunded') or financial_document then
    authority := 'financial_approval_required'; risk_reason := 'Paid, verified, settled, billed, or receipted state requires financial approval.';
  elsif kitchen_state in ('preparing', 'ready', 'served') then
    authority := 'manager_approval_required'; risk_reason := 'Kitchen preparation has started.';
  elsif payment_state in ('pending', 'held') and kitchen_state in ('not_started', 'accepted') then
    authority := 'cashier_direct'; risk_reason := null;
  else
    authority := 'manager_approval_required'; risk_reason := 'Current state requires manager review.';
  end if;

  return jsonb_build_object(
    'request_id', request_row.id,
    'authority', authority,
    'risk_reason', risk_reason,
    'order_status', coalesce(nullif(order_row.operational_status, ''), order_row.status::text),
    'kitchen_status', kitchen_state,
    'payment_status', payment_state,
    'affected_amount', affected,
    'item_count', item_count,
    'items', items,
    'has_financial_document', financial_document
  );
end;
$$;

revoke all on function public.evaluate_cancellation_request(uuid)
from public, anon, authenticated;

create or replace function public.get_cashier_cancellation_requests(target_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor public.restaurant_staff;
  payload jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into actor from public.restaurant_staff
  where restaurant_id = target_restaurant_id and user_id = auth.uid()
    and active and role::text = 'cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may review cancellation requests.'; end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', requests.id,
      'restaurant_id', requests.restaurant_id,
      'order_id', requests.order_id,
      'order_item_id', requests.order_item_id,
      'request_scope', requests.request_scope,
      'reason', requests.reason,
      'note', requests.note,
      'status', requests.status,
      'requested_at', requests.requested_at,
      'requester_role', requests.requester_role,
      'requested_by_staff_id', requests.requested_by_staff_id,
      'requested_by_name', requester.display_name,
      'table_number', orders.table_number,
      'order_number', coalesce(orders.display_number, orders.id::text)
    ) || public.evaluate_cancellation_request(requests.id)
    order by requests.requested_at, requests.id
  ), '[]'::jsonb) into payload
  from public.order_cancellation_requests requests
  join public.orders orders on orders.restaurant_id = requests.restaurant_id and orders.id = requests.order_id
  join public.restaurant_staff requester on requester.restaurant_id = requests.restaurant_id
    and requester.id = requests.requested_by_staff_id
  where requests.restaurant_id = target_restaurant_id and requests.status = 'pending_review';
  return payload;
end;
$$;

create or replace function public.cashier_handle_cancellation_request(
  target_request_id uuid,
  requested_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_hint public.order_cancellation_requests;
  request_row public.order_cancellation_requests;
  order_row public.orders;
  actor public.restaurant_staff;
  decision jsonb;
  action text := lower(trim(coalesce(requested_action, '')));
  target_invoice_id uuid;
  changed_items integer := 0;
  decision_time timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if action not in ('direct_cancel', 'send_to_manager') then raise exception 'Unsupported cancellation action.'; end if;

  select * into request_hint from public.order_cancellation_requests where id = target_request_id;
  if request_hint.id is null then raise exception 'Cancellation request not found.'; end if;
  select * into order_row from public.orders
  where id = request_hint.order_id and restaurant_id = request_hint.restaurant_id for update;
  if order_row.id is null then raise exception 'Cancellation order not found.'; end if;
  perform pg_advisory_xact_lock(hashtext(order_row.restaurant_id::text || ':' || order_row.id::text || ':cashier_cancellation'));
  select * into request_row from public.order_cancellation_requests
  where id = target_request_id and restaurant_id = order_row.restaurant_id for update;
  if request_row.status <> 'pending_review' then raise exception 'Cancellation request was already handled.'; end if;

  select * into actor from public.restaurant_staff
  where restaurant_id = request_row.restaurant_id and user_id = auth.uid()
    and active and role::text = 'cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may handle cancellation requests.'; end if;

  perform 1 from public.order_items items
  where items.restaurant_id = request_row.restaurant_id and items.order_id = request_row.order_id
    and (request_row.request_scope = 'order' or items.id = request_row.order_item_id)
  for update;
  perform 1 from public.order_invoices invoices
  where invoices.restaurant_id = request_row.restaurant_id and invoices.order_id = request_row.order_id
    and (request_row.request_scope = 'order' or invoices.id = (
      select items.invoice_id from public.order_items items
      where items.restaurant_id = request_row.restaurant_id and items.id = request_row.order_item_id
    ))
  for update;

  decision := public.evaluate_cancellation_request(request_row.id);

  if action = 'send_to_manager' then
    if decision->>'authority' not in ('manager_approval_required', 'financial_approval_required') then
      raise exception 'This request does not require manager escalation.';
    end if;
    update public.order_cancellation_requests set
      status = 'manager_review_required', handled_by_staff_id = actor.id,
      handled_at = decision_time, escalated_at = decision_time,
      cashier_decision = 'sent_to_manager',
      decision_order_status = decision->>'order_status',
      decision_kitchen_status = decision->>'kitchen_status',
      decision_payment_status = decision->>'payment_status',
      affected_amount = (decision->>'affected_amount')::numeric
    where id = request_row.id;
    perform public.log_staff_activity(
      request_row.restaurant_id, actor.id, 'cancellation_escalated_by_cashier',
      request_row.requested_by_staff_id,
      jsonb_build_object(
        'request_id', request_row.id, 'order_id', request_row.order_id,
        'order_item_id', request_row.order_item_id, 'scope', request_row.request_scope,
        'requester_staff_id', request_row.requested_by_staff_id,
        'cashier_staff_id', actor.id, 'reason', request_row.reason,
        'previous_status', request_row.status, 'resulting_status', 'manager_review_required',
        'payment_status', decision->>'payment_status', 'kitchen_status', decision->>'kitchen_status',
        'affected_amount', decision->'affected_amount', 'authority', decision->>'authority'
      )
    );
    return decision || jsonb_build_object('status', 'manager_review_required', 'handled_by_staff_id', actor.id, 'handled_at', decision_time);
  end if;

  if decision->>'authority' <> 'cashier_direct' then
    raise exception 'Direct cancellation is no longer eligible. Manager approval is required.';
  end if;

  update public.order_items items set
    kitchen_status = 'cancelled', cancellation_request_id = request_row.id,
    cancelled_at = decision_time, cancelled_by_staff_id = actor.id
  where items.restaurant_id = request_row.restaurant_id and items.order_id = request_row.order_id
    and (request_row.request_scope = 'order' or items.id = request_row.order_item_id)
    and items.kitchen_status in ('held', 'accepted');
  get diagnostics changed_items = row_count;
  if changed_items <> (decision->>'item_count')::integer then
    raise exception 'Cancellation state changed before completion. Refresh and review again.';
  end if;

  for target_invoice_id in
    select distinct items.invoice_id from public.order_items items
    where items.restaurant_id = request_row.restaurant_id and items.order_id = request_row.order_id
      and items.cancellation_request_id = request_row.id and items.invoice_id is not null
  loop
    perform public.refresh_invoice_financial_totals(target_invoice_id);
    if not exists (select 1 from public.order_items remaining
      where remaining.restaurant_id = request_row.restaurant_id
        and remaining.invoice_id = target_invoice_id and remaining.kitchen_status <> 'cancelled')
    then
      update public.order_invoices invoices set status = 'cancelled', updated_at = decision_time
      where invoices.restaurant_id = request_row.restaurant_id and invoices.id = target_invoice_id
        and invoices.payment_status in ('pending', 'held');
    end if;
  end loop;

  update public.order_cancellation_requests set
    status = 'resolved', handled_by_staff_id = actor.id, handled_at = decision_time,
    resolved_at = decision_time, cashier_decision = 'cancelled_directly',
    decision_order_status = decision->>'order_status',
    decision_kitchen_status = decision->>'kitchen_status',
    decision_payment_status = decision->>'payment_status',
    affected_amount = (decision->>'affected_amount')::numeric
  where id = request_row.id;

  perform public.log_staff_activity(
    request_row.restaurant_id, actor.id, 'cancellation_cancelled_by_cashier',
    request_row.requested_by_staff_id,
    jsonb_build_object(
      'request_id', request_row.id, 'order_id', request_row.order_id,
      'order_item_id', request_row.order_item_id, 'scope', request_row.request_scope,
      'requester_staff_id', request_row.requested_by_staff_id,
      'cashier_staff_id', actor.id, 'reason', request_row.reason,
      'previous_status', request_row.status, 'resulting_status', 'resolved',
      'payment_status', decision->>'payment_status', 'kitchen_status', decision->>'kitchen_status',
      'affected_amount', decision->'affected_amount', 'cancelled_item_count', changed_items,
      'refund_created', false, 'table_released', false
    )
  );

  return decision || jsonb_build_object(
    'status', 'resolved', 'cashier_decision', 'cancelled_directly',
    'handled_by_staff_id', actor.id, 'handled_at', decision_time,
    'cancelled_item_count', changed_items, 'refund_created', false,
    'table_released', false
  );
end;
$$;

revoke all on function public.get_cashier_cancellation_requests(uuid),
  public.cashier_handle_cancellation_request(uuid, text)
from public, anon;
grant execute on function public.get_cashier_cancellation_requests(uuid),
  public.cashier_handle_cancellation_request(uuid, text)
to authenticated;

comment on function public.get_cashier_cancellation_requests(uuid) is
  'Returns the authenticated cashier tenant pending queue with server-evaluated cancellation authority.';
comment on function public.cashier_handle_cancellation_request(uuid, text) is
  'Atomically revalidates and either directly cancels an unpaid not-started request or persists manager escalation. Never refunds or releases a table.';
