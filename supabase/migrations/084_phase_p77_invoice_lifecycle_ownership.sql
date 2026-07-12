-- ServeFlow Phase P7.7: invoice-owned creator and kitchen lifecycle.
-- Dining sessions remain UUID-based containers; every invoice owns source,
-- creator, payment status, and kitchen status independently.

alter table public.order_invoices
  add column if not exists invoice_source text,
  add column if not exists created_by_staff_id uuid,
  add column if not exists created_by_display_name text;

alter table public.order_invoices
  drop constraint if exists order_invoices_invoice_source_allowed,
  add constraint order_invoices_invoice_source_allowed
    check (invoice_source is null or invoice_source in ('public_qr', 'waiter', 'cashier', 'authenticated', 'unknown'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_invoices_created_by_staff_same_restaurant'
      and conrelid = 'public.order_invoices'::regclass
  ) then
    alter table public.order_invoices
      add constraint order_invoices_created_by_staff_same_restaurant
      foreign key (restaurant_id, created_by_staff_id)
      references public.restaurant_staff (restaurant_id, id)
      on delete set null (created_by_staff_id);
  end if;
end;
$$;

create index if not exists order_invoices_creator_idx
on public.order_invoices (restaurant_id, invoice_source, created_by_staff_id, created_at);

create or replace function public.default_invoice_ownership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.invoice_source := coalesce(new.invoice_source, 'unknown');
  new.created_by_display_name := coalesce(
    nullif(trim(new.created_by_display_name), ''),
    case
      when new.invoice_source = 'public_qr' then 'Customer QR'
      when new.invoice_source = 'cashier' then 'Cashier'
      when new.invoice_source = 'waiter' then 'Waiter'
      when new.invoice_source = 'authenticated' then 'Customer'
      else 'Unknown'
    end
  );
  return new;
end;
$$;

drop trigger if exists default_invoice_ownership_before_insert on public.order_invoices;
create trigger default_invoice_ownership_before_insert
before insert on public.order_invoices
for each row execute function public.default_invoice_ownership();

create or replace function public.invoice_kitchen_status(target_invoice_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  with target_invoice as (
    select id, restaurant_id, status
    from public.order_invoices
    where id = target_invoice_id
  ),
  item_statuses as (
    select items.kitchen_status
    from public.order_items items
    join target_invoice invoice
      on invoice.restaurant_id = items.restaurant_id
     and invoice.id = items.invoice_id
  )
  select case
    when not exists (select 1 from target_invoice) then 'unknown'
    when (select status from target_invoice) in ('pending', 'rejected') then 'waiting_payment'
    when not exists (select 1 from item_statuses) then 'waiting_kitchen'
    when bool_and(kitchen_status = 'held') then 'waiting_payment'
    when bool_and(kitchen_status = 'completed') then 'completed'
    when bool_and(kitchen_status in ('ready', 'completed')) then 'ready'
    when bool_or(kitchen_status = 'preparing') then 'preparing'
    when bool_or(kitchen_status in ('paid', 'ready', 'completed')) then 'waiting_kitchen'
    else 'waiting_kitchen'
  end
  from item_statuses
  right join target_invoice on true
  group by target_invoice.status
$$;

create or replace function public.stamp_invoice_ownership(
  target_invoice_id uuid,
  target_invoice_source text,
  target_staff_id uuid default null,
  target_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_invoice public.order_invoices;
  source_value text := nullif(trim(coalesce(target_invoice_source, '')), '');
  staff_row public.restaurant_staff;
  display_value text := nullif(trim(coalesce(target_display_name, '')), '');
begin
  if target_invoice_id is null then
    return;
  end if;

  select *
  into target_invoice
  from public.order_invoices
  where id = target_invoice_id
  for update;

  if target_invoice.id is null then
    return;
  end if;

  if source_value not in ('public_qr', 'waiter', 'cashier', 'authenticated', 'unknown') then
    source_value := 'unknown';
  end if;

  if target_staff_id is not null then
    select *
    into staff_row
    from public.restaurant_staff
    where restaurant_id = target_invoice.restaurant_id
      and id = target_staff_id
      and active = true
    limit 1;

    if staff_row.id is null then
      target_staff_id := null;
    else
      display_value := coalesce(display_value, nullif(trim(staff_row.display_name), ''), nullif(trim(staff_row.username), ''), nullif(trim(staff_row.email), ''));
    end if;
  end if;

  if display_value is null then
    display_value := case
      when source_value = 'public_qr' then 'Customer QR'
      when source_value = 'cashier' then 'Cashier'
      when source_value = 'waiter' then 'Waiter'
      when source_value = 'authenticated' then 'Customer'
      else 'Unknown'
    end;
  end if;

  update public.order_invoices
  set invoice_source = source_value,
      created_by_staff_id = target_staff_id,
      created_by_display_name = left(display_value, 120),
      updated_at = now()
  where id = target_invoice.id
    and restaurant_id = target_invoice.restaurant_id;
end;
$$;

update public.order_invoices invoices
set invoice_source = coalesce(invoices.invoice_source, orders.order_source, 'unknown'),
    created_by_staff_id = coalesce(invoices.created_by_staff_id, orders.created_by_waiter_id),
    created_by_display_name = coalesce(
      invoices.created_by_display_name,
      staff.display_name,
      case
        when coalesce(orders.order_source, 'unknown') = 'public_qr' then 'Customer QR'
        when coalesce(orders.order_source, 'unknown') = 'cashier' then 'Cashier'
        when coalesce(orders.order_source, 'unknown') = 'waiter' then 'Waiter'
        else 'Unknown'
      end
    ),
    updated_at = now()
from public.orders orders
left join public.restaurant_staff staff
  on staff.restaurant_id = orders.restaurant_id
 and staff.id = orders.created_by_waiter_id
where invoices.restaurant_id = orders.restaurant_id
  and invoices.order_id = orders.id
  and (
    invoices.invoice_source is null
    or invoices.created_by_display_name is null
  );

alter function public.create_public_qr_order(text, text, text, text, text, text, jsonb)
rename to create_public_qr_order_p77_base;

create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  browser_session_token text,
  customer_name text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  payload := public.create_public_qr_order_p77_base(
    target_restaurant_slug,
    table_number,
    qr_token,
    browser_session_token,
    customer_name,
    selected_payment_method,
    requested_items
  );

  if payload ? 'invoice_id' then
    perform public.stamp_invoice_ownership((payload->>'invoice_id')::uuid, 'public_qr', null, 'Customer QR');
  end if;

  return public.enrich_business_number_payload(payload);
end;
$$;

create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  customer_name text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.create_public_qr_order(target_restaurant_slug, table_number, qr_token, null::text, customer_name, selected_payment_method, requested_items)
$$;

alter function public.create_waiter_order(text, text, text, text, text, jsonb)
rename to create_waiter_order_p77_base;

create or replace function public.create_waiter_order(
  target_restaurant_slug text,
  table_number text,
  customer_name text,
  customer_phone text,
  order_note text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  target_invoice public.order_invoices;
  acting_waiter public.restaurant_staff;
begin
  payload := public.create_waiter_order_p77_base(target_restaurant_slug, table_number, customer_name, customer_phone, order_note, requested_items);

  if payload ? 'invoice_id' then
    select *
    into target_invoice
    from public.order_invoices
    where id = (payload->>'invoice_id')::uuid;

    select *
    into acting_waiter
    from public.restaurant_staff
    where restaurant_id = target_invoice.restaurant_id
      and user_id = auth.uid()
      and role::text = 'waiter'
      and active = true
    limit 1;

    perform public.stamp_invoice_ownership(
      target_invoice.id,
      'waiter',
      acting_waiter.id,
      acting_waiter.display_name
    );
  end if;

  return public.enrich_business_number_payload(payload);
end;
$$;

alter function public.create_cashier_order(uuid, text, text, jsonb)
rename to create_cashier_order_p77_base;

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
  payload jsonb;
  acting_staff public.restaurant_staff;
begin
  payload := public.create_cashier_order_p77_base(target_restaurant_id, table_number, selected_payment_method, requested_items);

  select *
  into acting_staff
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and active = true
    and role::text in ('cashier', 'owner')
  limit 1;

  if payload ? 'invoice_id' then
    perform public.stamp_invoice_ownership((payload->>'invoice_id')::uuid, 'cashier', acting_staff.id, acting_staff.display_name);
  end if;

  return public.enrich_business_number_payload(payload);
end;
$$;

alter function public.append_items_to_order(uuid, jsonb)
rename to append_items_to_order_p77_base;

create or replace function public.append_items_to_order(
  target_order_id uuid,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  target_invoice public.order_invoices;
  acting_staff public.restaurant_staff;
begin
  payload := public.append_items_to_order_p77_base(target_order_id, requested_items);

  if payload ? 'invoice_id' then
    select *
    into target_invoice
    from public.order_invoices
    where id = (payload->>'invoice_id')::uuid;

    select *
    into acting_staff
    from public.restaurant_staff
    where restaurant_id = target_invoice.restaurant_id
      and user_id = auth.uid()
      and active = true
      and role::text in ('cashier', 'owner')
    limit 1;

    perform public.stamp_invoice_ownership(target_invoice.id, 'cashier', acting_staff.id, acting_staff.display_name);
  end if;

  return public.enrich_business_number_payload(payload);
end;
$$;

drop function if exists public.get_cashier_invoice_queue(uuid);
create function public.get_cashier_invoice_queue(target_restaurant_id uuid)
returns table (
  invoice_id uuid,
  invoice_number integer,
  invoice_display_number text,
  kitchen_ticket_number text,
  invoice_source text,
  invoice_creator_name text,
  invoice_kitchen_status text,
  invoice_status text,
  invoice_paid_at timestamptz,
  invoice_locked_at timestamptz,
  invoice_verified_at timestamptz,
  invoice_verified_by uuid,
  invoice_verified_by_name text,
  invoice_rejected_at timestamptz,
  invoice_rejection_reason text,
  invoice_retry_requested_at timestamptz,
  reference_number text,
  transaction_id text,
  screenshot_url text,
  dining_session_id uuid,
  dining_session_display_number text,
  dining_session_status text,
  order_batch_id uuid,
  id uuid,
  display_number text,
  status text,
  customer_name text,
  customer_phone text,
  table_number text,
  order_source text,
  waiter_name text,
  order_note text,
  payment_method text,
  total_price numeric,
  order_total_price numeric,
  created_at timestamptz,
  payment_verified_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  recent_cutoff timestamptz := now() - interval '36 hours';
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view cashier payments.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may view payment queue.';
  end if;

  return query
  select
    invoices.id as invoice_id,
    invoices.invoice_number,
    invoices.display_number as invoice_display_number,
    invoices.kitchen_ticket_number,
    coalesce(invoices.invoice_source, orders.order_source, 'unknown') as invoice_source,
    coalesce(creator.display_name, invoices.created_by_display_name, case
      when coalesce(invoices.invoice_source, orders.order_source) = 'public_qr' then 'Customer QR'
      when coalesce(invoices.invoice_source, orders.order_source) = 'cashier' then 'Cashier'
      when coalesce(invoices.invoice_source, orders.order_source) = 'waiter' then 'Waiter'
      else 'Unknown'
    end) as invoice_creator_name,
    public.invoice_kitchen_status(invoices.id) as invoice_kitchen_status,
    case
      when invoices.status = 'verified' or (invoices.status = 'paid' and invoices.verified_at is not null) then 'verified'
      else invoices.status
    end as invoice_status,
    invoices.paid_at as invoice_paid_at,
    invoices.locked_at as invoice_locked_at,
    invoices.verified_at as invoice_verified_at,
    invoices.verified_by as invoice_verified_by,
    verifier.display_name as invoice_verified_by_name,
    invoices.rejected_at as invoice_rejected_at,
    invoices.rejection_reason as invoice_rejection_reason,
    invoices.retry_requested_at as invoice_retry_requested_at,
    invoices.reference_number,
    invoices.transaction_id,
    invoices.screenshot_url,
    orders.id as dining_session_id,
    orders.dining_session_display_number,
    orders.dining_session_status::text as dining_session_status,
    invoices.id as order_batch_id,
    orders.id,
    orders.display_number,
    orders.status::text as status,
    orders.customer_name,
    orders.customer_phone,
    orders.table_number,
    coalesce(invoices.invoice_source, orders.order_source, 'unknown') as order_source,
    coalesce(creator.display_name, invoices.created_by_display_name) as waiter_name,
    orders.order_note,
    coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(orders.payment_method)) as payment_method,
    invoices.total_price,
    orders.total_price as order_total_price,
    invoices.created_at,
    invoices.verified_at as payment_verified_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', items.id,
          'order_id', items.order_id,
          'invoice_id', items.invoice_id,
          'quantity', items.quantity,
          'price', items.price,
          'notes', items.notes,
          'appended_at', items.appended_at,
          'kitchen_status', items.kitchen_status,
          'menu_item_name', menu_items.name
        )
        order by items.created_at, items.id
      ) filter (where items.id is not null),
      '[]'::jsonb
    ) as items
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  left join public.restaurant_staff creator
    on creator.restaurant_id = invoices.restaurant_id
   and creator.id = invoices.created_by_staff_id
  left join public.restaurant_staff verifier
    on verifier.restaurant_id = invoices.restaurant_id
   and verifier.id = invoices.verified_by
  left join public.order_items items
    on items.restaurant_id = invoices.restaurant_id
   and items.invoice_id = invoices.id
  left join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  where invoices.restaurant_id = target_restaurant_id
    and orders.status::text <> 'cancelled'
    and (
      invoices.status in ('pending', 'rejected')
      or orders.status::text in ('pending', 'pending_payment', 'paid', 'preparing', 'ready')
      or orders.dining_session_status = 'open'
      or invoices.created_at >= recent_cutoff
      or invoices.verified_at >= recent_cutoff
    )
  group by invoices.id, orders.id, creator.display_name, verifier.display_name
  order by
    case when invoices.status in ('pending', 'rejected') then 0 else 1 end,
    invoices.created_at desc;
end;
$$;

revoke all on function public.invoice_kitchen_status(uuid) from public, anon, authenticated;
revoke all on function public.stamp_invoice_ownership(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.default_invoice_ownership() from public, anon, authenticated;
revoke all on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) from public;
revoke all on function public.create_public_qr_order(text, text, text, text, text, jsonb) from public;
revoke all on function public.create_waiter_order(text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.create_cashier_order(uuid, text, text, jsonb) from public, anon;
revoke all on function public.append_items_to_order(uuid, jsonb) from public, anon;
revoke all on function public.get_cashier_invoice_queue(uuid) from public, anon;

grant execute on function public.invoice_kitchen_status(uuid) to authenticated, service_role;
grant execute on function public.stamp_invoice_ownership(uuid, text, uuid, text) to service_role;
grant execute on function public.default_invoice_ownership() to service_role;
grant execute on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.create_public_qr_order(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.create_waiter_order(text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.create_cashier_order(uuid, text, text, jsonb) to authenticated;
grant execute on function public.append_items_to_order(uuid, jsonb) to authenticated;
grant execute on function public.get_cashier_invoice_queue(uuid) to authenticated;
