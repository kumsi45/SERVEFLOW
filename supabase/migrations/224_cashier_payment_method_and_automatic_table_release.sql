-- Cashier checkout authority: waiter batches never preselect collection,
-- cashier verification records the configured method, and a fully settled
-- service location is released atomically without making printing authoritative.

alter table public.business_payment_methods
  drop constraint if exists business_payment_method_code_allowed,
  add constraint business_payment_method_code_allowed check (
    method_code in (
      'cash', 'telebirr', 'cbe_birr', 'mobile_banking',
      'bank_transfer', 'credit_card', 'qr'
    )
  );

insert into public.business_payment_methods(
  restaurant_id, method_code, display_name, enabled, display_order
)
select restaurants.id, 'qr', 'QR', false, 70
from public.restaurants
on conflict (restaurant_id, method_code) do nothing;

create or replace function public.payment_method_is_supported(payment_method text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.normalize_payment_method(payment_method) in (
    'Cash', 'Card', 'Telebirr', 'CBE Birr', 'Chapa', 'Mobile Banking',
    'Bank Transfer', 'QR', 'Mixed'
  )
$$;

alter function public.submit_waiter_order_batch(
  text, text, text, text, text, jsonb, uuid
) rename to submit_waiter_order_batch_phase224_base;

revoke all on function public.submit_waiter_order_batch_phase224_base(
  text, text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.submit_waiter_order_batch_phase224_base(
  text, text, text, text, text, jsonb, uuid
) to service_role;

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
  target_order_id uuid;
  target_invoice_id uuid;
  target_restaurant_id uuid;
begin
  payload := public.submit_waiter_order_batch_phase224_base(
    target_restaurant_slug, table_number, customer_name, customer_phone,
    order_note, requested_items, client_request_id
  );

  target_order_id := nullif(payload->>'order_id', '')::uuid;
  target_invoice_id := nullif(payload->>'invoice_id', '')::uuid;

  select orders.restaurant_id
  into target_restaurant_id
  from public.orders orders
  where orders.id = target_order_id;

  if target_restaurant_id is null or target_invoice_id is null then
    raise exception 'Waiter order batch was not created.';
  end if;

  -- A waiter identifies the source of the batch, not how the customer paid.
  update public.order_invoices invoices
  set payment_method = null,
      updated_at = clock_timestamp()
  where invoices.id = target_invoice_id
    and invoices.restaurant_id = target_restaurant_id
    and invoices.order_id = target_order_id
    and coalesce(invoices.invoice_source, 'waiter') = 'waiter'
    and invoices.payment_status in ('pending', 'held');

  -- Remove the legacy order-level Cash default only for an entirely waiter-owned,
  -- unpaid session. A known public/customer method is never discarded.
  update public.orders orders
  set payment_method = null,
      updated_at = clock_timestamp()
  where orders.id = target_order_id
    and orders.restaurant_id = target_restaurant_id
    and not exists (
      select 1
      from public.order_invoices invoices
      where invoices.restaurant_id = orders.restaurant_id
        and invoices.order_id = orders.id
        and (
          invoices.payment_status = 'paid'
          or coalesce(invoices.invoice_source, 'unknown') <> 'waiter'
        )
    );

  return payload || jsonb_build_object('payment_method', null);
end;
$$;

revoke all on function public.submit_waiter_order_batch(
  text, text, text, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.submit_waiter_order_batch(
  text, text, text, text, text, jsonb, uuid
) to authenticated, service_role;

alter function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) rename to verify_dining_session_payment_phase224_base;

revoke all on function public.verify_dining_session_payment_phase224_base(
  uuid, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.verify_dining_session_payment_phase224_base(
  uuid, text, text, text, text, boolean
) to service_role;

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
  target_session public.orders;
  acting_cashier public.restaurant_staff;
  normalized_method text;
  payload jsonb;
  due_count integer;
  remaining_unpaid_count integer;
  remaining_active_item_count integer;
  remaining_open_order_count integer;
  released public.orders;
begin
  select *
  into target_session
  from public.orders orders
  where orders.id = target_dining_session_id
  for update;

  if target_session.id is null then
    raise exception 'Dining session not found.';
  end if;

  select *
  into acting_cashier
  from public.restaurant_staff staff
  where staff.restaurant_id = target_session.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role = 'cashier'
  limit 1;

  if acting_cashier.id is null then
    raise exception 'Only an active cashier may settle a dining session.';
  end if;

  normalized_method := public.normalize_payment_method(selected_payment_method);
  if normalized_method is null then
    raise exception 'Select a payment method before verifying payment.';
  end if;

  if not exists (
    select 1
    from public.business_payment_methods methods
    where methods.restaurant_id = target_session.restaurant_id
      and methods.enabled
      and normalized_method = case methods.method_code
        when 'cash' then 'Cash'
        when 'telebirr' then 'Telebirr'
        when 'cbe_birr' then 'CBE Birr'
        when 'mobile_banking' then 'Mobile Banking'
        when 'bank_transfer' then 'Bank Transfer'
        when 'credit_card' then 'Card'
        when 'qr' then 'QR'
      end
  ) and not (
    -- Preserve a customer/QR method that was authoritatively recorded while it
    -- was enabled. A blank or mixed-method running bill still requires a
    -- currently enabled cashier selection.
    exists (
      select 1 from public.order_invoices invoices
      where invoices.restaurant_id = target_session.restaurant_id
        and invoices.order_id = target_session.id
        and invoices.payment_status in ('pending', 'held')
        and public.normalize_payment_method(invoices.payment_method) = normalized_method
    )
    and not exists (
      select 1 from public.order_invoices invoices
      where invoices.restaurant_id = target_session.restaurant_id
        and invoices.order_id = target_session.id
        and invoices.payment_status in ('pending', 'held')
        and public.normalize_payment_method(invoices.payment_method) is distinct from normalized_method
    )
  ) then
    raise exception 'The selected payment method is not enabled for this business.';
  end if;

  select count(*)
  into due_count
  from public.order_invoices invoices
  where invoices.restaurant_id = target_session.restaurant_id
    and invoices.order_id = target_session.id
    and invoices.payment_status in ('pending', 'held');

  if due_count > 0 then
    payload := public.verify_dining_session_payment_phase224_base(
      target_session.id,
      normalized_method,
      payment_reference_number,
      payment_transaction_id,
      payment_screenshot_url,
      owner_duplicate_override
    );
  elsif exists (
    select 1 from public.order_invoices invoices
    where invoices.restaurant_id = target_session.restaurant_id
      and invoices.order_id = target_session.id
      and invoices.payment_status = 'paid'
  ) and not exists (
    select 1 from public.order_invoices invoices
    where invoices.restaurant_id = target_session.restaurant_id
      and invoices.order_id = target_session.id
      and invoices.payment_status = 'paid'
      and public.normalize_payment_method(invoices.payment_method) is distinct from normalized_method
  ) then
    payload := jsonb_build_object(
      'dining_session_id', target_session.id,
      'restaurant_id', target_session.restaurant_id,
      'payment_status', 'paid',
      'payment_method', normalized_method,
      'settled_invoice_count', 0,
      'settled_total', 0,
      'collected_by', acting_cashier.id,
      'collected_at', now(),
      'idempotent', true
    );
  else
    raise exception 'Dining session has no payment due.';
  end if;

  -- Invoice rows remain the payment authority. The session projection mirrors
  -- the verified method so legacy consumers cannot continue showing Cash.
  update public.orders
  set payment_method = normalized_method,
      updated_at = clock_timestamp()
  where id = target_session.id
    and restaurant_id = target_session.restaurant_id
    and public.normalize_payment_method(payment_method) is distinct from normalized_method;

  select count(*)
  into remaining_unpaid_count
  from public.order_invoices invoices
  where invoices.restaurant_id = target_session.restaurant_id
    and invoices.order_id = target_session.id
    and invoices.payment_status not in ('paid', 'cancelled', 'refunded');

  select count(*)
  into remaining_active_item_count
  from public.order_items items
  where items.restaurant_id = target_session.restaurant_id
    and items.order_id = target_session.id
    and items.kitchen_status <> 'completed';

  select count(*)
  into remaining_open_order_count
  from public.orders orders
  where orders.restaurant_id = target_session.restaurant_id
    and orders.id <> target_session.id
    and orders.dining_session_status = 'open'
    and orders.table_released_at is null
    and (
      (target_session.table_id is not null and orders.table_id = target_session.table_id)
      or (
        nullif(trim(target_session.table_number), '') is not null
        and nullif(trim(orders.table_number), '') is not null
        and trim(orders.table_number) = trim(target_session.table_number)
      )
    );

  if remaining_unpaid_count = 0
    and remaining_active_item_count = 0
    and remaining_open_order_count = 0
    and target_session.dining_session_status = 'open'
  then
    released := public.close_dining_session(
      target_session.id,
      'cashier_payment_verified_auto_release'
    );
  end if;

  return payload || jsonb_build_object(
    'table_released', released.table_released_at is not null
      or target_session.table_released_at is not null,
    'remaining_unpaid_count', remaining_unpaid_count,
    'remaining_active_item_count', remaining_active_item_count,
    'remaining_open_order_count', remaining_open_order_count,
    'remaining_state', case
      when remaining_unpaid_count > 0 then 'payment_due'
      when remaining_active_item_count > 0 then 'active_items'
      when remaining_open_order_count > 0 then 'other_open_order'
      else 'released'
    end
  );
end;
$$;

revoke all on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) from public, anon;
grant execute on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) to authenticated, service_role;

create or replace function public.get_cashier_checkout_payment_methods(
  target_restaurant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor public.restaurant_staff;
begin
  select * into actor
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role in ('cashier', 'owner')
  limit 1;

  if actor.id is null then
    raise exception 'Only active cashiers and owners may view checkout payment methods.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'method_code', methods.method_code,
      'display_name', methods.display_name,
      'value', case methods.method_code
        when 'cash' then 'Cash'
        when 'telebirr' then 'Telebirr'
        when 'cbe_birr' then 'CBE Birr'
        when 'mobile_banking' then 'Mobile Banking'
        when 'bank_transfer' then 'Bank Transfer'
        when 'credit_card' then 'Card'
        when 'qr' then 'QR'
      end
    ) order by methods.display_order, methods.display_name)
    from public.business_payment_methods methods
    where methods.restaurant_id = target_restaurant_id
      and methods.enabled
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_cashier_checkout_payment_methods(uuid)
from public, anon;
grant execute on function public.get_cashier_checkout_payment_methods(uuid)
to authenticated;

-- The order-level method is only a compatibility fallback. It must never make
-- an unpaid waiter invoice look like the customer already selected a method.
do $$
declare
  definition text;
  old_projection text := '''payment_method'',coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method))';
  new_projection text := '''payment_method'',case when i.payment_status in(''pending'',''held'') then public.normalize_payment_method(i.payment_method) else coalesce(public.normalize_payment_method(i.payment_method),public.normalize_payment_method(o.payment_method)) end';
begin
  select pg_get_functiondef('public.get_cashier_payment_queue(uuid)'::regprocedure)
  into definition;
  if position(old_projection in definition) > 0 then
    execute replace(definition, old_projection, new_projection);
  elsif position(new_projection in definition) = 0 then
    raise exception 'Cashier payment queue method projection could not be updated safely.';
  end if;
end $$;

comment on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) is 'Cashier-only configured-method settlement with idempotent conditional service-location release.';
