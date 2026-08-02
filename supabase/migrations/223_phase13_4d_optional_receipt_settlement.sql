-- Phase 13.4D: receipt printing is customer-optional and must not block settlement.
-- Payment verification, kitchen completion, cashier authority, tenant scoping,
-- invoice closure, table release, and settlement audit behavior remain unchanged.

create or replace function public.close_dining_session(
  target_order_id uuid,
  close_reason text default 'customer_left'
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.orders;
  actor public.restaurant_staff;
  closed public.orders;
begin
  select *
  into target
  from public.orders
  where id = target_order_id
  for update;

  if target.id is null then
    raise exception 'Dining session not found.';
  end if;

  select *
  into actor
  from public.restaurant_staff
  where restaurant_id = target.restaurant_id
    and user_id = auth.uid()
    and active
    and role = 'cashier'
  limit 1;

  if actor.id is null then
    raise exception 'Only an active cashier may close an invoice and release its table.';
  end if;

  if target.dining_session_status <> 'open' then
    return target;
  end if;

  -- The Phase 12.2A base remains authoritative for verified/cancelled/refunded
  -- invoice states and completed kitchen items. A receipt event is intentionally
  -- not required: the customer may decline a printed receipt.
  closed := public.close_dining_session_phase122a_base(
    target.id,
    close_reason
  );

  update public.order_invoices
  set operational_status = 'closed',
      updated_at = now()
  where restaurant_id = target.restaurant_id
    and order_id = target.id
    and payment_status in ('paid', 'cancelled', 'refunded');

  insert into public.shift_activity_logs(
    restaurant_id,
    shift_id,
    order_id,
    actor_staff_id,
    action,
    message,
    amount,
    metadata
  )
  values (
    target.restaurant_id,
    (
      select id
      from public.cashier_shifts
      where restaurant_id = target.restaurant_id
        and opened_by = actor.id
        and closed_at is null
      order by opened_at desc
      limit 1
    ),
    target.id,
    actor.id,
    'invoice_settled',
    'Invoice closed and table released',
    target.total_price,
    jsonb_build_object(
      'table_id', target.table_id,
      'table_number', target.table_number,
      'confirmation', true,
      'reason', left(trim(coalesce(close_reason, 'customer_left')), 80),
      'receipt_optional', true
    )
  );

  return closed;
end;
$$;

revoke all on function public.close_dining_session(uuid, text)
from public, anon;
grant execute on function public.close_dining_session(uuid, text)
to authenticated;

comment on function public.close_dining_session(uuid, text) is
  'Cashier-only settlement with authoritative payment and kitchen gates; receipt printing is optional.';

-- Keep invoice_settlement_queue aligned with the authoritative close rule.
-- receipt_pending_queue remains available only when a receipt job already exists.
do $$
declare
  definition text;
  receipt_required_filter text := 'where payment_status=''paid'' and receipt_job_status in(''printed'',''reprinted'',''processed'') and invoice_lifecycle<>''closed''';
  receipt_optional_filter text := 'where payment_status=''paid'' and invoice_lifecycle<>''closed''';
begin
  select pg_get_functiondef(
    'public.get_cashier_workflow_foundation(uuid)'::regprocedure
  )
  into definition;

  if position(receipt_required_filter in definition) > 0 then
    definition := replace(
      definition,
      receipt_required_filter,
      receipt_optional_filter
    );
    execute definition;
  elsif position(receipt_optional_filter in definition) = 0 then
    raise exception 'Cashier settlement projection could not be updated safely.';
  end if;
end;
$$;
