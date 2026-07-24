-- Official ServeFlow waiter workflow engine (migration 161).
-- The orders row is the dining session; order_invoices are append-only order
-- batches within that session. Payment collection is session-scoped.

alter table public.restaurants
  drop constraint if exists restaurants_payment_policy_allowed;

update public.restaurants
set payment_policy = case
  when payment_policy = 'hold_payment' then 'kitchen_before_payment'
  when payment_policy = 'mixed' and mixed_waiter_payment_timing = 'after_meal'
    then 'kitchen_before_payment'
  else 'pay_before_kitchen'
end
where payment_policy not in ('pay_before_kitchen', 'kitchen_before_payment');

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
    -- Customer QR and cashier POS permanently pay before kitchen.
    when coalesce(target_order_source, '') in ('public_qr', 'cashier')
      then 'before_kitchen'
    -- Only authenticated waiter batches may follow the restaurant's mode.
    when coalesce(target_order_source, '') = 'waiter'
      and restaurants.payment_policy = 'kitchen_before_payment'
      then 'after_meal'
    else 'before_kitchen'
  end
  from public.restaurants
  where restaurants.id = target_restaurant_id
$$;

create or replace function public.set_restaurant_payment_policy(
  target_restaurant_id uuid,
  requested_policy text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if requested_policy not in ('pay_before_kitchen', 'kitchen_before_payment') then
    raise exception 'Waiter workflow must be Pay Before Kitchen or Kitchen Before Payment.';
  end if;
  if not public.has_staff_role(
    target_restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  ) then
    raise exception 'Only the restaurant owner may change the waiter workflow.';
  end if;

  update public.restaurants
  set payment_policy = requested_policy,
      updated_at = now()
  where id = target_restaurant_id;

  if not found then raise exception 'Restaurant not found.'; end if;
  return requested_policy;
end;
$$;

drop function if exists public.set_mixed_waiter_payment_timing(uuid, text);
alter table public.restaurants drop column if exists mixed_waiter_payment_timing;

alter table public.restaurants
  add constraint restaurants_payment_policy_allowed
  check (payment_policy in ('pay_before_kitchen', 'kitchen_before_payment'));

revoke all on function public.resolve_order_payment_timing(uuid, text)
  from public, anon;
grant execute on function public.resolve_order_payment_timing(uuid, text)
  to authenticated, service_role;
revoke all on function public.set_restaurant_payment_policy(uuid, text)
  from public, anon;
grant execute on function public.set_restaurant_payment_policy(uuid, text)
  to authenticated, service_role;

-- QR batches remain distinct from deferred waiter batches in the same dining
-- session and never leave Held until cashier-verified payment.
create or replace function public.merge_open_session_invoice(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  created_invoice_id uuid := nullif(payload->>'invoice_id', '')::uuid;
  canonical_invoice public.order_invoices;
  created_invoice public.order_invoices;
begin
  if target_order_id is null or created_invoice_id is null then return payload; end if;

  select * into created_invoice
  from public.order_invoices invoices
  where invoices.id = created_invoice_id
    and invoices.order_id = target_order_id
  for update;
  if created_invoice.id is null then return payload; end if;

  update public.order_invoices
  set payment_status = 'pending', updated_at = clock_timestamp()
  where id = created_invoice.id;

  update public.order_items
  set kitchen_status = 'held'
  where order_id = target_order_id
    and invoice_id = created_invoice.id;

  select * into canonical_invoice
  from public.order_invoices invoices
  where invoices.order_id = target_order_id
    and invoices.id <> created_invoice.id
    and coalesce(invoices.invoice_source, 'public_qr') = 'public_qr'
    and invoices.status::text = 'pending'
    and invoices.payment_status = 'pending'
  order by invoices.invoice_number, invoices.created_at
  limit 1
  for update;

  if canonical_invoice.id is null then return payload; end if;

  update public.order_items
  set invoice_id = canonical_invoice.id,
      kitchen_status = 'held'
  where order_id = target_order_id
    and invoice_id = created_invoice.id;

  update public.order_invoices
  set total_price = coalesce(total_price, 0) + coalesce(created_invoice.total_price, 0),
      updated_at = clock_timestamp()
  where id = canonical_invoice.id
  returning * into canonical_invoice;

  delete from public.order_invoices where id = created_invoice.id;

  return payload || jsonb_build_object(
    'invoice_id', canonical_invoice.id,
    'invoice_number', canonical_invoice.invoice_number,
    'invoice_status', canonical_invoice.status,
    'invoice_total', canonical_invoice.total_price
  );
end;
$$;

-- Each waiter submission remains its own attributable invoice batch while the
-- dining session is reused. The restaurant mode decides its kitchen release.
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
    target_restaurant_slug,
    table_number,
    customer_name,
    customer_phone,
    order_note,
    requested_items,
    client_request_id
  );

  select orders.* into target_order
  from public.orders orders
  where orders.id = nullif(payload->>'order_id', '')::uuid
  for update;

  select staff.* into acting_waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_order.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;

  if target_order.id is null or acting_waiter.id is null then
    raise exception 'Active waiter order session not found.';
  end if;

  select invoices.* into target_invoice
  from public.order_invoices invoices
  where invoices.id = nullif(payload->>'invoice_id', '')::uuid
    and invoices.order_id = target_order.id
    and invoices.restaurant_id = target_order.restaurant_id
  for update;

  if target_invoice.id is null then
    raise exception 'Waiter order batch invoice was not created.';
  end if;

  perform public.stamp_invoice_ownership(
    target_invoice.id,
    'waiter',
    acting_waiter.id,
    acting_waiter.display_name
  );

  resolved_timing := public.resolve_order_payment_timing(
    target_order.restaurant_id,
    'waiter'
  );

  if resolved_timing = 'after_meal' then
    -- Once a waiter adds to a shared table session, the session follows the
    -- restaurant waiter workflow. Invoice source still preserves QR history.
    update public.orders
    set order_source = 'waiter',
        created_by_waiter_id = coalesce(created_by_waiter_id, acting_waiter.id),
        payment_timing = 'after_meal',
        updated_at = clock_timestamp()
    where id = target_order.id;

    update public.order_invoices
    set payment_status = 'held',
        updated_at = clock_timestamp()
    where id = target_invoice.id;

    update public.order_items
    set kitchen_status = 'accepted'
    where order_id = target_order.id
      and invoice_id = target_invoice.id;
  else
    update public.order_invoices
    set payment_status = 'pending',
        updated_at = clock_timestamp()
    where id = target_invoice.id;

    update public.order_items
    set kitchen_status = 'held'
    where order_id = target_order.id
      and invoice_id = target_invoice.id;
  end if;

  payload := payload || jsonb_build_object(
    'invoice_id', target_invoice.id,
    'invoice_source', 'waiter',
    'invoice_creator_name', acting_waiter.display_name,
    'created_by_staff_id', acting_waiter.id,
    'payment_timing', resolved_timing
  );

  update public.waiter_batch_requests
  set response = payload,
      waiter_staff_id = acting_waiter.id
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

-- Defense in depth for every present and future kitchen write path.
create or replace function public.enforce_official_waiter_kitchen_release()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  released boolean;
begin
  if new.kitchen_status = 'held' then return new; end if;

  select
    invoices.payment_status = 'paid'
    or (
      invoices.payment_status = 'held'
      and invoices.invoice_source = 'waiter'
      and restaurants.payment_policy = 'kitchen_before_payment'
    )
  into released
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  join public.restaurants restaurants
    on restaurants.id = invoices.restaurant_id
  where invoices.id = new.invoice_id
    and invoices.order_id = new.order_id
    and invoices.restaurant_id = new.restaurant_id;

  if not coalesce(released, false) then
    raise exception 'This order batch has not been released by the official waiter workflow.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_verified_invoice_kitchen_gate_trigger on public.order_items;
drop trigger if exists enforce_official_waiter_kitchen_release_trigger on public.order_items;
create trigger enforce_official_waiter_kitchen_release_trigger
before insert or update of kitchen_status, invoice_id, order_id
on public.order_items
for each row execute function public.enforce_official_waiter_kitchen_release();

-- Repair impossible active states without rewriting historical payments.
update public.order_items items
set kitchen_status = 'held'
from public.order_invoices invoices
join public.restaurants restaurants on restaurants.id = invoices.restaurant_id
where items.restaurant_id = invoices.restaurant_id
  and items.order_id = invoices.order_id
  and items.invoice_id = invoices.id
  and items.kitchen_status in ('accepted', 'preparing', 'ready')
  and invoices.payment_status <> 'paid'
  and not (
    invoices.payment_status = 'held'
    and invoices.invoice_source = 'waiter'
    and restaurants.payment_policy = 'kitchen_before_payment'
  );

-- One cashier action settles every currently due batch in the dining session.
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
  acting_staff public.restaurant_staff;
  invoice_row public.order_invoices;
  normalized_method text;
  settled_count integer := 0;
  settled_total numeric(12,2) := 0;
  first_invoice boolean := true;
begin
  if auth.uid() is null then raise exception 'Authentication is required to collect payment.'; end if;

  select * into target_session
  from public.orders orders
  where orders.id = target_dining_session_id
  for update;

  if target_session.id is null then raise exception 'Dining session not found.'; end if;
  if target_session.dining_session_status <> 'open' then raise exception 'Dining session is closed.'; end if;

  select * into acting_staff
  from public.restaurant_staff staff
  where staff.restaurant_id = target_session.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may collect dining-session payment.';
  end if;

  normalized_method := public.normalize_payment_method(selected_payment_method);
  if normalized_method is null or not public.payment_method_is_supported(normalized_method) then
    raise exception 'A supported payment method is required.';
  end if;

  for invoice_row in
    select invoices.*
    from public.order_invoices invoices
    where invoices.restaurant_id = target_session.restaurant_id
      and invoices.order_id = target_session.id
      and invoices.payment_status in ('pending', 'held')
      and invoices.status::text in ('pending', 'paid')
    order by invoices.invoice_number, invoices.created_at
    for update
  loop
    update public.order_invoices
    set payment_method = normalized_method,
        updated_at = clock_timestamp()
    where id = invoice_row.id;

    perform public.verify_order_payment(
      invoice_row.id,
      case when first_invoice then payment_reference_number else null end,
      case when first_invoice then payment_transaction_id else null end,
      case when first_invoice then payment_screenshot_url else null end,
      owner_duplicate_override and first_invoice
    );

    settled_count := settled_count + 1;
    settled_total := settled_total + coalesce(invoice_row.grand_total, invoice_row.total_price, 0);
    first_invoice := false;
  end loop;

  if settled_count = 0 then raise exception 'Dining session has no payment due.'; end if;
  if exists (
    select 1 from public.order_invoices invoices
    where invoices.restaurant_id = target_session.restaurant_id
      and invoices.order_id = target_session.id
      and invoices.payment_status in ('pending', 'held')
  ) then
    raise exception 'Dining-session payment did not settle every due batch.';
  end if;

  return jsonb_build_object(
    'dining_session_id', target_session.id,
    'restaurant_id', target_session.restaurant_id,
    'payment_status', 'paid',
    'payment_method', normalized_method,
    'settled_invoice_count', settled_count,
    'settled_total', settled_total,
    'collected_by', acting_staff.id,
    'collected_at', now()
  );
end;
$$;

revoke all on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) from public, anon;
grant execute on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) to authenticated, service_role;

comment on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) is 'Atomically collects the running bill for one restaurant-scoped dining session and settles all currently due order batches.';
