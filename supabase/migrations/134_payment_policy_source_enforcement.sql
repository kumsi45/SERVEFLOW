-- Preserve the restaurant payment policy while making its source-specific
-- behavior explicit and impossible for QR callers to override.

alter table public.restaurants
  add column if not exists mixed_waiter_payment_timing text not null default 'after_meal';

alter table public.restaurants
  drop constraint if exists restaurants_mixed_waiter_payment_timing_allowed,
  add constraint restaurants_mixed_waiter_payment_timing_allowed
    check (mixed_waiter_payment_timing in ('before_kitchen', 'after_meal'));

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
    -- QR is a permanent system-level pay-before-kitchen rule.
    when coalesce(target_order_source, '') = 'public_qr' then 'before_kitchen'
    when restaurants.payment_policy = 'hold_payment' then 'after_meal'
    when restaurants.payment_policy = 'mixed'
      then restaurants.mixed_waiter_payment_timing
    else 'before_kitchen'
  end
  from public.restaurants
  where restaurants.id = target_restaurant_id
$$;

create or replace function public.sync_normalized_order_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolved_timing text;
begin
  resolved_timing := public.resolve_order_payment_timing(
    new.restaurant_id,
    new.order_source
  );

  if resolved_timing is null then
    raise exception 'Restaurant payment policy could not be resolved.';
  end if;

  -- Timing is derived by the database, never trusted from a client payload.
  if tg_op = 'INSERT'
     or new.restaurant_id is distinct from old.restaurant_id
     or new.order_source is distinct from old.order_source then
    new.payment_timing := resolved_timing;
  elsif new.payment_timing is distinct from old.payment_timing
        and new.payment_timing is distinct from resolved_timing then
    raise exception 'Order payment timing is controlled by restaurant policy.';
  end if;

  if new.order_source = 'public_qr' and new.payment_timing <> 'before_kitchen' then
    raise exception 'QR customer orders must be paid before kitchen release.';
  end if;

  if new.payment_timing = 'after_meal'
     and (tg_op = 'INSERT'
       or new.payment_timing is distinct from old.payment_timing
       or new.order_source is distinct from old.order_source
       or new.created_by_waiter_id is distinct from old.created_by_waiter_id) then
    if new.order_source <> 'waiter'
       or new.created_by_waiter_id is null
       or not exists (
         select 1
         from public.restaurant_staff staff
         where staff.id = new.created_by_waiter_id
           and staff.restaurant_id = new.restaurant_id
           and staff.role::text = 'waiter'
           and staff.active
           and staff.user_id = auth.uid()
       ) then
      raise exception 'Deferred payment is available only to authenticated waiter orders.';
    end if;
  end if;

  if new.dining_session_status::text in ('closed', 'expired')
     or new.table_released_at is not null then
    new.operational_status := 'closed';
  elsif new.status::text = 'completed' then
    new.operational_status := 'served';
  elsif new.status::text = 'ready' then
    new.operational_status := 'ready';
  elsif new.status::text = 'preparing' then
    new.operational_status := 'preparing';
  elsif new.status::text = 'paid' and new.operational_status = 'new' then
    new.operational_status := 'accepted';
  end if;
  return new;
end;
$$;

-- The trigger must also run when source/creator fields are changed.
drop trigger if exists sync_normalized_order_lifecycle_trigger on public.orders;
create trigger sync_normalized_order_lifecycle_trigger
before insert or update of status, dining_session_status, table_released_at,
  payment_timing, order_source, restaurant_id, created_by_waiter_id
on public.orders
for each row execute function public.sync_normalized_order_lifecycle();

-- A final item-level guard protects every kitchen write path, including future
-- RPCs: QR invoices can leave held only after successful payment.
create or replace function public.enforce_verified_invoice_kitchen_gate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  allowed boolean;
begin
  if new.kitchen_status = 'held' then return new; end if;

  select case
    when orders.order_source = 'public_qr'
      then invoices.payment_status = 'paid'
    when orders.payment_timing = 'after_meal'
      then invoices.payment_status in ('held', 'paid')
         and orders.order_source = 'waiter'
         and orders.created_by_waiter_id is not null
    else invoices.payment_status = 'paid'
  end
  into allowed
  from public.order_invoices invoices
  join public.orders orders
    on orders.id = invoices.order_id
   and orders.restaurant_id = invoices.restaurant_id
  where invoices.id = new.invoice_id
    and invoices.restaurant_id = new.restaurant_id;

  if not coalesce(allowed, false) then
    raise exception 'Kitchen release requires successful payment or an authenticated waiter payment hold.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_verified_invoice_kitchen_gate_trigger on public.order_items;
create trigger enforce_verified_invoice_kitchen_gate_trigger
before insert or update of kitchen_status, invoice_id, order_id
on public.order_items
for each row execute function public.enforce_verified_invoice_kitchen_gate();

create or replace function public.set_mixed_waiter_payment_timing(
  target_restaurant_id uuid,
  requested_timing text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if requested_timing not in ('before_kitchen', 'after_meal') then
    raise exception 'Invalid waiter payment timing.';
  end if;
  if not public.has_staff_role(
    target_restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  ) then
    raise exception 'Only the restaurant owner may change waiter payment timing.';
  end if;
  update public.restaurants
  set mixed_waiter_payment_timing = requested_timing
  where id = target_restaurant_id;
  if not found then raise exception 'Restaurant not found.'; end if;
  return requested_timing;
end;
$$;

revoke all on function public.resolve_order_payment_timing(uuid, text) from public, anon;
grant execute on function public.resolve_order_payment_timing(uuid, text) to authenticated, service_role;
revoke all on function public.set_mixed_waiter_payment_timing(uuid, text) from public, anon;
grant execute on function public.set_mixed_waiter_payment_timing(uuid, text) to authenticated;

-- Keep the operational state on the invoice audit record as well as the order.
alter table public.order_invoices
  add column if not exists operational_status text not null default 'new';
alter table public.order_invoices
  drop constraint if exists order_invoices_operational_status_allowed,
  add constraint order_invoices_operational_status_allowed
    check (operational_status in ('new','accepted','preparing','ready','served','closed'));

update public.order_invoices invoices
set operational_status = orders.operational_status
from public.orders orders
where orders.id = invoices.order_id
  and orders.restaurant_id = invoices.restaurant_id;

create or replace function public.sync_invoice_operational_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'orders' then
    update public.order_invoices
    set operational_status = new.operational_status
    where restaurant_id = new.restaurant_id and order_id = new.id;
    return new;
  end if;
  select orders.operational_status into new.operational_status
  from public.orders orders
  where orders.id = new.order_id and orders.restaurant_id = new.restaurant_id;
  return new;
end;
$$;

drop trigger if exists stamp_invoice_operational_status_trigger on public.order_invoices;
create trigger stamp_invoice_operational_status_trigger
before insert or update of order_id, restaurant_id on public.order_invoices
for each row execute function public.sync_invoice_operational_status();
drop trigger if exists propagate_invoice_operational_status_trigger on public.orders;
create trigger propagate_invoice_operational_status_trigger
after update of operational_status on public.orders
for each row execute function public.sync_invoice_operational_status();

create or replace view public.invoice_payment_audit
with (security_invoker = true)
as
select
  invoices.id as invoice_id,
  invoices.restaurant_id,
  invoices.order_id,
  coalesce(creator.display_name, invoices.created_by_display_name,
    case when invoices.invoice_source = 'public_qr' then 'QR Customer' end) as created_by,
  collector.display_name as collected_by,
  coalesce(invoices.verified_at, invoices.paid_at) as payment_time,
  public.normalize_payment_method(invoices.payment_method) as payment_method,
  invoices.operational_status,
  invoices.payment_status,
  invoices.created_at
from public.order_invoices invoices
left join public.restaurant_staff creator
  on creator.restaurant_id = invoices.restaurant_id
 and creator.id = invoices.created_by_staff_id
left join public.restaurant_staff collector
  on collector.restaurant_id = invoices.restaurant_id
 and collector.id = coalesce(invoices.verified_by, invoices.paid_by);

revoke all on public.invoice_payment_audit from public, anon;
grant select on public.invoice_payment_audit to authenticated, service_role;
