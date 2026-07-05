-- Invoice-based billing.
-- Payment state lives on immutable invoice snapshots. Kitchen only sees items
-- released from paid invoices.

create table if not exists public.order_invoices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null,
  invoice_number integer not null,
  status text not null default 'pending',
  total_price numeric(12, 2) not null default 0 check (total_price >= 0),
  payment_method text,
  paid_at timestamptz,
  paid_by uuid,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, order_id, invoice_number),
  constraint order_invoices_status_allowed check (status in ('pending', 'paid', 'cancelled')),
  constraint order_invoices_order_same_restaurant
    foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id)
    on delete cascade,
  constraint order_invoices_paid_by_same_restaurant
    foreign key (restaurant_id, paid_by)
    references public.restaurant_staff (restaurant_id, id)
    on delete set null
);

create index if not exists order_invoices_order_idx
on public.order_invoices (restaurant_id, order_id, invoice_number);

create index if not exists order_invoices_status_idx
on public.order_invoices (restaurant_id, status, created_at);

alter table public.order_items
  add column if not exists invoice_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_invoice_same_restaurant'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_invoice_same_restaurant
      foreign key (restaurant_id, invoice_id)
      references public.order_invoices (restaurant_id, id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists order_items_invoice_idx
on public.order_items (restaurant_id, invoice_id);

alter table public.order_items
  drop constraint if exists order_items_kitchen_status_allowed,
  add constraint order_items_kitchen_status_allowed
    check (kitchen_status in ('held', 'paid', 'preparing', 'ready', 'completed'));

alter table public.order_invoices enable row level security;

revoke all on public.order_invoices from anon, authenticated;
grant select on public.order_invoices to authenticated;

drop policy if exists order_invoices_select_staff_same_restaurant on public.order_invoices;
create policy order_invoices_select_staff_same_restaurant
on public.order_invoices
for select
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  or public.is_active_restaurant_staff_member(restaurant_id)
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'order_invoices'
     ) then
    alter publication supabase_realtime add table public.order_invoices;
  end if;
end;
$$;

insert into public.order_invoices (
  restaurant_id,
  order_id,
  invoice_number,
  status,
  total_price,
  payment_method,
  paid_at,
  paid_by,
  locked_at,
  created_at,
  updated_at
)
select
  orders.restaurant_id,
  orders.id,
  1,
  case
    when orders.payment_verified_at is not null
      or orders.status::text in ('paid', 'preparing', 'ready', 'completed')
    then 'paid'
    else 'pending'
  end,
  orders.total_price,
  orders.payment_method,
  orders.payment_verified_at,
  orders.payment_verified_by,
  case
    when orders.payment_verified_at is not null
      or orders.status::text in ('paid', 'preparing', 'ready', 'completed')
    then coalesce(orders.payment_verified_at, orders.created_at)
    else null
  end,
  orders.created_at,
  coalesce(orders.updated_at, orders.created_at)
from public.orders orders
where not exists (
  select 1
  from public.order_invoices invoices
  where invoices.restaurant_id = orders.restaurant_id
    and invoices.order_id = orders.id
);

update public.order_items items
set invoice_id = invoices.id
from public.order_invoices invoices
where items.restaurant_id = invoices.restaurant_id
  and items.order_id = invoices.order_id
  and invoices.invoice_number = 1
  and items.invoice_id is null;

update public.order_items items
set kitchen_status = 'held'
from public.order_invoices invoices
where invoices.restaurant_id = items.restaurant_id
  and invoices.id = items.invoice_id
  and invoices.status = 'pending'
  and items.kitchen_status = 'paid';

create or replace function public.refresh_kitchen_order_station_progress(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
begin
  select *
  into target_order
  from public.orders
  where id = target_order_id;

  if target_order.id is null then
    return;
  end if;

  insert into public.kitchen_order_station_progress (
    restaurant_id,
    order_id,
    kitchen_station_id,
    station_status,
    item_count,
    ready_count,
    completed_count,
    started_at,
    started_by,
    ready_at,
    ready_by,
    completed_at,
    completed_by
  )
  select
    items.restaurant_id,
    items.order_id,
    items.kitchen_station_id,
    case
      when count(*) filter (where items.kitchen_status = 'completed') = count(*) then 'completed'
      when count(*) filter (where items.kitchen_status in ('ready', 'completed')) = count(*) then 'ready'
      when count(*) filter (where items.kitchen_status = 'paid') = count(*) then 'waiting'
      else 'preparing'
    end,
    count(*)::integer,
    count(*) filter (where items.kitchen_status in ('ready', 'completed'))::integer,
    count(*) filter (where items.kitchen_status = 'completed')::integer,
    min(items.kitchen_preparation_started_at),
    (array_remove(array_agg(items.kitchen_preparation_started_by order by items.kitchen_preparation_started_at asc nulls last), null))[1],
    max(items.kitchen_ready_marked_at),
    (array_remove(array_agg(items.kitchen_ready_marked_by order by items.kitchen_ready_marked_at desc nulls last), null))[1],
    max(items.kitchen_completed_at),
    (array_remove(array_agg(items.kitchen_completed_by order by items.kitchen_completed_at desc nulls last), null))[1]
  from public.order_items items
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_station_id is not null
    and items.kitchen_status <> 'held'
  group by items.restaurant_id, items.order_id, items.kitchen_station_id
  on conflict (restaurant_id, order_id, kitchen_station_id) do update
  set
    station_status = excluded.station_status,
    item_count = excluded.item_count,
    ready_count = excluded.ready_count,
    completed_count = excluded.completed_count,
    started_at = excluded.started_at,
    started_by = excluded.started_by,
    ready_at = excluded.ready_at,
    ready_by = excluded.ready_by,
    completed_at = excluded.completed_at,
    completed_by = excluded.completed_by,
    updated_at = now();

  delete from public.kitchen_order_station_progress progress
  where progress.restaurant_id = target_order.restaurant_id
    and progress.order_id = target_order.id
    and not exists (
      select 1
      from public.order_items items
      where items.restaurant_id = progress.restaurant_id
        and items.order_id = progress.order_id
        and items.kitchen_station_id = progress.kitchen_station_id
        and items.kitchen_status <> 'held'
    );
end;
$$;

create or replace function public.derive_order_status_from_items(
  target_order_id uuid,
  acting_staff_id uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  next_status public.order_status;
  updated_order public.orders;
  released_count integer := 0;
  has_pending_invoice boolean := false;
begin
  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  if target_order.status::text in ('pending', 'cancelled') then
    return target_order;
  end if;

  select count(*)::integer
  into released_count
  from public.order_items items
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and items.kitchen_status <> 'held';

  select exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.status = 'pending'
  )
  into has_pending_invoice;

  perform public.refresh_kitchen_order_station_progress(target_order.id);

  if released_count = 0 then
    next_status := case
      when has_pending_invoice then 'pending_payment'::public.order_status
      else target_order.status
    end;
  else
    select case
      when count(*) = 0 then 'paid'::public.order_status
      when bool_or(progress.station_status = 'waiting') then 'paid'::public.order_status
      when bool_or(progress.station_status = 'preparing') then 'preparing'::public.order_status
      when bool_and(progress.station_status = 'completed') then 'completed'::public.order_status
      else 'ready'::public.order_status
    end
    into next_status
    from public.kitchen_order_station_progress progress
    where progress.restaurant_id = target_order.restaurant_id
      and progress.order_id = target_order.id;
  end if;

  update public.orders
  set
    status = next_status,
    preparation_started_at = case
      when next_status::text in ('preparing', 'ready', 'completed') and preparation_started_at is null and acting_staff_id is not null then now()
      else preparation_started_at
    end,
    preparation_started_by = case
      when next_status::text in ('preparing', 'ready', 'completed') and preparation_started_by is null and acting_staff_id is not null then acting_staff_id
      else preparation_started_by
    end,
    ready_marked_at = case
      when next_status::text in ('ready', 'completed') and ready_marked_at is null and acting_staff_id is not null then now()
      else ready_marked_at
    end,
    ready_marked_by = case
      when next_status::text in ('ready', 'completed') and ready_marked_by is null and acting_staff_id is not null then acting_staff_id
      else ready_marked_by
    end,
    completed_at = case
      when next_status::text = 'completed' and completed_at is null and acting_staff_id is not null then now()
      else completed_at
    end,
    completed_by = case
      when next_status::text = 'completed' and completed_by is null and acting_staff_id is not null then acting_staff_id
      else completed_by
    end,
    updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

  return updated_order;
end;
$$;

create or replace function public.reconcile_order_status_from_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_order_id uuid;
  acting_staff_id uuid;
begin
  changed_order_id := coalesce(new.order_id, old.order_id);
  acting_staff_id := coalesce(
    new.kitchen_completed_by,
    new.kitchen_ready_marked_by,
    new.kitchen_preparation_started_by,
    old.kitchen_completed_by,
    old.kitchen_ready_marked_by,
    old.kitchen_preparation_started_by
  );
  perform public.derive_order_status_from_items(changed_order_id, acting_staff_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists reconcile_order_status_from_item_change on public.order_items;
create trigger reconcile_order_status_from_item_change
after insert or update of kitchen_status, kitchen_station_id, invoice_id or delete on public.order_items
for each row
execute function public.reconcile_order_status_from_item_change();

create or replace function public.get_public_qr_order_session(
  target_restaurant_slug text,
  table_number text,
  qr_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_qr_token uuid;
  normalized_table_number_text text;
  normalized_table_number integer;
  active_order public.orders;
  session_items jsonb := '[]'::jsonb;
  session_invoices jsonb := '[]'::jsonb;
begin
  normalized_table_number_text := nullif(trim(table_number), '');

  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if normalized_table_number_text is null then
    return null;
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  if qr_token is null or length(trim(qr_token)) = 0 then
    return null;
  end if;

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to view this order.';
  end;

  select r.id
  into target_restaurant_id
  from public.restaurants r
  where r.slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = target_restaurant_id
      and rt.table_number = normalized_table_number
      and rt.qr_token = target_qr_token
      and rt.active = true
  ) then
    raise exception 'Invalid or expired table QR code.';
  end if;

  select *
  into active_order
  from public.orders orders
  where orders.restaurant_id = target_restaurant_id
    and orders.table_number = normalized_table_number::text
    and orders.status::text in ('pending_payment', 'paid', 'preparing', 'ready')
  order by orders.created_at desc
  limit 1;

  if active_order.id is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', items.id,
        'invoice_id', items.invoice_id,
        'invoice_status', invoices.status,
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', items.quantity,
        'unit_price', items.price,
        'line_total', (items.price * items.quantity)::numeric(12, 2),
        'kitchen_status', items.kitchen_status,
        'appended_at', items.appended_at,
        'created_at', items.created_at
      )
      order by items.created_at, items.id
    ),
    '[]'::jsonb
  )
  into session_items
  from public.order_items items
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id
   and invoices.id = items.invoice_id
  join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  where items.restaurant_id = active_order.restaurant_id
    and items.order_id = active_order.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', invoices.id,
        'invoice_number', invoices.invoice_number,
        'status', invoices.status,
        'total_price', invoices.total_price,
        'payment_method', invoices.payment_method,
        'paid_at', invoices.paid_at,
        'locked_at', invoices.locked_at,
        'created_at', invoices.created_at
      )
      order by invoices.invoice_number
    ),
    '[]'::jsonb
  )
  into session_invoices
  from public.order_invoices invoices
  where invoices.restaurant_id = active_order.restaurant_id
    and invoices.order_id = active_order.id;

  return jsonb_build_object(
    'order_id', active_order.id,
    'status', active_order.status,
    'total_price', active_order.total_price,
    'table_number', active_order.table_number,
    'customer_name', active_order.customer_name,
    'payment_method', active_order.payment_method,
    'created_at', active_order.created_at,
    'payment_verified_at', active_order.payment_verified_at,
    'items', session_items,
    'invoices', session_invoices
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
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_total_tables integer;
  target_qr_token uuid;
  active_order public.orders;
  updated_order public.orders;
  latest_invoice public.order_invoices;
  current_invoice public.order_invoices;
  next_invoice_number integer;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_customer_name text;
  normalized_payment_method text;
  added_at timestamptz := now();
  added_items jsonb := '[]'::jsonb;
begin
  normalized_table_number_text := nullif(trim(table_number), '');
  normalized_customer_name := nullif(trim(customer_name), '');
  normalized_payment_method := nullif(trim(selected_payment_method), '');

  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if normalized_table_number_text is null then
    raise exception 'Table number is required to place your order.';
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  if qr_token is null or length(trim(qr_token)) = 0 then
    raise exception 'A valid table QR code is required to place this order.';
  end if;

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to place this order.';
  end;

  if normalized_payment_method is null then
    raise exception 'Payment method is required.';
  end if;

  if normalized_payment_method not in ('Cash', 'Telebirr', 'CBE Birr', 'Mobile Banking', 'Chapa', 'Credit/Debit Card') then
    raise exception 'Payment method is not supported.';
  end if;

  select r.id, r.total_tables
  into target_restaurant_id, target_total_tables
  from public.restaurants r
  where r.slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = target_restaurant_id
      and rt.table_number = normalized_table_number
      and rt.qr_token = target_qr_token
      and rt.active = true
  ) then
    raise exception 'Invalid or expired table QR code.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then raise exception 'Order must include at least one item.'; end if;
  if requested_count > 50 then raise exception 'Order cannot include more than 50 line items.'; end if;

  with normalized_items as (
    select
      case when line_item ? 'menu_item_id'
        and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (line_item->>'menu_item_id')::uuid else null end as menu_item_id,
      case when line_item ? 'quantity' and (line_item->>'quantity') ~ '^[0-9]+$'
        then (line_item->>'quantity')::integer else null end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1 from normalized_items
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 99
  ),
  valid_items as (
    select normalized_items.menu_item_id, normalized_items.quantity, menu_items.price
    from normalized_items
    join public.menu_items
      on menu_items.id = normalized_items.menu_item_id
     and menu_items.restaurant_id = target_restaurant_id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_total
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_total is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_restaurant_id::text || ':' || normalized_table_number::text, 0));

  select *
  into active_order
  from public.orders orders
  where orders.restaurant_id = target_restaurant_id
    and orders.table_number = normalized_table_number::text
    and orders.status::text in ('pending_payment', 'paid', 'preparing', 'ready')
  order by orders.created_at desc
  limit 1
  for update;

  if active_order.id is null then
    insert into public.orders (restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source)
    values (target_restaurant_id, null, 'pending_payment', computed_total, normalized_customer_name, normalized_table_number::text, normalized_payment_method, 'public_qr')
    returning * into updated_order;

    insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
    values (target_restaurant_id, updated_order.id, 1, 'pending', computed_total, normalized_payment_method, added_at, added_at)
    returning * into current_invoice;
  else
    select *
    into latest_invoice
    from public.order_invoices invoices
    where invoices.restaurant_id = active_order.restaurant_id
      and invoices.order_id = active_order.id
    order by invoices.invoice_number desc
    limit 1
    for update;

    if latest_invoice.id is null or latest_invoice.status = 'paid' then
      select coalesce(max(invoice_number), 0) + 1
      into next_invoice_number
      from public.order_invoices invoices
      where invoices.restaurant_id = active_order.restaurant_id
        and invoices.order_id = active_order.id;

      insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
      values (active_order.restaurant_id, active_order.id, next_invoice_number, 'pending', computed_total, normalized_payment_method, added_at, added_at)
      returning * into current_invoice;
    else
      update public.order_invoices
      set
        total_price = (latest_invoice.total_price + computed_total)::numeric(12, 2),
        payment_method = coalesce(latest_invoice.payment_method, normalized_payment_method),
        updated_at = added_at
      where id = latest_invoice.id
        and restaurant_id = latest_invoice.restaurant_id
        and status = 'pending'
      returning * into current_invoice;
    end if;

    update public.orders
    set
      total_price = (active_order.total_price + computed_total)::numeric(12, 2),
      customer_name = coalesce(active_order.customer_name, normalized_customer_name),
      payment_method = coalesce(active_order.payment_method, normalized_payment_method),
      updated_at = added_at
    where id = active_order.id
      and restaurant_id = active_order.restaurant_id
    returning * into updated_order;
  end if;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, appended_at, kitchen_status)
  select
    target_restaurant_id,
    updated_order.id,
    current_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    case when active_order.id is null then null else added_at end,
    'held'
  from (
    select (line_item->>'menu_item_id')::uuid as menu_item_id, (line_item->>'quantity')::integer as quantity
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id
   and menu_items.available = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', appended.quantity,
        'unit_price', menu_items.price,
        'line_total', (menu_items.price * appended.quantity)::numeric(12, 2)
      )
      order by menu_items.name
    ),
    '[]'::jsonb
  )
  into added_items
  from (
    select (line_item->>'menu_item_id')::uuid as menu_item_id, (line_item->>'quantity')::integer as quantity
    from jsonb_array_elements(requested_items) as line_item
  ) appended
  join public.menu_items
    on menu_items.id = appended.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id;

  return jsonb_build_object(
    'order_id', updated_order.id,
    'invoice_id', current_invoice.id,
    'invoice_number', current_invoice.invoice_number,
    'invoice_status', current_invoice.status,
    'status', updated_order.status,
    'total_price', updated_order.total_price,
    'invoice_total', current_invoice.total_price,
    'table_number', updated_order.table_number,
    'customer_name', updated_order.customer_name,
    'payment_method', current_invoice.payment_method,
    'created_at', updated_order.created_at,
    'session_action', case when active_order.id is null then 'created' else 'appended' end,
    'appended_at', case when active_order.id is null then null else added_at end,
    'added_total', computed_total,
    'items_added', added_items
  );
end;
$$;

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
  acting_staff public.restaurant_staff;
  target_total_tables integer;
  created_order public.orders;
  created_invoice public.order_invoices;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_payment_method text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create cashier orders.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
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
    raise exception 'Only active cashiers and owners may create cashier orders.';
  end if;

  normalized_table_number_text := nullif(trim(table_number), '');
  normalized_payment_method := coalesce(nullif(trim(selected_payment_method), ''), 'Cash');

  if normalized_table_number_text is null then
    raise exception 'Table number is required.';
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  select r.total_tables
  into target_total_tables
  from public.restaurants r
  where r.id = target_restaurant_id
  limit 1;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = target_restaurant_id
      and rt.table_number = normalized_table_number
      and rt.active = true
  ) then
    raise exception 'Invalid table number. Please select a table between 1 and %.', coalesce(target_total_tables, 20);
  end if;

  if normalized_payment_method not in ('Cash', 'Telebirr', 'CBE Birr', 'Mobile Banking', 'Chapa', 'Credit/Debit Card') then
    raise exception 'Payment method is not supported.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then raise exception 'Order must include at least one item.'; end if;
  if requested_count > 50 then raise exception 'Order cannot include more than 50 line items.'; end if;

  with normalized_items as (
    select
      case when line_item ? 'menu_item_id'
        and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (line_item->>'menu_item_id')::uuid else null end as menu_item_id,
      case when line_item ? 'quantity' and (line_item->>'quantity') ~ '^[0-9]+$'
        then (line_item->>'quantity')::integer else null end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1 from normalized_items
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 99
  ),
  valid_items as (
    select normalized_items.menu_item_id, normalized_items.quantity, menu_items.price
    from normalized_items
    join public.menu_items
      on menu_items.id = normalized_items.menu_item_id
     and menu_items.restaurant_id = target_restaurant_id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_total
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_total is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  insert into public.orders (
    restaurant_id,
    customer_user_id,
    status,
    total_price,
    customer_name,
    table_number,
    payment_method,
    order_source
  )
  values (
    target_restaurant_id,
    null,
    'pending_payment',
    computed_total,
    null,
    normalized_table_number::text,
    normalized_payment_method,
    'cashier'
  )
  returning * into created_order;

  insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method)
  values (target_restaurant_id, created_order.id, 1, 'pending', computed_total, normalized_payment_method)
  returning * into created_invoice;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, kitchen_status)
  select
    target_restaurant_id,
    created_order.id,
    created_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), ''),
    'held'
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      line_item->>'notes' as notes
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id
   and menu_items.available = true;

  return jsonb_build_object(
    'order_id', created_order.id,
    'invoice_id', created_invoice.id,
    'invoice_number', created_invoice.invoice_number,
    'invoice_status', created_invoice.status,
    'status', created_order.status,
    'total_price', created_order.total_price,
    'invoice_total', created_invoice.total_price,
    'table_number', created_order.table_number,
    'payment_method', created_invoice.payment_method,
    'order_source', created_order.order_source,
    'created_at', created_order.created_at
  );
end;
$$;

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
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  latest_invoice public.order_invoices;
  current_invoice public.order_invoices;
  next_invoice_number integer;
  requested_count integer;
  computed_addition numeric(12, 2);
  updated_order public.orders;
  active_shift_id uuid;
  added_at timestamptz := now();
  added_items jsonb;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to append order items.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may append order items.';
  end if;

  if target_order.status::text not in ('pending_payment', 'paid', 'preparing', 'ready') then
    raise exception 'Items may only be appended to active orders.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then raise exception 'Order must include at least one item.'; end if;
  if requested_count > 50 then raise exception 'Order cannot include more than 50 line items.'; end if;

  with normalized_items as (
    select
      case when line_item ? 'menu_item_id'
        and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (line_item->>'menu_item_id')::uuid else null end as menu_item_id,
      case when line_item ? 'quantity' and (line_item->>'quantity') ~ '^[0-9]+$'
        then (line_item->>'quantity')::integer else null end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1 from normalized_items
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 99
  ),
  valid_items as (
    select normalized_items.menu_item_id, normalized_items.quantity, menu_items.price
    from normalized_items
    join public.menu_items
      on menu_items.id = normalized_items.menu_item_id
     and menu_items.restaurant_id = target_order.restaurant_id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_addition
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_addition is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  select *
  into latest_invoice
  from public.order_invoices invoices
  where invoices.restaurant_id = target_order.restaurant_id
    and invoices.order_id = target_order.id
  order by invoices.invoice_number desc
  limit 1
  for update;

  if latest_invoice.id is null or latest_invoice.status = 'paid' then
    select coalesce(max(invoice_number), 0) + 1
    into next_invoice_number
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id;

    insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
    values (target_order.restaurant_id, target_order.id, next_invoice_number, 'pending', computed_addition, target_order.payment_method, added_at, added_at)
    returning * into current_invoice;
  else
    update public.order_invoices
    set
      total_price = (latest_invoice.total_price + computed_addition)::numeric(12, 2),
      updated_at = added_at
    where id = latest_invoice.id
      and restaurant_id = latest_invoice.restaurant_id
      and status = 'pending'
    returning * into current_invoice;
  end if;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, appended_at, kitchen_status)
  select
    target_order.restaurant_id,
    target_order.id,
    current_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), ''),
    added_at,
    'held'
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      line_item->>'notes' as notes
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_order.restaurant_id
   and menu_items.available = true;

  update public.orders
  set
    total_price = (target_order.total_price + computed_addition)::numeric(12, 2),
    updated_at = added_at
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', appended.quantity,
        'unit_price', menu_items.price,
        'notes', appended.notes
      )
      order by menu_items.name
    ),
    '[]'::jsonb
  )
  into added_items
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      nullif(left(trim(coalesce(line_item->>'notes', '')), 500), '') as notes
    from jsonb_array_elements(requested_items) as line_item
  ) appended
  join public.menu_items
    on menu_items.id = appended.menu_item_id
   and menu_items.restaurant_id = target_order.restaurant_id;

  select cs.id
  into active_shift_id
  from public.cashier_shifts cs
  where cs.restaurant_id = target_order.restaurant_id
    and cs.opened_by = acting_staff.id
    and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  if active_shift_id is null then
    select cs.id
    into active_shift_id
    from public.cashier_shifts cs
    where cs.restaurant_id = target_order.restaurant_id
      and cs.closed_at is null
    order by cs.opened_at desc
    limit 1;
  end if;

  insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_order.restaurant_id,
    active_shift_id,
    target_order.id,
    acting_staff.id,
    'order_items_appended',
    'Table ' || coalesce(target_order.table_number, '-') || ' added ' || requested_count || ' item(s)',
    computed_addition,
    jsonb_build_object(
      'cashier_id', acting_staff.id,
      'order_id', target_order.id,
      'invoice_id', current_invoice.id,
      'invoice_number', current_invoice.invoice_number,
      'table_number', target_order.table_number,
      'items_added', added_items,
      'timestamp', added_at
    )
  );

  return jsonb_build_object(
    'order_id', updated_order.id,
    'invoice_id', current_invoice.id,
    'invoice_number', current_invoice.invoice_number,
    'invoice_status', current_invoice.status,
    'status', updated_order.status,
    'total_price', updated_order.total_price,
    'invoice_total', current_invoice.total_price,
    'table_number', updated_order.table_number,
    'payment_method', current_invoice.payment_method,
    'order_source', updated_order.order_source,
    'created_at', updated_order.created_at,
    'appended_at', added_at,
    'items_added', added_items
  );
end;
$$;

create or replace function public.approve_order_payment(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  target_invoice public.order_invoices;
  updated_order public.orders;
  active_shift_id uuid;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to approve payment.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may approve payment.';
  end if;

  select *
  into target_invoice
  from public.order_invoices invoices
  where invoices.restaurant_id = target_order.restaurant_id
    and invoices.order_id = target_order.id
    and invoices.status = 'pending'
  order by invoices.invoice_number desc
  limit 1
  for update;

  if target_invoice.id is null then
    raise exception 'No pending invoice was found for this order.';
  end if;

  update public.order_invoices
  set
    status = 'paid',
    paid_at = now(),
    paid_by = acting_staff.id,
    locked_at = now(),
    updated_at = now()
  where id = target_invoice.id
    and restaurant_id = target_invoice.restaurant_id
    and status = 'pending'
  returning * into target_invoice;

  update public.order_items items
  set kitchen_status = 'paid'
  where items.restaurant_id = target_invoice.restaurant_id
    and items.invoice_id = target_invoice.id
    and items.kitchen_status = 'held';

  update public.orders
  set
    payment_verified_at = coalesce(payment_verified_at, target_invoice.paid_at),
    payment_verified_by = coalesce(payment_verified_by, acting_staff.id),
    payment_method = coalesce(payment_method, target_invoice.payment_method),
    updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id;

  updated_order := public.derive_order_status_from_items(target_order.id, acting_staff.id);

  select cs.id
  into active_shift_id
  from public.cashier_shifts cs
  where cs.restaurant_id = target_order.restaurant_id
    and cs.opened_by = acting_staff.id
    and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  if active_shift_id is null then
    select cs.id
    into active_shift_id
    from public.cashier_shifts cs
    where cs.restaurant_id = target_order.restaurant_id
      and cs.closed_at is null
    order by cs.opened_at desc
    limit 1;
  end if;

  insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_order.restaurant_id,
    active_shift_id,
    target_order.id,
    acting_staff.id,
    'payment_verified',
    'Invoice #' || target_invoice.invoice_number || ' payment verified for table ' || coalesce(target_order.table_number, '-'),
    target_invoice.total_price,
    jsonb_build_object(
      'invoice_id', target_invoice.id,
      'invoice_number', target_invoice.invoice_number,
      'payment_method', target_invoice.payment_method,
      'table_number', target_order.table_number,
      'staff_id', acting_staff.id
    )
  );

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'approve_payment',
      target_order.id,
      jsonb_build_object(
        'invoice_id', target_invoice.id,
        'invoice_number', target_invoice.invoice_number,
        'invoice_total', target_invoice.total_price,
        'payment_method', target_invoice.payment_method,
        'table_number', updated_order.table_number,
        'staff_id', acting_staff.id
      )
    );
  end if;

  return updated_order;
end;
$$;

create or replace function public.get_cashier_shift_summary(target_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  active_shift public.cashier_shifts;
  cash_total numeric(12, 2) := 0;
  digital_total numeric(12, 2) := 0;
  orders_processed integer := 0;
  payments_processed integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view shift status.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role::text in ('cashier', 'owner', 'manager')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers, managers, and owners may view shift status.';
  end if;

  if acting_staff.role = 'cashier' then
    select *
    into active_shift
    from public.cashier_shifts
    where restaurant_id = target_restaurant_id
      and opened_by = acting_staff.id
      and closed_at is null
    order by opened_at desc
    limit 1;
  end if;

  if active_shift.id is not null then
    select
      coalesce(sum(invoices.total_price) filter (where invoices.payment_method = 'Cash' and invoices.paid_by = active_shift.opened_by), 0),
      coalesce(sum(invoices.total_price) filter (where coalesce(invoices.payment_method, '') <> 'Cash' and invoices.paid_by = active_shift.opened_by), 0),
      count(distinct orders.id) filter (where orders.created_at >= active_shift.opened_at),
      count(invoices.id) filter (where invoices.status = 'paid' and invoices.paid_at >= active_shift.opened_at)
    into cash_total, digital_total, orders_processed, payments_processed
    from public.orders orders
    left join public.order_invoices invoices
      on invoices.restaurant_id = orders.restaurant_id
     and invoices.order_id = orders.id
     and invoices.status = 'paid'
     and invoices.paid_at >= active_shift.opened_at
    where orders.restaurant_id = target_restaurant_id
      and orders.created_at >= active_shift.opened_at;
  end if;

  return jsonb_build_object(
    'staff_id', acting_staff.id,
    'active_shift', case when active_shift.id is null then null else jsonb_build_object(
      'id', active_shift.id,
      'restaurant_id', active_shift.restaurant_id,
      'opened_by', active_shift.opened_by,
      'opened_at', active_shift.opened_at,
      'opening_cash', active_shift.opening_cash,
      'notes', active_shift.notes,
      'cash_collected', cash_total,
      'digital_collected', digital_total,
      'orders_processed', orders_processed,
      'payments_processed', payments_processed,
      'expected_cash', active_shift.opening_cash + cash_total
    ) end
  );
end;
$$;

create or replace function public.get_cashier_invoice_queue(target_restaurant_id uuid)
returns table (
  invoice_id uuid,
  invoice_number integer,
  invoice_status text,
  invoice_paid_at timestamptz,
  invoice_locked_at timestamptz,
  id uuid,
  status text,
  customer_name text,
  table_number text,
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
  today_start timestamptz := date_trunc('day', now());
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view cashier invoices.';
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
    raise exception 'Only active cashiers and owners may view cashier invoices.';
  end if;

  return query
  select
    invoices.id as invoice_id,
    invoices.invoice_number,
    invoices.status as invoice_status,
    invoices.paid_at as invoice_paid_at,
    invoices.locked_at as invoice_locked_at,
    orders.id,
    orders.status::text as status,
    orders.customer_name,
    orders.table_number,
    invoices.payment_method,
    invoices.total_price,
    orders.total_price as order_total_price,
    invoices.created_at,
    invoices.paid_at as payment_verified_at,
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
  left join public.order_items items
    on items.restaurant_id = invoices.restaurant_id
   and items.invoice_id = invoices.id
  left join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  where invoices.restaurant_id = target_restaurant_id
    and invoices.created_at >= today_start
    and orders.status::text <> 'cancelled'
  group by invoices.id, orders.id
  order by invoices.created_at desc;
end;
$$;

revoke all on function public.get_public_qr_order_session(text, text, text) from public;
grant execute on function public.get_public_qr_order_session(text, text, text) to anon;
grant execute on function public.get_public_qr_order_session(text, text, text) to authenticated;

revoke all on function public.create_public_qr_order(text, text, text, text, text, jsonb) from public;
grant execute on function public.create_public_qr_order(text, text, text, text, text, jsonb) to anon;
grant execute on function public.create_public_qr_order(text, text, text, text, text, jsonb) to authenticated;

revoke all on function public.create_cashier_order(uuid, text, text, jsonb) from public, anon;
revoke all on function public.append_items_to_order(uuid, jsonb) from public, anon;
revoke all on function public.approve_order_payment(uuid) from public;
revoke all on function public.get_cashier_shift_summary(uuid) from public, anon;
revoke all on function public.get_cashier_invoice_queue(uuid) from public, anon;

grant execute on function public.create_cashier_order(uuid, text, text, jsonb) to authenticated;
grant execute on function public.append_items_to_order(uuid, jsonb) to authenticated;
grant execute on function public.approve_order_payment(uuid) to authenticated;
grant execute on function public.get_cashier_shift_summary(uuid) to authenticated;
grant execute on function public.get_cashier_invoice_queue(uuid) to authenticated;
