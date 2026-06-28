-- Owner QR management controls for existing restaurant table QR records.

create or replace function public.regenerate_restaurant_table_qr(
  target_restaurant_id uuid,
  target_table_id uuid
)
returns public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  target_table public.restaurant_tables;
  restaurant_slug text;
  new_token uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to regenerate table QR codes.';
  end if;

  if target_restaurant_id is null or target_table_id is null then
    raise exception 'Restaurant and table are required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may manage table QR codes.';
  end if;

  select slug
  into restaurant_slug
  from public.restaurants
  where id = target_restaurant_id;

  if restaurant_slug is null then
    raise exception 'Restaurant not found.';
  end if;

  update public.restaurant_tables
  set
    qr_token = new_token,
    qr_url = '/r/' || restaurant_slug || '/order?t=' || table_number || '&qr=' || new_token,
    qr_path = '/r/' || restaurant_slug || '/order?t=' || table_number || '&qr=' || new_token,
    qr_regenerated_at = now(),
    updated_at = now()
  where id = target_table_id
    and restaurant_id = target_restaurant_id
  returning * into target_table;

  if target_table.id is null then
    raise exception 'Table not found.';
  end if;

  return target_table;
end;
$$;

revoke all on function public.regenerate_restaurant_table_qr(uuid, uuid) from public, anon;
grant execute on function public.regenerate_restaurant_table_qr(uuid, uuid) to authenticated;

create or replace function public.set_restaurant_table_active(
  target_restaurant_id uuid,
  target_table_id uuid,
  requested_active boolean
)
returns public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  target_table public.restaurant_tables;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to manage table QR codes.';
  end if;

  if target_restaurant_id is null or target_table_id is null or requested_active is null then
    raise exception 'Restaurant, table, and active state are required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may manage table QR codes.';
  end if;

  update public.restaurant_tables
  set
    active = requested_active,
    updated_at = now()
  where id = target_table_id
    and restaurant_id = target_restaurant_id
  returning * into target_table;

  if target_table.id is null then
    raise exception 'Table not found.';
  end if;

  return target_table;
end;
$$;

revoke all on function public.set_restaurant_table_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_restaurant_table_active(uuid, uuid, boolean) to authenticated;

create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
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
  raise exception 'A valid table QR code is required to place this order.';
end;
$$;

revoke all on function public.create_public_qr_order(text, text, text, text, jsonb) from public;
grant execute on function public.create_public_qr_order(text, text, text, text, jsonb) to anon;
grant execute on function public.create_public_qr_order(text, text, text, text, jsonb) to authenticated;

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
  created_order public.orders;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_customer_name text;
  normalized_payment_method text;
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

  insert into public.orders (restaurant_id, customer_user_id, status, total_price, customer_name, table_number, payment_method, order_source)
  values (target_restaurant_id, null, 'pending_payment', computed_total, normalized_customer_name, normalized_table_number::text, normalized_payment_method, 'public_qr')
  returning * into created_order;

  insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price)
  select target_restaurant_id, created_order.id, menu_items.id, normalized_items.quantity, menu_items.price
  from (
    select (line_item->>'menu_item_id')::uuid as menu_item_id, (line_item->>'quantity')::integer as quantity
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id
   and menu_items.available = true;

  return jsonb_build_object(
    'order_id', created_order.id,
    'status', created_order.status,
    'total_price', created_order.total_price,
    'table_number', created_order.table_number,
    'customer_name', created_order.customer_name,
    'payment_method', created_order.payment_method,
    'created_at', created_order.created_at
  );
end;
$$;

revoke all on function public.create_public_qr_order(text, text, text, text, text, jsonb) from public;
grant execute on function public.create_public_qr_order(text, text, text, text, text, jsonb) to anon;
grant execute on function public.create_public_qr_order(text, text, text, text, text, jsonb) to authenticated;

create table if not exists public.restaurant_table_qr_scans (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  table_number integer not null,
  qr_token uuid not null,
  scanned_at timestamptz not null default now()
);

create index if not exists restaurant_table_qr_scans_restaurant_table_scanned_idx
on public.restaurant_table_qr_scans (restaurant_id, table_id, scanned_at desc);

alter table public.restaurant_table_qr_scans enable row level security;

revoke all on public.restaurant_table_qr_scans from public, anon;
grant select on public.restaurant_table_qr_scans to authenticated;

drop policy if exists restaurant_table_qr_scans_select_owner_same_restaurant on public.restaurant_table_qr_scans;
create policy restaurant_table_qr_scans_select_owner_same_restaurant
on public.restaurant_table_qr_scans
for select
to authenticated
using (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]));

create or replace function public.log_public_qr_scan(
  target_restaurant_slug text,
  table_number text,
  qr_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  normalized_table_number integer;
  normalized_qr_token uuid;
  target_table public.restaurant_tables;
begin
  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if table_number is null or trim(table_number) !~ '^[0-9]+$' then
    raise exception 'A valid table QR code is required.';
  end if;

  if qr_token is null or length(trim(qr_token)) = 0 then
    raise exception 'A valid table QR code is required.';
  end if;

  normalized_table_number := trim(table_number)::integer;

  begin
    normalized_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required.';
  end;

  select id
  into target_restaurant_id
  from public.restaurants
  where slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  select *
  into target_table
  from public.restaurant_tables rt
  where rt.restaurant_id = target_restaurant_id
    and rt.table_number = normalized_table_number
    and rt.qr_token = normalized_qr_token
    and rt.active = true
  limit 1;

  if target_table.id is null then
    raise exception 'Invalid or expired table QR code.';
  end if;

  insert into public.restaurant_table_qr_scans (restaurant_id, table_id, table_number, qr_token)
  values (target_restaurant_id, target_table.id, normalized_table_number, normalized_qr_token);
end;
$$;

revoke all on function public.log_public_qr_scan(text, text, text) from public;
grant execute on function public.log_public_qr_scan(text, text, text) to anon;
grant execute on function public.log_public_qr_scan(text, text, text) to authenticated;

create or replace function public.get_owner_table_qr_stats(
  target_restaurant_id uuid
)
returns table (
  table_id uuid,
  table_number integer,
  orders_today integer,
  last_scan_at timestamptz,
  last_order_at timestamptz,
  scan_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  today_start timestamptz := date_trunc('day', now());
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view QR statistics.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may view QR statistics.';
  end if;

  return query
  select
    rt.id as table_id,
    rt.table_number,
    coalesce(count(distinct o.id) filter (where o.created_at >= today_start), 0)::integer as orders_today,
    max(qrs.scanned_at) as last_scan_at,
    max(o.created_at) as last_order_at,
    coalesce(count(distinct qrs.id), 0)::integer as scan_count
  from public.restaurant_tables rt
  left join public.orders o
    on o.restaurant_id = rt.restaurant_id
   and o.table_number = rt.table_number::text
  left join public.restaurant_table_qr_scans qrs
    on qrs.restaurant_id = rt.restaurant_id
   and qrs.table_id = rt.id
  where rt.restaurant_id = target_restaurant_id
  group by rt.id, rt.table_number
  order by rt.table_number;
end;
$$;

revoke all on function public.get_owner_table_qr_stats(uuid) from public, anon;
grant execute on function public.get_owner_table_qr_stats(uuid) to authenticated;
