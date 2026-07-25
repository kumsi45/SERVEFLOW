-- Critical workflow integrity fix: restaurant policy is copied once when the
-- dining-session order is created. Active work never reads live settings.

alter table public.orders
  add column if not exists workflow_policy_snapshot text,
  add column if not exists workflow_version integer,
  add column if not exists workflow_captured_at timestamptz;

-- Existing sessions are reconstructed from their already-persisted timing,
-- never from the restaurant's current setting.
update public.orders
set workflow_policy_snapshot = case
      when payment_timing = 'after_meal' then 'kitchen_before_payment'
      else 'pay_before_kitchen'
    end,
    workflow_version = coalesce(workflow_version, 1),
    workflow_captured_at = coalesce(
      workflow_captured_at,
      dining_session_opened_at,
      created_at
    )
where workflow_policy_snapshot is null
   or workflow_version is null
   or workflow_captured_at is null;

alter table public.orders
  alter column workflow_policy_snapshot set not null,
  alter column workflow_version set not null,
  alter column workflow_version set default 1,
  alter column workflow_captured_at set not null,
  alter column workflow_captured_at set default now(),
  drop constraint if exists orders_workflow_policy_snapshot_allowed,
  add constraint orders_workflow_policy_snapshot_allowed
    check (workflow_policy_snapshot in ('pay_before_kitchen','kitchen_before_payment')),
  drop constraint if exists orders_workflow_version_positive,
  add constraint orders_workflow_version_positive check (workflow_version > 0);

create index if not exists orders_restaurant_workflow_snapshot_idx
on public.orders (restaurant_id, workflow_policy_snapshot, dining_session_status);

create or replace function public.sync_normalized_order_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_policy text;
begin
  if tg_op = 'INSERT' then
    select restaurants.payment_policy into current_policy
    from public.restaurants restaurants
    where restaurants.id = new.restaurant_id;
    if current_policy not in ('pay_before_kitchen','kitchen_before_payment') then
      raise exception 'Restaurant workflow policy could not be captured.';
    end if;
    new.workflow_policy_snapshot := current_policy;
    new.workflow_version := 1;
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
    new.payment_timing := case
      when new.order_source = 'waiter'
        and new.workflow_policy_snapshot = 'kitchen_before_payment'
        then 'after_meal'
      else 'before_kitchen'
    end;
  elsif new.payment_timing is distinct from old.payment_timing then
    raise exception 'Order payment timing is frozen by the dining-session workflow snapshot.';
  end if;

  if new.order_source = 'public_qr' and new.payment_timing <> 'before_kitchen' then
    raise exception 'QR customer orders must be paid before kitchen release.';
  end if;
  if new.payment_timing = 'after_meal'
     and (tg_op = 'INSERT'
       or new.order_source is distinct from old.order_source
       or new.created_by_waiter_id is distinct from old.created_by_waiter_id) then
    if new.order_source <> 'waiter'
       or new.created_by_waiter_id is null
       or not exists (
         select 1 from public.restaurant_staff staff
         where staff.id = new.created_by_waiter_id
           and staff.restaurant_id = new.restaurant_id
           and staff.role::text = 'waiter'
           and staff.active
           and staff.user_id = auth.uid()
       ) then
      raise exception 'Deferred payment is available only to authenticated waiter orders.';
    end if;
  end if;

  if new.dining_session_status::text in ('closed','expired','abandoned')
     or new.table_released_at is not null then
    new.operational_status := 'closed';
  elsif new.status::text = 'completed' then new.operational_status := 'served';
  elsif new.status::text = 'ready' then new.operational_status := 'ready';
  elsif new.status::text = 'preparing' then new.operational_status := 'preparing';
  elsif new.status::text = 'paid' and new.operational_status = 'new' then
    new.operational_status := 'accepted';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_normalized_order_lifecycle_trigger on public.orders;
create trigger sync_normalized_order_lifecycle_trigger
before insert or update of status, dining_session_status, table_released_at,
  payment_timing, order_source, restaurant_id, created_by_waiter_id,
  workflow_policy_snapshot, workflow_version, workflow_captured_at
on public.orders
for each row execute function public.sync_normalized_order_lifecycle();

-- Existing compatibility callers may resolve live policy only while creating a
-- new session. Runtime consumers use the session-specific helper below.
create or replace function public.resolve_dining_session_payment_timing(
  target_dining_session_id uuid,
  target_order_source text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(target_order_source, orders.order_source) = 'waiter'
      and orders.workflow_policy_snapshot = 'kitchen_before_payment'
      then 'after_meal'
    else 'before_kitchen'
  end
  from public.orders orders
  where orders.id = target_dining_session_id
$$;

-- Every kitchen write asks the central engine with the stored snapshot.
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
  source text;
  payment text;
  kitchen text;
begin
  select * into target_session from public.orders where id = target_dining_session_id;
  if target_session.id is null then raise exception 'Dining session not found.'; end if;
  if not public.has_staff_role(target_session.restaurant_id,
    array['owner','manager','waiter','cashier','kitchen']::public.restaurant_staff_role[]) then
    raise exception 'Dining session is outside the active restaurant.';
  end if;
  select case when bool_and(invoices.payment_status = 'paid') then 'paid' else 'unpaid' end,
    coalesce(max(invoices.invoice_source) filter (where invoices.invoice_source = 'waiter'),
      max(invoices.invoice_source), target_session.order_source)
  into payment, source from public.order_invoices invoices
  where invoices.order_id = target_session.id;
  select case
    when bool_and(items.kitchen_status in ('completed','served')) then 'completed'
    when bool_and(items.kitchen_status in ('ready','completed','served')) then 'ready'
    when bool_or(items.kitchen_status = 'preparing') then 'preparing'
    when bool_or(items.kitchen_status = 'accepted') then 'accepted'
    else 'not_started' end
  into kitchen from public.order_items items where items.order_id = target_session.id;
  return public.resolve_order_workflow(jsonb_build_object(
    'restaurant_id', target_session.restaurant_id,
    'waiter_policy', target_session.workflow_policy_snapshot,
    'order_source', case source when 'public_qr' then 'customer_qr'
      when 'cashier' then 'cashier_pos' else coalesce(source, 'unknown') end,
    'dining_session_state', case when target_session.dining_session_status = 'open' then 'open' else 'closed' end,
    'payment_status', coalesce(payment, 'unpaid'),
    'kitchen_status', coalesce(kitchen, 'not_started')
  )) || jsonb_build_object(
    'workflow_policy_snapshot', target_session.workflow_policy_snapshot,
    'workflow_version', target_session.workflow_version,
    'workflow_captured_at', target_session.workflow_captured_at
  );
end;
$$;

revoke all on function public.resolve_dining_session_payment_timing(uuid, text)
from public, anon;
grant execute on function public.resolve_dining_session_payment_timing(uuid, text)
to authenticated, service_role;

-- Appended waiter batches inherit the open session snapshot. They never
-- re-resolve the restaurant setting.
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
  payload jsonb;
  target_order public.orders;
  target_invoice public.order_invoices;
  acting_waiter public.restaurant_staff;
  resolved_timing text;
begin
  payload := public.submit_waiter_order_batch_phase7a1_base(
    target_restaurant_slug, table_number, customer_name, customer_phone,
    order_note, requested_items, client_request_id
  );
  select orders.* into target_order from public.orders orders
  where orders.id = nullif(payload->>'order_id', '')::uuid for update;
  select staff.* into acting_waiter from public.restaurant_staff staff
  where staff.restaurant_id = target_order.restaurant_id
    and staff.user_id = auth.uid() and staff.active and staff.role::text = 'waiter'
  limit 1;
  if target_order.id is null or acting_waiter.id is null then
    raise exception 'Active waiter order session not found.';
  end if;
  select invoices.* into target_invoice from public.order_invoices invoices
  where invoices.id = nullif(payload->>'invoice_id', '')::uuid
    and invoices.order_id = target_order.id
    and invoices.restaurant_id = target_order.restaurant_id for update;
  if target_invoice.id is null then
    raise exception 'Waiter order batch invoice was not created.';
  end if;

  perform public.stamp_invoice_ownership(
    target_invoice.id, 'waiter', acting_waiter.id, acting_waiter.display_name
  );
  resolved_timing := public.resolve_dining_session_payment_timing(
    target_order.id, 'waiter'
  );

  if resolved_timing = 'after_meal' then
    update public.orders
    set order_source = 'waiter',
        created_by_waiter_id = coalesce(created_by_waiter_id, acting_waiter.id),
        updated_at = clock_timestamp()
    where id = target_order.id;
    update public.order_invoices
    set payment_status = 'held', updated_at = clock_timestamp()
    where id = target_invoice.id;
    update public.order_items set kitchen_status = 'accepted'
    where order_id = target_order.id and invoice_id = target_invoice.id;
  else
    update public.order_invoices
    set payment_status = 'pending', updated_at = clock_timestamp()
    where id = target_invoice.id;
    update public.order_items set kitchen_status = 'held'
    where order_id = target_order.id and invoice_id = target_invoice.id;
  end if;

  payload := payload || jsonb_build_object(
    'invoice_id', target_invoice.id,
    'invoice_source', 'waiter',
    'invoice_creator_name', acting_waiter.display_name,
    'created_by_staff_id', acting_waiter.id,
    'payment_timing', resolved_timing,
    'workflow_policy_snapshot', target_order.workflow_policy_snapshot,
    'workflow_version', target_order.workflow_version
  );
  update public.waiter_batch_requests
  set response = payload, waiter_staff_id = acting_waiter.id
  where id = client_request_id;
  return payload;
end;
$$;

revoke all on function public.submit_waiter_order_batch(
  text, text, text, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.submit_waiter_order_batch(
  text, text, text, text, text, jsonb, uuid
) to authenticated, service_role;

comment on column public.orders.workflow_policy_snapshot is
  'Immutable waiter workflow policy captured when this dining session opened.';
comment on column public.orders.workflow_version is
  'Version of the workflow contract captured by this dining session.';
comment on column public.orders.workflow_captured_at is
  'Timestamp at which the dining session froze its restaurant workflow policy.';
