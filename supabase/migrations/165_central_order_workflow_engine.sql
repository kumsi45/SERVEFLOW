-- Architecture freeze: the sole database authority for order destinations.
-- Callers provide canonical dining-session facts and obey this decision.

create or replace function public.resolve_order_workflow(workflow_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  restaurant_id text := nullif(btrim(workflow_input->>'restaurant_id'), '');
  waiter_policy text := coalesce(workflow_input->>'waiter_policy', 'pay_before_kitchen');
  order_source text := coalesce(workflow_input->>'order_source', 'unknown');
  session_state text := coalesce(workflow_input->>'dining_session_state', 'open');
  payment_status text := coalesce(workflow_input->>'payment_status', 'unpaid');
  kitchen_status text := coalesce(workflow_input->>'kitchen_status', 'not_started');
  paid boolean;
  deferred_waiter boolean;
  released boolean;
begin
  if restaurant_id is null then
    raise exception 'restaurant_id is required for tenant-safe workflow resolution.';
  end if;
  if waiter_policy not in ('pay_before_kitchen', 'kitchen_before_payment') then
    raise exception 'Unsupported waiter workflow policy: %', waiter_policy;
  end if;
  if session_state = 'closed' then
    return jsonb_build_object('next_state', 'closed', 'release_to_kitchen', false,
      'payment_required', false, 'close_dining_session', false,
      'reason', 'Dining session is already closed.');
  end if;

  paid := payment_status = 'paid';
  deferred_waiter := order_source = 'waiter'
    and waiter_policy = 'kitchen_before_payment';
  released := paid or deferred_waiter;

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
      'reason', 'Deferred waiter session completed kitchen service before payment.');
  elsif kitchen_status = 'completed' then
    return jsonb_build_object('next_state', 'completed', 'release_to_kitchen', true,
      'payment_required', false, 'close_dining_session', true,
      'reason', 'Kitchen service and payment are complete.');
  end if;

  return jsonb_build_object('next_state', 'kitchen_queue', 'release_to_kitchen', true,
    'payment_required', not paid, 'close_dining_session', false,
    'reason', case when deferred_waiter
      then 'Restaurant policy releases waiter orders before payment.'
      else 'Verified payment releases the order to kitchen.' end);
end;
$$;

revoke all on function public.resolve_order_workflow(jsonb) from public, anon;
grant execute on function public.resolve_order_workflow(jsonb) to authenticated, service_role;
comment on function public.resolve_order_workflow(jsonb) is
  'ServeFlow central order workflow engine. No RPC, trigger, service, or UI may independently choose an order destination.';

-- Compatibility adapter. Existing order-creation RPCs now ask the engine.
create or replace function public.resolve_order_payment_timing(
  target_restaurant_id uuid,
  target_order_source text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when resolved.decision->>'release_to_kitchen' = 'true' then 'after_meal'
    else 'before_kitchen'
  end
  from public.restaurants restaurants
  cross join lateral (select public.resolve_order_workflow(jsonb_build_object(
    'restaurant_id', restaurants.id,
    'waiter_policy', restaurants.payment_policy,
    'order_source', case target_order_source
      when 'public_qr' then 'customer_qr'
      when 'cashier' then 'cashier_pos'
      else coalesce(target_order_source, 'unknown') end,
    'dining_session_state', 'open',
    'payment_status', 'unpaid',
    'kitchen_status', 'not_started'
  )) as decision) resolved
  where restaurants.id = target_restaurant_id
$$;

-- Defense-in-depth gate delegates; it does not contain workflow policy.
create or replace function public.enforce_official_waiter_kitchen_release()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  decision jsonb;
begin
  if new.kitchen_status = 'held' then return new; end if;

  select public.resolve_order_workflow(jsonb_build_object(
    'restaurant_id', invoices.restaurant_id,
    'waiter_policy', restaurants.payment_policy,
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
  join public.restaurants restaurants on restaurants.id = invoices.restaurant_id
  where invoices.id = new.invoice_id
    and invoices.order_id = new.order_id
    and invoices.restaurant_id = new.restaurant_id;

  if not coalesce((decision->>'release_to_kitchen')::boolean, false) then
    new.kitchen_status := 'held';
  end if;
  return new;
end;
$$;

-- Read model for dashboards, realtime consumers, reports, and future adapters.
create or replace function public.get_dining_session_workflow(
  target_dining_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_session public.orders;
  policy text;
  source text;
  payment text;
  kitchen text;
begin
  select * into target_session from public.orders
  where id = target_dining_session_id;
  if target_session.id is null then raise exception 'Dining session not found.'; end if;
  if not public.has_staff_role(target_session.restaurant_id,
    array['owner','manager','waiter','cashier','kitchen']::public.restaurant_staff_role[]) then
    raise exception 'Dining session is outside the active restaurant.';
  end if;

  select restaurants.payment_policy into policy from public.restaurants
  where id = target_session.restaurant_id;
  select case when bool_and(invoices.payment_status = 'paid') then 'paid' else 'unpaid' end,
    coalesce(max(invoices.invoice_source) filter (where invoices.invoice_source = 'waiter'),
      max(invoices.invoice_source), target_session.order_source)
  into payment, source
  from public.order_invoices invoices where invoices.order_id = target_session.id;
  select case
    when bool_and(items.kitchen_status in ('completed','served')) then 'completed'
    when bool_and(items.kitchen_status in ('ready','completed','served')) then 'ready'
    when bool_or(items.kitchen_status = 'preparing') then 'preparing'
    when bool_or(items.kitchen_status = 'accepted') then 'accepted'
    else 'not_started' end
  into kitchen from public.order_items items where items.order_id = target_session.id;

  return public.resolve_order_workflow(jsonb_build_object(
    'restaurant_id', target_session.restaurant_id, 'waiter_policy', policy,
    'order_source', case source when 'public_qr' then 'customer_qr'
      when 'cashier' then 'cashier_pos' else coalesce(source, 'unknown') end,
    'dining_session_state', case when target_session.dining_session_status = 'open' then 'open' else 'closed' end,
    'payment_status', coalesce(payment, 'unpaid'), 'kitchen_status', coalesce(kitchen, 'not_started')
  ));
end;
$$;

revoke all on function public.get_dining_session_workflow(uuid) from public, anon;
grant execute on function public.get_dining_session_workflow(uuid) to authenticated, service_role;
