-- ServeFlow Phase 8.4.1: inventory deduction decision engine.
-- This phase decides whether deduction is permitted. It does not deduct stock,
-- create stock movements, update quantities, emit realtime events, or report.

create or replace function public.resolve_inventory_deduction_decision(
  decision_input jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  restaurant_id text := nullif(btrim(decision_input->>'restaurant_id'), '');
  workflow_policy_snapshot text := coalesce(
    nullif(btrim(decision_input->>'workflow_policy_snapshot'), ''),
    nullif(btrim(decision_input->>'waiter_policy'), ''),
    'pay_before_kitchen'
  );
  raw_order_source text := coalesce(nullif(btrim(decision_input->>'order_source'), ''), 'unknown');
  order_source text := case raw_order_source
    when 'public_qr' then 'customer_qr'
    when 'cashier' then 'cashier_pos'
    else raw_order_source
  end;
  dining_session_state text := coalesce(nullif(btrim(decision_input->>'dining_session_state'), ''), 'open');
  raw_payment_status text := coalesce(nullif(btrim(decision_input->>'payment_status'), ''), 'unpaid');
  payment_status text := case raw_payment_status
    when 'paid' then 'paid'
    when 'cancelled' then 'cancelled'
    when 'refunded' then 'refunded'
    else 'unpaid'
  end;
  kitchen_status text := coalesce(nullif(btrim(decision_input->>'kitchen_status'), ''), 'not_started');
  workflow_kitchen_status text := case kitchen_status
    when 'served' then 'completed'
    when 'delivered' then 'completed'
    when 'cancelled' then 'not_started'
    when 'rejected' then 'not_started'
    when 'voided' then 'not_started'
    else kitchen_status
  end;
  deduction_event text := coalesce(
    nullif(btrim(decision_input->>'event'), ''),
    nullif(btrim(decision_input->>'kitchen_event'), ''),
    ''
  );
  workflow_decision jsonb;
begin
  if restaurant_id is null then
    raise exception 'restaurant_id is required for tenant-safe inventory deduction decisions.';
  end if;

  workflow_decision := public.resolve_order_workflow(jsonb_build_object(
    'restaurant_id', restaurant_id,
    'waiter_policy', workflow_policy_snapshot,
    'order_source', order_source,
    'dining_session_state', dining_session_state,
    'payment_status', payment_status,
    'kitchen_status', workflow_kitchen_status
  ));

  if deduction_event not in ('kitchen_served', 'kitchen_completed', 'kitchen_delivered') then
    return false;
  end if;
  if kitchen_status not in ('served', 'completed', 'delivered') then
    return false;
  end if;
  if raw_payment_status in ('cancelled', 'refunded') then
    return false;
  end if;

  return coalesce((workflow_decision->>'release_to_kitchen')::boolean, false)
    and workflow_decision->>'next_state' in ('completed', 'payment_due');
end;
$$;

create or replace function public.should_deduct_inventory_for_service_completion(
  target_order_id uuid,
  target_invoice_id uuid default null,
  target_batch_key text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  invoice_source text;
  payment_status text;
  batch_kitchen_status text;
begin
  select orders.* into target_order
  from public.orders orders
  where orders.id = target_order_id;

  if target_order.id is null then
    raise exception 'Dining session not found.';
  end if;
  if not public.has_staff_role(target_order.restaurant_id,
    array['owner','manager','kitchen']::public.restaurant_staff_role[]) then
    raise exception 'Inventory deduction decision is outside the active restaurant.';
  end if;

  select
    case
      when bool_and(invoices.payment_status = 'paid') then 'paid'
      when bool_or(invoices.payment_status = 'held') then 'held'
      when bool_or(invoices.payment_status = 'cancelled') then 'cancelled'
      when bool_or(invoices.payment_status = 'refunded') then 'refunded'
      else 'unpaid'
    end,
    coalesce(
      max(invoices.invoice_source) filter (where invoices.invoice_source = 'waiter'),
      max(invoices.invoice_source),
      target_order.order_source,
      'unknown'
    )
  into payment_status, invoice_source
  from public.order_invoices invoices
  where invoices.order_id = target_order.id
    and invoices.restaurant_id = target_order.restaurant_id
    and (target_invoice_id is null or invoices.id = target_invoice_id);

  select case
    when count(*) = 0 then 'not_started'
    when bool_and(items.kitchen_status in ('completed','served')) then 'completed'
    when bool_or(items.kitchen_status = 'ready') then 'ready'
    when bool_or(items.kitchen_status = 'preparing') then 'preparing'
    when bool_and(items.kitchen_status = 'accepted') then 'accepted'
    else 'not_started'
  end into batch_kitchen_status
  from public.order_items items
  where items.order_id = target_order.id
    and items.restaurant_id = target_order.restaurant_id
    and (target_invoice_id is null or items.invoice_id = target_invoice_id)
    and (
      target_batch_key is null
      or coalesce(
        case when items.appended_at is null then 'initial'
          else ((extract(epoch from items.appended_at) * 1000000)::bigint)::text end,
        'initial'
      ) = coalesce(nullif(btrim(target_batch_key), ''), 'initial')
    );

  return public.resolve_inventory_deduction_decision(jsonb_build_object(
    'restaurant_id', target_order.restaurant_id,
    'workflow_policy_snapshot', target_order.workflow_policy_snapshot,
    'order_source', case invoice_source
      when 'public_qr' then 'customer_qr'
      when 'cashier' then 'cashier_pos'
      else coalesce(invoice_source, target_order.order_source, 'unknown')
    end,
    'dining_session_state', case when target_order.dining_session_status = 'open' then 'open' else 'closed' end,
    'payment_status', coalesce(payment_status, 'unpaid'),
    'kitchen_status', coalesce(batch_kitchen_status, 'not_started'),
    'event', 'kitchen_completed'
  ));
end;
$$;

revoke all on function public.resolve_inventory_deduction_decision(jsonb)
  from public, anon;
revoke all on function public.should_deduct_inventory_for_service_completion(uuid, uuid, text)
  from public, anon;
grant execute on function public.resolve_inventory_deduction_decision(jsonb),
  public.should_deduct_inventory_for_service_completion(uuid, uuid, text)
  to authenticated, service_role;

comment on function public.resolve_inventory_deduction_decision(jsonb) is
  'Phase 8.4.1 pure boolean decision: should inventory be deducted for this event? Performs no stock writes.';
comment on function public.should_deduct_inventory_for_service_completion(uuid, uuid, text) is
  'Phase 8.4.1 service-completion adapter. Uses orders.workflow_policy_snapshot and returns only a boolean.';
