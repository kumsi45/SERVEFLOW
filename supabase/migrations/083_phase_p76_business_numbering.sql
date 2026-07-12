-- ServeFlow Phase P7.6: human-friendly business numbering.
-- UUIDs remain the only internal primary/foreign/realtime identifiers.

alter table public.restaurants
  add column if not exists business_prefix text;

alter table public.restaurants
  drop constraint if exists restaurants_business_prefix_format,
  add constraint restaurants_business_prefix_format
    check (business_prefix is null or business_prefix ~ '^[A-Z]{2,4}$');

create unique index if not exists restaurants_business_prefix_unique_idx
on public.restaurants (business_prefix)
where business_prefix is not null;

create table if not exists public.restaurant_business_number_counters (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  counter_type text not null check (counter_type in ('order', 'dining_session', 'invoice', 'kitchen_ticket', 'bill')),
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, counter_type)
);

alter table public.restaurant_business_number_counters enable row level security;
revoke all on public.restaurant_business_number_counters from public, anon, authenticated;
grant select, insert, update on public.restaurant_business_number_counters to service_role;

alter table public.orders
  add column if not exists display_number text,
  add column if not exists dining_session_display_number text;

alter table public.order_invoices
  add column if not exists display_number text,
  add column if not exists kitchen_ticket_number text;

alter table public.dining_session_bills
  add column if not exists display_number text;

create unique index if not exists orders_display_number_unique_idx
on public.orders (restaurant_id, display_number)
where display_number is not null;

create unique index if not exists orders_dining_session_display_number_unique_idx
on public.orders (restaurant_id, dining_session_display_number)
where dining_session_display_number is not null;

create unique index if not exists order_invoices_display_number_unique_idx
on public.order_invoices (restaurant_id, display_number)
where display_number is not null;

create unique index if not exists order_invoices_kitchen_ticket_number_unique_idx
on public.order_invoices (restaurant_id, kitchen_ticket_number)
where kitchen_ticket_number is not null;

create unique index if not exists dining_session_bills_display_number_unique_idx
on public.dining_session_bills (restaurant_id, display_number)
where display_number is not null;

create or replace function public.derive_business_prefix(restaurant_name text, restaurant_slug text, fallback_id uuid)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned_name text := upper(regexp_replace(coalesce(nullif(trim(restaurant_name), ''), nullif(trim(restaurant_slug), ''), 'SF'), '[^A-Za-z ]', ' ', 'g'));
  words text[];
  candidate text := '';
begin
  words := regexp_split_to_array(regexp_replace(cleaned_name, '\s+', ' ', 'g'), ' ');

  if array_length(words, 1) >= 2 then
    candidate := left(words[1], 1) || left(words[2], 1);
  else
    candidate := left(regexp_replace(cleaned_name, '[^A-Z]', '', 'g'), 2);
  end if;

  if length(candidate) < 2 then
    candidate := 'SF';
  end if;

  return left(candidate || 'SF', 4);
end;
$$;

create or replace function public.ensure_restaurant_business_prefix(target_restaurant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  base_prefix text;
  candidate_prefix text;
  suffix integer := 0;
begin
  select *
  into target_restaurant
  from public.restaurants
  where id = target_restaurant_id
  for update;

  if target_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  if target_restaurant.business_prefix ~ '^[A-Z]{2,4}$' then
    return target_restaurant.business_prefix;
  end if;

  base_prefix := public.derive_business_prefix(target_restaurant.name, target_restaurant.slug, target_restaurant.id);

  loop
    candidate_prefix := case
      when suffix = 0 then left(base_prefix, 4)
      when suffix <= 26 then left(base_prefix, 3) || chr(64 + suffix)
      else left(base_prefix, 2) || chr(65 + ((suffix - 27) / 26)::integer) || chr(65 + ((suffix - 27) % 26))
    end;
    candidate_prefix := upper(regexp_replace(candidate_prefix, '[^A-Z]', '', 'g'));
    if candidate_prefix !~ '^[A-Z]{2,4}$' then
      candidate_prefix := left(base_prefix, 2) || chr(65 + (suffix % 26));
    end if;

    begin
      update public.restaurants
      set business_prefix = candidate_prefix
      where id = target_restaurant.id
        and (business_prefix is null or business_prefix !~ '^[A-Z]{2,4}$');
      return candidate_prefix;
    exception when unique_violation then
      suffix := suffix + 1;
      if suffix > 675 then
        raise exception 'Could not create a unique business prefix for this restaurant.';
      end if;
    end;
  end loop;
end;
$$;

create or replace function public.next_business_number(
  target_restaurant_id uuid,
  target_counter_type text,
  target_token text,
  target_pad integer default 6
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  business_prefix text;
  next_number integer;
  normalized_token text := upper(coalesce(target_token, ''));
  pad_width integer := greatest(3, least(coalesce(target_pad, 6), 9));
begin
  if target_counter_type not in ('order', 'dining_session', 'invoice', 'kitchen_ticket', 'bill') then
    raise exception 'Unsupported business number counter.';
  end if;

  business_prefix := public.ensure_restaurant_business_prefix(target_restaurant_id);

  insert into public.restaurant_business_number_counters (restaurant_id, counter_type, last_number, updated_at)
  values (target_restaurant_id, target_counter_type, 1, now())
  on conflict (restaurant_id, counter_type) do update
    set last_number = public.restaurant_business_number_counters.last_number + 1,
        updated_at = now()
  returning last_number into next_number;

  return business_prefix || case when normalized_token = '' then '-' else '-' || normalized_token end || lpad(next_number::text, pad_width, '0');
end;
$$;

create or replace function public.assign_order_business_numbers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.display_number is null then
    new.display_number := public.next_business_number(new.restaurant_id, 'order', '', 6);
  end if;

  if new.dining_session_display_number is null then
    new.dining_session_display_number := public.next_business_number(new.restaurant_id, 'dining_session', 'DS', 3);
  end if;

  return new;
end;
$$;

drop trigger if exists assign_order_business_numbers_before_insert on public.orders;
create trigger assign_order_business_numbers_before_insert
before insert on public.orders
for each row execute function public.assign_order_business_numbers();

create or replace function public.assign_invoice_business_numbers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.display_number is null then
    new.display_number := public.next_business_number(new.restaurant_id, 'invoice', 'INV', 3);
  end if;

  if new.kitchen_ticket_number is null then
    new.kitchen_ticket_number := public.next_business_number(new.restaurant_id, 'kitchen_ticket', 'K', 3);
  end if;

  return new;
end;
$$;

drop trigger if exists assign_invoice_business_numbers_before_insert on public.order_invoices;
create trigger assign_invoice_business_numbers_before_insert
before insert on public.order_invoices
for each row execute function public.assign_invoice_business_numbers();

create or replace function public.assign_bill_business_numbers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.display_number is null then
    new.display_number := public.next_business_number(new.restaurant_id, 'bill', 'B', 3);
  end if;

  if new.bill_number is null or new.bill_number !~ '^[A-Z]{2,4}-B[0-9]{3,}$' then
    new.bill_number := new.display_number;
  end if;

  return new;
end;
$$;

drop trigger if exists assign_bill_business_numbers_before_insert on public.dining_session_bills;
create trigger assign_bill_business_numbers_before_insert
before insert on public.dining_session_bills
for each row execute function public.assign_bill_business_numbers();

do $$
declare
  restaurant_row record;
  order_row record;
  invoice_row record;
  bill_row record;
begin
  for restaurant_row in select id from public.restaurants order by created_at, id loop
    perform public.ensure_restaurant_business_prefix(restaurant_row.id);

    for order_row in
      select id
      from public.orders
      where restaurant_id = restaurant_row.id
        and display_number is null
      order by created_at, id
    loop
      update public.orders
      set display_number = public.next_business_number(restaurant_row.id, 'order', '', 6)
      where id = order_row.id
        and display_number is null;
    end loop;

    for order_row in
      select id
      from public.orders
      where restaurant_id = restaurant_row.id
        and dining_session_display_number is null
      order by dining_session_opened_at, created_at, id
    loop
      update public.orders
      set dining_session_display_number = public.next_business_number(restaurant_row.id, 'dining_session', 'DS', 3)
      where id = order_row.id
        and dining_session_display_number is null;
    end loop;

    for invoice_row in
      select id
      from public.order_invoices
      where restaurant_id = restaurant_row.id
        and display_number is null
      order by created_at, id
    loop
      update public.order_invoices
      set display_number = public.next_business_number(restaurant_row.id, 'invoice', 'INV', 3)
      where id = invoice_row.id
        and display_number is null;
    end loop;

    for invoice_row in
      select id
      from public.order_invoices
      where restaurant_id = restaurant_row.id
        and kitchen_ticket_number is null
      order by created_at, id
    loop
      update public.order_invoices
      set kitchen_ticket_number = public.next_business_number(restaurant_row.id, 'kitchen_ticket', 'K', 3)
      where id = invoice_row.id
        and kitchen_ticket_number is null;
    end loop;

    for bill_row in
      select id
      from public.dining_session_bills
      where restaurant_id = restaurant_row.id
        and display_number is null
      order by created_at, id
    loop
      update public.dining_session_bills
      set display_number = public.next_business_number(restaurant_row.id, 'bill', 'B', 3)
      where id = bill_row.id
        and display_number is null;
    end loop;
  end loop;
end;
$$;

create or replace function public.enrich_business_number_payload(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  target_invoice public.order_invoices;
  enriched_invoices jsonb;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    return payload;
  end if;

  if payload ? 'order_id' and (payload->>'order_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select *
    into target_order
    from public.orders
    where id = (payload->>'order_id')::uuid;
  end if;

  if target_order.id is not null then
    payload := payload || jsonb_build_object(
      'display_number', target_order.display_number,
      'dining_session_display_number', target_order.dining_session_display_number
    );
  end if;

  if payload ? 'invoice_id' and (payload->>'invoice_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select *
    into target_invoice
    from public.order_invoices
    where id = (payload->>'invoice_id')::uuid;

    if target_invoice.id is not null then
      payload := payload || jsonb_build_object(
        'invoice_display_number', target_invoice.display_number,
        'kitchen_ticket_number', target_invoice.kitchen_ticket_number
      );
    end if;
  end if;

  if payload ? 'invoices' and jsonb_typeof(payload->'invoices') = 'array' then
    select coalesce(
      jsonb_agg(
        invoice_payload || jsonb_build_object(
          'display_number', invoices.display_number,
          'kitchen_ticket_number', invoices.kitchen_ticket_number
        )
        order by invoice_ordinality
      ),
      '[]'::jsonb
    )
    into enriched_invoices
    from jsonb_array_elements(payload->'invoices') with ordinality as source(invoice_payload, invoice_ordinality)
    left join public.order_invoices invoices
      on invoices.id = case
        when (invoice_payload->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (invoice_payload->>'id')::uuid
        else null
      end;

    payload := jsonb_set(payload, '{invoices}', enriched_invoices, true);
  end if;

  if payload ? 'active_invoice' and jsonb_typeof(payload->'active_invoice') = 'object' then
    select *
    into target_invoice
    from public.order_invoices
    where id = case
      when (payload->'active_invoice'->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (payload->'active_invoice'->>'id')::uuid
      else null
    end;

    if target_invoice.id is not null then
      payload := jsonb_set(
        payload,
        '{active_invoice}',
        (payload->'active_invoice') || jsonb_build_object(
          'display_number', target_invoice.display_number,
          'kitchen_ticket_number', target_invoice.kitchen_ticket_number
        ),
        true
      );
    end if;
  end if;

  return payload;
end;
$$;

alter function public.get_public_qr_order_session(text, text, text, text)
rename to get_public_qr_order_session_p76_base;

create or replace function public.get_public_qr_order_session(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  browser_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.enrich_business_number_payload(
    public.get_public_qr_order_session_p76_base(target_restaurant_slug, table_number, qr_token, browser_session_token)
  );
end;
$$;

create or replace function public.get_public_qr_order_session(
  target_restaurant_slug text,
  table_number text,
  qr_token text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.get_public_qr_order_session(target_restaurant_slug, table_number, qr_token, null::text)
$$;

alter function public.create_public_qr_order(text, text, text, text, text, text, jsonb)
rename to create_public_qr_order_p76_base;

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
begin
  return public.enrich_business_number_payload(
    public.create_public_qr_order_p76_base(target_restaurant_slug, table_number, qr_token, browser_session_token, customer_name, selected_payment_method, requested_items)
  );
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

alter function public.get_waiter_order_session(text, text)
rename to get_waiter_order_session_p76_base;

create or replace function public.get_waiter_order_session(
  target_restaurant_slug text,
  table_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.enrich_business_number_payload(
    public.get_waiter_order_session_p76_base(target_restaurant_slug, table_number)
  );
end;
$$;

alter function public.create_waiter_order(text, text, text, text, text, jsonb)
rename to create_waiter_order_p76_base;

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
begin
  return public.enrich_business_number_payload(
    public.create_waiter_order_p76_base(target_restaurant_slug, table_number, customer_name, customer_phone, order_note, requested_items)
  );
end;
$$;

drop function if exists public.get_cashier_invoice_queue(uuid);
create function public.get_cashier_invoice_queue(target_restaurant_id uuid)
returns table (
  invoice_id uuid,
  invoice_number integer,
  invoice_display_number text,
  kitchen_ticket_number text,
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
    orders.order_source,
    waiter_staff.display_name as waiter_name,
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
  left join public.restaurant_staff waiter_staff
    on waiter_staff.restaurant_id = orders.restaurant_id
   and waiter_staff.id = orders.created_by_waiter_id
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
  group by invoices.id, orders.id, waiter_staff.display_name, verifier.display_name
  order by
    case when invoices.status in ('pending', 'rejected') then 0 else 1 end,
    invoices.created_at desc;
end;
$$;

drop function if exists public.get_station_kitchen_orders(uuid, uuid, boolean, boolean);
create function public.get_station_kitchen_orders(
  target_restaurant_id uuid,
  target_station_id uuid default null,
  include_all_stations boolean default false,
  log_queue_view boolean default false
)
returns table (
  id uuid,
  display_number text,
  kitchen_ticket_number text,
  kitchen_batch_key text,
  status text,
  customer_name text,
  table_number text,
  payment_method text,
  total_price numeric,
  created_at timestamptz,
  payment_verified_at timestamptz,
  preparation_started_at timestamptz,
  ready_marked_at timestamptz,
  items jsonb,
  station_progress jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  effective_station_id uuid;
  selected_station public.kitchen_stations;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view kitchen orders.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role in ('kitchen', 'owner')
    and active = true
  order by created_at asc
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active kitchen staff and owners may view kitchen orders.';
  end if;

  if acting_staff.role = 'kitchen' then
    if acting_staff.assigned_kitchen_station_id is null then
      update public.restaurant_staff
      set assigned_kitchen_station_id = public.ensure_main_kitchen_station_for_restaurant(target_restaurant_id)
      where id = acting_staff.id
        and restaurant_id = acting_staff.restaurant_id
        and assigned_kitchen_station_id is null
      returning * into acting_staff;
    end if;

    effective_station_id := acting_staff.assigned_kitchen_station_id;
  elsif include_all_stations then
    effective_station_id := null;
  elsif target_station_id is not null then
    select *
    into selected_station
    from public.kitchen_stations
    where kitchen_stations.id = target_station_id
      and kitchen_stations.restaurant_id = target_restaurant_id
      and kitchen_stations.archived_at is null;

    if selected_station.id is null then
      raise exception 'Kitchen station not found.';
    end if;

    effective_station_id := target_station_id;
  else
    effective_station_id := null;
  end if;

  if log_queue_view then
    perform public.log_staff_activity(
      target_restaurant_id,
      acting_staff.id,
      'kitchen_station_queue_viewed',
      null,
      jsonb_build_object(
        'mode', case when acting_staff.role = 'owner' and effective_station_id is null then 'all_stations' else 'station' end,
        'station_id', effective_station_id,
        'role', acting_staff.role::text
      )
    );
  end if;

  return query
  with active_batches as (
    select
      orders.id as order_id,
      items.invoice_id,
      items.kitchen_station_id,
      case
        when items.appended_at is null then null
        else ((extract(epoch from items.appended_at) * 1000000)::bigint)::text
      end as kitchen_batch_key
    from public.orders orders
    join public.order_items items
      on items.restaurant_id = orders.restaurant_id
     and items.order_id = orders.id
    where orders.restaurant_id = target_restaurant_id
      and orders.status::text in ('paid', 'preparing', 'ready')
      and items.kitchen_status in ('paid', 'preparing', 'ready')
      and items.kitchen_station_id is not null
      and (effective_station_id is null or items.kitchen_station_id = effective_station_id)
    group by orders.id, items.invoice_id, items.kitchen_station_id, items.appended_at
  )
  select
    orders.id,
    orders.display_number,
    invoices.kitchen_ticket_number,
    batches.kitchen_batch_key,
    case
      when count(*) filter (where items.kitchen_status = 'paid') = count(*) then 'paid'
      when count(*) filter (where items.kitchen_status = 'ready') = count(*) then 'ready'
      else 'preparing'
    end as status,
    orders.customer_name,
    orders.table_number,
    orders.payment_method,
    coalesce(sum(items.price * items.quantity), 0)::numeric as total_price,
    orders.created_at,
    orders.payment_verified_at,
    coalesce(min(items.kitchen_preparation_started_at), orders.preparation_started_at) as preparation_started_at,
    coalesce(max(items.kitchen_ready_marked_at), orders.ready_marked_at) as ready_marked_at,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', items.id,
        'order_id', items.order_id,
        'quantity', items.quantity,
        'price', items.price,
        'notes', items.notes,
        'appended_at', items.appended_at,
        'kitchen_station_id', items.kitchen_station_id,
        'kitchen_station_name', stations.name,
        'kitchen_status', items.kitchen_status,
        'menu_item_name', menu_items.name
      )
      order by items.created_at asc, items.id asc
    ), '[]'::jsonb) as items,
    jsonb_build_array(
      jsonb_build_object(
        'station_id', batches.kitchen_station_id,
        'station_name', max(stations.name),
        'station_status', case
          when count(*) filter (where items.kitchen_status = 'paid') = count(*) then 'waiting'
          when count(*) filter (where items.kitchen_status = 'ready') = count(*) then 'ready'
          else 'preparing'
        end,
        'item_count', count(*)::integer,
        'ready_count', count(*) filter (where items.kitchen_status = 'ready')::integer,
        'completed_count', 0,
        'started_at', min(items.kitchen_preparation_started_at),
        'ready_at', max(items.kitchen_ready_marked_at),
        'completed_at', null
      )
    ) as station_progress
  from active_batches batches
  join public.orders orders
    on orders.id = batches.order_id
   and orders.restaurant_id = target_restaurant_id
  left join public.order_invoices invoices
    on invoices.restaurant_id = orders.restaurant_id
   and invoices.id = batches.invoice_id
  join public.order_items items
    on items.restaurant_id = orders.restaurant_id
   and items.order_id = orders.id
   and items.invoice_id = batches.invoice_id
   and items.kitchen_station_id = batches.kitchen_station_id
   and (
     (batches.kitchen_batch_key is null and items.appended_at is null)
     or (batches.kitchen_batch_key is not null and ((extract(epoch from items.appended_at) * 1000000)::bigint)::text = batches.kitchen_batch_key)
   )
   and items.kitchen_status in ('paid', 'preparing', 'ready')
  left join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  left join public.kitchen_stations stations
    on stations.restaurant_id = items.restaurant_id
   and stations.id = items.kitchen_station_id
  group by orders.id, invoices.kitchen_ticket_number, batches.kitchen_station_id, batches.kitchen_batch_key
  order by coalesce(min(items.appended_at), orders.payment_verified_at, orders.created_at) asc, orders.created_at asc;
end;
$$;

alter function public.print_final_dining_bill(uuid, text)
rename to print_final_dining_bill_p76_base;

create or replace function public.print_final_dining_bill(
  target_dining_session_id uuid,
  target_format text default '80mm'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  target_order public.orders;
  target_bill public.dining_session_bills;
begin
  payload := public.print_final_dining_bill_p76_base(target_dining_session_id, target_format);

  select *
  into target_order
  from public.orders
  where id = target_dining_session_id;

  if payload ? 'bill' and jsonb_typeof(payload->'bill') = 'object' then
    select *
    into target_bill
    from public.dining_session_bills
    where id = case
      when (payload->'bill'->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (payload->'bill'->>'id')::uuid
      else null
    end;

    payload := jsonb_set(
      payload,
      '{bill}',
      (payload->'bill') || jsonb_build_object(
        'bill_number', coalesce(target_bill.display_number, target_bill.bill_number),
        'receipt_number', coalesce(target_bill.display_number, target_bill.bill_number),
        'dining_session_number', coalesce(target_order.dining_session_display_number, target_order.display_number)
      ),
      true
    );
  end if;

  return payload;
end;
$$;

create or replace function public.search_business_identifiers(
  target_restaurant_id uuid,
  search_query text
)
returns table (
  record_type text,
  id uuid,
  display_number text,
  table_number text,
  customer_name text,
  waiter_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  query text := lower(trim(coalesce(search_query, '')));
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to search business numbers.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active = true
    and staff.role::text in ('owner', 'manager', 'cashier', 'waiter', 'kitchen')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Active staff membership not found for this restaurant.';
  end if;

  if query = '' then
    return;
  end if;

  return query
  select 'order', orders.id, orders.display_number, orders.table_number, orders.customer_name, waiter.display_name, orders.created_at
  from public.orders orders
  left join public.restaurant_staff waiter
    on waiter.restaurant_id = orders.restaurant_id
   and waiter.id = orders.created_by_waiter_id
  where orders.restaurant_id = target_restaurant_id
    and (
      orders.id::text = query
      or lower(coalesce(orders.display_number, '')) like '%' || query || '%'
      or lower(coalesce(orders.dining_session_display_number, '')) like '%' || query || '%'
      or lower(coalesce(orders.table_number, '')) like '%' || query || '%'
      or lower(coalesce(orders.customer_name, '')) like '%' || query || '%'
      or lower(coalesce(waiter.display_name, '')) like '%' || query || '%'
    )
  union all
  select 'invoice', invoices.id, invoices.display_number, orders.table_number, orders.customer_name, waiter.display_name, invoices.created_at
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  left join public.restaurant_staff waiter
    on waiter.restaurant_id = orders.restaurant_id
   and waiter.id = orders.created_by_waiter_id
  where invoices.restaurant_id = target_restaurant_id
    and (
      invoices.id::text = query
      or lower(coalesce(invoices.display_number, '')) like '%' || query || '%'
      or lower(coalesce(invoices.kitchen_ticket_number, '')) like '%' || query || '%'
      or invoices.invoice_number::text = query
    )
  union all
  select 'bill', bills.id, coalesce(bills.display_number, bills.bill_number), orders.table_number, orders.customer_name, waiter.display_name, bills.created_at
  from public.dining_session_bills bills
  join public.orders orders
    on orders.restaurant_id = bills.restaurant_id
   and orders.id = bills.dining_session_id
  left join public.restaurant_staff waiter
    on waiter.restaurant_id = orders.restaurant_id
   and waiter.id = orders.created_by_waiter_id
  where bills.restaurant_id = target_restaurant_id
    and (
      bills.id::text = query
      or lower(coalesce(bills.display_number, bills.bill_number, '')) like '%' || query || '%'
    )
  order by created_at desc
  limit 50;
end;
$$;

revoke all on function public.derive_business_prefix(text, text, uuid) from public, anon, authenticated;
revoke all on function public.ensure_restaurant_business_prefix(uuid) from public, anon, authenticated;
revoke all on function public.next_business_number(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.enrich_business_number_payload(jsonb) from public, anon, authenticated;
revoke all on function public.search_business_identifiers(uuid, text) from public, anon;
revoke all on function public.get_cashier_invoice_queue(uuid) from public, anon;
revoke all on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) from public, anon;
revoke all on function public.get_public_qr_order_session(text, text, text, text) from public;
revoke all on function public.get_public_qr_order_session(text, text, text) from public;
revoke all on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) from public;
revoke all on function public.create_public_qr_order(text, text, text, text, text, jsonb) from public;
revoke all on function public.get_waiter_order_session(text, text) from public, anon;
revoke all on function public.create_waiter_order(text, text, text, text, text, jsonb) from public, anon;
revoke all on function public.print_final_dining_bill(uuid, text) from public, anon;

grant execute on function public.derive_business_prefix(text, text, uuid) to service_role;
grant execute on function public.ensure_restaurant_business_prefix(uuid) to authenticated, service_role;
grant execute on function public.next_business_number(uuid, text, text, integer) to service_role;
grant execute on function public.enrich_business_number_payload(jsonb) to service_role;
grant execute on function public.search_business_identifiers(uuid, text) to authenticated, service_role;
grant execute on function public.get_cashier_invoice_queue(uuid) to authenticated;
grant execute on function public.get_station_kitchen_orders(uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.get_public_qr_order_session(text, text, text, text) to anon, authenticated;
grant execute on function public.get_public_qr_order_session(text, text, text) to anon, authenticated;
grant execute on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.create_public_qr_order(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_waiter_order_session(text, text) to authenticated;
grant execute on function public.create_waiter_order(text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.print_final_dining_bill(uuid, text) to authenticated, service_role;
