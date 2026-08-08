-- Release a service location as soon as its last payment and last served item
-- are both terminal. This covers both event orderings: served then paid, and
-- paid then served. Receipt printing remains optional and never owns release.

create or replace function public.try_auto_release_settled_service_location(
  target_order_id uuid,
  release_reason text default 'settled_service_location_auto_release'
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.orders;
  actor public.restaurant_staff;
  released public.orders;
  released_at timestamptz := clock_timestamp();
begin
  select * into target
  from public.orders orders
  where orders.id = target_order_id
  for update;

  if target.id is null then
    raise exception 'Order not found.';
  end if;

  perform pg_advisory_xact_lock(hashtext(
    target.restaurant_id::text || ':' || coalesce(target.table_id::text, trim(target.table_number), target.id::text)
  ));

  select * into actor
  from public.restaurant_staff staff
  where staff.restaurant_id = target.restaurant_id
    and staff.active
    and (staff.user_id = auth.uid() or staff.id = target.completed_by)
  order by case when staff.user_id = auth.uid() then 0 else 1 end
  limit 1;

  if actor.id is null then
    return target;
  end if;

  if target.table_released_at is not null
    or target.dining_session_status in ('closed', 'checked_out', 'abandoned', 'expired')
  then
    return target;
  end if;

  if not exists (
    select 1 from public.order_invoices invoices
    where invoices.restaurant_id = target.restaurant_id
      and invoices.order_id = target.id
  ) or exists (
    select 1 from public.order_invoices invoices
    where invoices.restaurant_id = target.restaurant_id
      and invoices.order_id = target.id
      and invoices.payment_status not in ('paid', 'cancelled', 'refunded')
  ) then
    return target;
  end if;

  if exists (
    select 1 from public.order_items items
    where items.restaurant_id = target.restaurant_id
      and items.order_id = target.id
      and coalesce(items.kitchen_status, 'pending') not in ('completed', 'served', 'delivered')
  ) then
    return target;
  end if;

  if exists (
    select 1 from public.orders other_orders
    where other_orders.restaurant_id = target.restaurant_id
      and other_orders.id <> target.id
      and other_orders.table_released_at is null
      and coalesce(other_orders.dining_session_status, 'open') = 'open'
      and other_orders.status not in ('completed', 'cancelled')
      and (
        (target.table_id is not null and other_orders.table_id = target.table_id)
        or (
          nullif(trim(target.table_number), '') is not null
          and trim(other_orders.table_number) = trim(target.table_number)
        )
      )
  ) then
    return target;
  end if;

  update public.orders orders
  set dining_session_status = 'closed',
      dining_session_closed_at = coalesce(orders.dining_session_closed_at, released_at),
      dining_session_close_reason = coalesce(nullif(left(trim(release_reason), 80), ''), 'settled_service_location_auto_release'),
      table_released_at = released_at,
      status = 'completed'::public.order_status,
      operational_status = 'closed',
      completed_at = coalesce(orders.completed_at, released_at),
      completed_by = coalesce(orders.completed_by, actor.id),
      updated_at = released_at
  where orders.id = target.id
    and orders.restaurant_id = target.restaurant_id
    and orders.table_released_at is null
  returning * into released;

  if released.id is null then
    return target;
  end if;

  update public.order_invoices invoices
  set operational_status = 'closed',
      updated_at = released_at
  where invoices.restaurant_id = released.restaurant_id
    and invoices.order_id = released.id
    and invoices.payment_status in ('paid', 'cancelled', 'refunded');

  insert into public.shift_activity_logs(
    restaurant_id, shift_id, order_id, actor_staff_id,
    action, message, amount, metadata
  )
  values (
    released.restaurant_id,
    (
      select shifts.id from public.cashier_shifts shifts
      where shifts.restaurant_id = released.restaurant_id
        and shifts.opened_by = actor.id
        and shifts.closed_at is null
      order by shifts.opened_at desc limit 1
    ),
    released.id,
    actor.id,
    'invoice_settled',
    'Fully served and paid order automatically released its service location',
    released.total_price,
    jsonb_build_object(
      'automatic', true,
      'reason', release_reason,
      'table_id', released.table_id,
      'table_number', released.table_number,
      'receipt_optional', true
    )
  );

  return released;
end;
$$;

revoke all on function public.try_auto_release_settled_service_location(uuid, text)
from public, anon, authenticated;
grant execute on function public.try_auto_release_settled_service_location(uuid, text)
to service_role;

create or replace function public.cashier_close_invoice_and_release_table(
  target_order_id uuid,
  confirmed boolean
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  released public.orders;
begin
  if not coalesce(confirmed, false) then
    raise exception 'Cashier confirmation is required.';
  end if;

  if not exists (
    select 1
    from public.orders orders
    join public.restaurant_staff staff
      on staff.restaurant_id = orders.restaurant_id
     and staff.user_id = auth.uid()
     and staff.active
     and staff.role = 'cashier'
    where orders.id = target_order_id
  ) then
    raise exception 'Only an active cashier may release a table.';
  end if;

  released := public.try_auto_release_settled_service_location(
    target_order_id,
    'cashier_invoice_settlement'
  );

  if released.table_released_at is null then
    raise exception 'The table cannot be released while payment, active items, or another open order remains.';
  end if;

  return released;
end;
$$;

revoke all on function public.cashier_close_invoice_and_release_table(uuid, boolean)
from public, anon;
grant execute on function public.cashier_close_invoice_and_release_table(uuid, boolean)
to authenticated;

create or replace function public.auto_release_service_location_after_item_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kitchen_status in ('completed', 'served', 'delivered')
    and coalesce(old.kitchen_status, '') not in ('completed', 'served', 'delivered')
  then
    perform public.try_auto_release_settled_service_location(
      new.order_id,
      'items_terminal_after_payment_auto_release'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.auto_release_service_location_after_item_terminal()
from public, anon, authenticated;

drop trigger if exists auto_release_service_location_after_item_terminal_trigger
on public.order_items;
create trigger auto_release_service_location_after_item_terminal_trigger
after update of kitchen_status on public.order_items
for each row
execute function public.auto_release_service_location_after_item_terminal();

-- Route the cashier payment path through the same transaction-safe helper and
-- treat legacy null dining-session status as an open table-linked order.
do $$
declare
  definition text;
  old_call text := $replace$released := public.close_dining_session(
      target_session.id,
      'cashier_payment_verified_auto_release'
    );$replace$;
  new_call text := $replace$released := public.try_auto_release_settled_service_location(
      target_session.id,
      'cashier_payment_verified_auto_release'
    );$replace$;
begin
  select pg_get_functiondef(
    'public.verify_dining_session_payment(uuid,text,text,text,text,boolean)'::regprocedure
  ) into definition;

  definition := replace(
    definition,
    'and items.kitchen_status <> ''completed'';',
    'and coalesce(items.kitchen_status, ''pending'') not in (''completed'', ''served'', ''delivered'');'
  );
  definition := replace(
    definition,
    'and orders.dining_session_status = ''open''',
    'and coalesce(orders.dining_session_status, ''open'') = ''open'''
  );
  definition := replace(
    definition,
    'and target_session.dining_session_status = ''open''',
    'and coalesce(target_session.dining_session_status, ''open'') = ''open'''
  );
  definition := replace(definition, old_call, new_call);

  if position('try_auto_release_settled_service_location' in definition) = 0 then
    raise exception 'Cashier payment auto-release path could not be upgraded safely.';
  end if;

  execute definition;
end;
$$;

-- Repair already-settled rows such as payment-first orders whose final item
-- reached served/completed after verification.
do $$
declare
  candidate record;
begin
  for candidate in
    select orders.id
    from public.orders orders
    where orders.table_released_at is null
      and coalesce(orders.dining_session_status, 'open') = 'open'
      and exists (
        select 1 from public.order_invoices invoices
        where invoices.restaurant_id = orders.restaurant_id
          and invoices.order_id = orders.id
      )
      and not exists (
        select 1 from public.order_invoices invoices
        where invoices.restaurant_id = orders.restaurant_id
          and invoices.order_id = orders.id
          and invoices.payment_status not in ('paid', 'cancelled', 'refunded')
      )
      and not exists (
        select 1 from public.order_items items
        where items.restaurant_id = orders.restaurant_id
          and items.order_id = orders.id
          and coalesce(items.kitchen_status, 'pending') not in ('completed', 'served', 'delivered')
      )
  loop
    perform public.try_auto_release_settled_service_location(
      candidate.id,
      'settled_service_location_backfill'
    );
  end loop;
end;
$$;

comment on function public.try_auto_release_settled_service_location(uuid, text) is
  'Tenant-scoped idempotent release after every invoice is terminal, every item is served, and no other open order remains on the service location.';
