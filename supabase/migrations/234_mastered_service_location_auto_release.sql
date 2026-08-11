-- Mastered automatic physical service-location release.
--
-- The orders row is the dining session. A release is therefore evaluated over
-- every invoice and every item owned by that row, never from a single batch.
-- Kitchen COMPLETED is the MVP service-completion proxy; READY still blocks.

create or replace function public.service_location_session_lock_key(
  target_restaurant_id uuid,
  target_table_number text
)
returns bigint
language sql
immutable
strict
set search_path = public
as $$
  select hashtextextended(target_restaurant_id::text || ':' || trim(target_table_number), 0);
$$;

revoke all on function public.service_location_session_lock_key(uuid, text)
from public, anon, authenticated;
grant execute on function public.service_location_session_lock_key(uuid, text)
to service_role;

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
  hint public.orders;
  target public.orders;
  actor public.restaurant_staff;
  released public.orders;
  released_at timestamptz := clock_timestamp();
begin
  -- Read identity without a row lock, then take the same tenant/location lock
  -- used by the QR and waiter add-on paths. All participating paths therefore
  -- acquire location before order and cannot deadlock in opposite order.
  select * into hint
  from public.orders orders
  where orders.id = target_order_id;

  if hint.id is null then
    raise exception 'Order not found.';
  end if;

  -- Only a session that canonically owns a configured physical service
  -- location is eligible. Non-table delivery/takeaway/pickup rows are no-ops.
  if hint.table_id is null
    or nullif(trim(hint.table_number), '') is null
    or not exists (
      select 1
      from public.restaurant_tables locations
      where locations.restaurant_id = hint.restaurant_id
        and locations.id = hint.table_id
        and locations.table_number::text = trim(hint.table_number)
    )
  then
    return hint;
  end if;

  perform pg_advisory_xact_lock(public.service_location_session_lock_key(
    hint.restaurant_id,
    hint.table_number
  ));

  select * into target
  from public.orders orders
  where orders.id = hint.id
    and orders.restaurant_id = hint.restaurant_id
  for update;

  if target.id is null then
    raise exception 'Order not found.';
  end if;

  -- Revalidate identity and lifecycle after waiting for the location lock.
  if target.table_id is null
    or nullif(trim(target.table_number), '') is null
    or not exists (
      select 1
      from public.restaurant_tables locations
      where locations.restaurant_id = target.restaurant_id
        and locations.id = target.table_id
        and locations.table_number::text = trim(target.table_number)
    )
    or target.table_released_at is not null
    or target.dining_session_status <> 'open'
  then
    return target;
  end if;

  -- Keep the interactive actor when one exists. Automatic lifecycle work is
  -- still allowed without one; shift_activity_logs supports a NULL system actor.
  select * into actor
  from public.restaurant_staff staff
  where staff.restaurant_id = target.restaurant_id
    and staff.active
    and (staff.user_id = auth.uid() or staff.id = target.completed_by)
  order by case when staff.user_id = auth.uid() then 0 else 1 end
  limit 1;

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
      and items.kitchen_status not in ('completed', 'cancelled')
  ) then
    return target;
  end if;

  if exists (
    select 1 from public.orders other_sessions
    where other_sessions.restaurant_id = target.restaurant_id
      and other_sessions.table_id = target.table_id
      and other_sessions.id <> target.id
      and other_sessions.dining_session_status = 'open'
      and other_sessions.table_released_at is null
  ) then
    return target;
  end if;

  update public.orders orders
  set dining_session_status = 'closed',
      dining_session_closed_at = coalesce(orders.dining_session_closed_at, released_at),
      dining_session_close_reason = coalesce(
        nullif(left(trim(release_reason), 80), ''),
        'settled_service_location_auto_release'
      ),
      table_released_at = released_at,
      status = 'completed'::public.order_status,
      operational_status = 'closed',
      -- completed_by/completed_at are a constrained pair. Preserve an existing
      -- pair or stamp both when a real actor exists; system releases retain the
      -- authoritative dining-session timestamps plus the system audit row.
      completed_by = coalesce(orders.completed_by, actor.id),
      completed_at = case
        when coalesce(orders.completed_by, actor.id) is not null
          then coalesce(orders.completed_at, released_at)
        else null
      end,
      updated_at = released_at
  where orders.id = target.id
    and orders.restaurant_id = target.restaurant_id
    and orders.dining_session_status = 'open'
    and orders.table_released_at is null
  returning * into released;

  if released.id is null then
    select * into released from public.orders where id = target.id;
    return released;
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
      where actor.id is not null
        and shifts.restaurant_id = released.restaurant_id
        and shifts.opened_by = actor.id
        and shifts.closed_at is null
      order by shifts.opened_at desc limit 1
    ),
    released.id,
    actor.id,
    'service_location_released',
    'Completed and financially settled session automatically released its service location',
    released.total_price,
    jsonb_build_object(
      'automatic', true,
      'actor_type', case when actor.id is null then 'system' else 'staff' end,
      'reason', release_reason,
      'table_id', released.table_id,
      'table_number', released.table_number,
      'terminal_item_states', jsonb_build_array('completed', 'cancelled'),
      'terminal_invoice_states', jsonb_build_array('paid', 'cancelled', 'refunded'),
      'service_completion_proxy', 'kitchen_completed'
    )
  );

  return released;
end;
$$;

revoke all on function public.try_auto_release_settled_service_location(uuid, text)
from public, anon, authenticated;
grant execute on function public.try_auto_release_settled_service_location(uuid, text)
to service_role;

create or replace function public.auto_release_service_location_after_item_terminal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kitchen_status in ('completed', 'cancelled')
    and old.kitchen_status is distinct from new.kitchen_status
    and old.kitchen_status not in ('completed', 'cancelled')
  then
    perform public.try_auto_release_settled_service_location(
      new.order_id,
      case
        when new.kitchen_status = 'cancelled'
          then 'finalized_cancellation_auto_release'
        else 'items_terminal_after_payment_auto_release'
      end
    );
  end if;
  return new;
end;
$$;

revoke all on function public.auto_release_service_location_after_item_terminal()
from public, anon, authenticated;

-- Payment verification acquires location before the legacy implementation's
-- order row lock, then always invokes the canonical session evaluator.
alter function public.verify_dining_session_payment(uuid, text, text, text, text, boolean)
rename to verify_dining_session_payment_phase234_base;

revoke all on function public.verify_dining_session_payment_phase234_base(uuid, text, text, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.verify_dining_session_payment_phase234_base(uuid, text, text, text, text, boolean)
to service_role;

create or replace function public.verify_dining_session_payment(
  target_dining_session_id uuid,
  selected_payment_method text,
  payment_reference_number text default null,
  payment_transaction_id text default null,
  payment_screenshot_url text default null,
  owner_duplicate_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hint public.orders;
  actor public.restaurant_staff;
  payload jsonb;
  released public.orders;
  remaining_unpaid_count integer;
  remaining_active_item_count integer;
  remaining_open_order_count integer;
  physical_session boolean := false;
begin
  select * into hint from public.orders where id = target_dining_session_id;
  if hint.id is null then raise exception 'Dining session not found.'; end if;

  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = hint.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role = 'cashier'
  limit 1;
  if actor.id is null then raise exception 'Only an active cashier may settle a dining session.'; end if;

  physical_session := hint.table_id is not null
    and nullif(trim(hint.table_number), '') is not null
    and exists (
      select 1 from public.restaurant_tables locations
      where locations.restaurant_id = hint.restaurant_id
        and locations.id = hint.table_id
        and locations.table_number::text = trim(hint.table_number)
    );

  if physical_session then
    perform pg_advisory_xact_lock(public.service_location_session_lock_key(
      hint.restaurant_id, hint.table_number
    ));
  end if;

  payload := public.verify_dining_session_payment_phase234_base(
    target_dining_session_id,
    selected_payment_method,
    payment_reference_number,
    payment_transaction_id,
    payment_screenshot_url,
    owner_duplicate_override
  );

  if physical_session then
    released := public.try_auto_release_settled_service_location(
      hint.id,
      'cashier_payment_verified_auto_release'
    );
  end if;

  select count(*) into remaining_unpaid_count
  from public.order_invoices invoices
  where invoices.restaurant_id = hint.restaurant_id
    and invoices.order_id = hint.id
    and invoices.payment_status not in ('paid', 'cancelled', 'refunded');

  select count(*) into remaining_active_item_count
  from public.order_items items
  where items.restaurant_id = hint.restaurant_id
    and items.order_id = hint.id
    and items.kitchen_status not in ('completed', 'cancelled');

  select count(*) into remaining_open_order_count
  from public.orders other_sessions
  where other_sessions.restaurant_id = hint.restaurant_id
    and other_sessions.table_id = hint.table_id
    and other_sessions.id <> hint.id
    and other_sessions.dining_session_status = 'open'
    and other_sessions.table_released_at is null;

  return payload || jsonb_build_object(
    'table_released', physical_session and released.table_released_at is not null,
    'remaining_unpaid_count', remaining_unpaid_count,
    'remaining_active_item_count', remaining_active_item_count,
    'remaining_open_order_count', remaining_open_order_count,
    'remaining_state', case
      when not physical_session then 'non_physical'
      when remaining_unpaid_count > 0 then 'payment_due'
      when remaining_active_item_count > 0 then 'active_items'
      when remaining_open_order_count > 0 then 'other_open_order'
      when released.table_released_at is not null then 'released'
      else 'occupied'
    end
  );
end;
$$;

revoke all on function public.verify_dining_session_payment(uuid, text, text, text, text, boolean)
from public, anon;
grant execute on function public.verify_dining_session_payment(uuid, text, text, text, text, boolean)
to authenticated;

-- Cashier append and create paths join the waiter/customer location lock order.
alter function public.append_items_to_order(uuid, jsonb)
rename to append_items_to_order_phase234_base;
revoke all on function public.append_items_to_order_phase234_base(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.append_items_to_order_phase234_base(uuid, jsonb)
to service_role;

create or replace function public.append_items_to_order(target_order_id uuid, requested_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hint public.orders;
  actor public.restaurant_staff;
begin
  select * into hint from public.orders where id = target_order_id;
  if hint.id is null then raise exception 'Order not found.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = hint.restaurant_id and staff.user_id = auth.uid()
    and staff.active and staff.role = 'cashier' limit 1;
  if actor.id is null then raise exception 'Only active cashiers may append order items.'; end if;
  if hint.table_id is not null and nullif(trim(hint.table_number), '') is not null then
    perform pg_advisory_xact_lock(public.service_location_session_lock_key(hint.restaurant_id, hint.table_number));
  end if;
  return public.append_items_to_order_phase234_base(target_order_id, requested_items);
end;
$$;
revoke all on function public.append_items_to_order(uuid, jsonb) from public, anon;
grant execute on function public.append_items_to_order(uuid, jsonb) to authenticated;

alter function public.create_cashier_order(uuid, text, text, jsonb)
rename to create_cashier_order_phase234_base;
revoke all on function public.create_cashier_order_phase234_base(uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.create_cashier_order_phase234_base(uuid, text, text, jsonb)
to service_role;

create or replace function public.create_cashier_order(
  target_restaurant_id uuid,
  table_number text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.restaurant_staff;
begin
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id and staff.user_id = auth.uid()
    and staff.active and staff.role::text in ('cashier', 'owner') limit 1;
  if actor.id is null then raise exception 'Only active cashiers and owners may create cashier orders.'; end if;
  if nullif(trim(table_number), '') is not null then
    perform pg_advisory_xact_lock(public.service_location_session_lock_key(target_restaurant_id, table_number));
  end if;
  return public.create_cashier_order_phase234_base(
    target_restaurant_id, table_number, selected_payment_method, requested_items
  );
end;
$$;
revoke all on function public.create_cashier_order(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_cashier_order(uuid, text, text, jsonb) to authenticated;

-- Finalized cashier cancellation now participates in release without changing
-- the Phase 2 authority model. The wrapper acquires location before its base
-- implementation locks the order and cancellation request.
alter function public.cashier_handle_cancellation_request(uuid, text)
rename to cashier_handle_cancellation_request_phase234_base;
revoke all on function public.cashier_handle_cancellation_request_phase234_base(uuid, text)
from public, anon, authenticated;
grant execute on function public.cashier_handle_cancellation_request_phase234_base(uuid, text)
to service_role;

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
  hint public.orders;
  actor public.restaurant_staff;
begin
  select orders.* into hint
  from public.order_cancellation_requests requests
  join public.orders orders
    on orders.restaurant_id = requests.restaurant_id and orders.id = requests.order_id
  where requests.id = target_request_id;
  if hint.id is null then raise exception 'Cancellation request not found.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = hint.restaurant_id and staff.user_id = auth.uid()
    and staff.active and staff.role = 'cashier' limit 1;
  if actor.id is null then raise exception 'Only an active cashier may handle cancellation requests.'; end if;
  if hint.table_id is not null and nullif(trim(hint.table_number), '') is not null then
    perform pg_advisory_xact_lock(public.service_location_session_lock_key(hint.restaurant_id, hint.table_number));
  end if;
  return public.cashier_handle_cancellation_request_phase234_base(target_request_id, requested_action);
end;
$$;
revoke all on function public.cashier_handle_cancellation_request(uuid, text) from public, anon;
grant execute on function public.cashier_handle_cancellation_request(uuid, text) to authenticated;

-- Keep legacy close entry points aligned with the one release evaluator.
create or replace function public.close_dining_session_phase122a_base(
  target_order_id uuid,
  close_reason text default 'customer_left'
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.try_auto_release_settled_service_location(target_order_id, close_reason);
end;
$$;

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
  released public.orders;
begin
  select * into target from public.orders where id = target_order_id;
  if target.id is null then raise exception 'Dining session not found.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target.restaurant_id and staff.user_id = auth.uid()
    and staff.active and staff.role::text in ('cashier', 'owner', 'manager') limit 1;
  if actor.id is null then raise exception 'Only active cashier or management staff may release a service location.'; end if;
  released := public.try_auto_release_settled_service_location(target.id, close_reason);
  if released.table_released_at is null then
    raise exception 'The service location cannot be released while payment or service work remains.';
  end if;
  return released;
end;
$$;

revoke all on function public.close_dining_session(uuid, text) from public, anon;
grant execute on function public.close_dining_session(uuid, text) to authenticated;

comment on function public.try_auto_release_settled_service_location(uuid, text) is
  'Tenant-scoped, physical-location-only, session-level release. Requires at least one invoice, all invoices paid/cancelled/refunded, all items completed/cancelled, and no other open session. READY blocks. Supports staff or system-triggered audit.';
comment on function public.service_location_session_lock_key(uuid, text) is
  'Canonical tenant plus service-location advisory lock key shared by ordering, payment, cancellation, and release paths.';
