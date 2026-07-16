-- Release Table must close the canonical operational lifecycle and stamp the
-- staff completion audit atomically. Payment state remains invoice-owned.

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
  target_order public.orders;
  acting_staff public.restaurant_staff;
  updated_order public.orders;
  completed_timestamp timestamptz := now();
begin
  if target_order_id is null then
    raise exception 'Dining session is required.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Dining session not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff staff
  where staff.restaurant_id = target_order.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text in ('cashier', 'owner', 'manager')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashier or management staff may release a table.';
  end if;

  if target_order.dining_session_status <> 'open' then
    return target_order;
  end if;

  -- Canonical payment status is owned exclusively by order_invoices.
  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.payment_status in ('pending', 'held')
  ) then
    raise exception 'Dining session cannot close while payment is pending or due.';
  end if;

  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.payment_status not in ('paid', 'cancelled', 'refunded')
  ) then
    raise exception 'Dining session cannot close until every invoice is paid, cancelled, or refunded.';
  end if;

  if exists (
    select 1
    from public.order_items items
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and items.kitchen_status <> 'completed'
  ) then
    raise exception 'Dining session cannot close until kitchen has completed all items.';
  end if;

  -- completed_at and completed_by intentionally belong to this same UPDATE so
  -- orders_completed_audit_complete is true at every constraint check.
  update public.orders
  set
    dining_session_status = 'closed',
    dining_session_closed_at = completed_timestamp,
    dining_session_close_reason = coalesce(
      nullif(left(trim(close_reason), 80), ''),
      'customer_left'
    ),
    table_released_at = completed_timestamp,
    status = 'completed'::public.order_status,
    operational_status = 'closed',
    completed_at = completed_timestamp,
    completed_by = acting_staff.id,
    updated_at = completed_timestamp
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

  return updated_order;
end;
$$;

revoke all on function public.close_dining_session(uuid, text) from public, anon;
grant execute on function public.close_dining_session(uuid, text)
to authenticated, service_role;
