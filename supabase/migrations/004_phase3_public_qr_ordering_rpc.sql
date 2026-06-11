-- SERVEFLOW Phase 3 anonymous public QR ordering.
-- Public clients may create orders only through this SECURITY DEFINER RPC.
-- Existing authenticated Phase 1 table policies remain in place.

alter table public.orders
  add column if not exists customer_name text,
  add column if not exists table_number text,
  add column if not exists order_source text not null default 'authenticated';

alter table public.orders
  alter column customer_user_id drop not null;

alter table public.orders
  drop constraint if exists orders_order_source_allowed,
  add constraint orders_order_source_allowed
    check (order_source in ('authenticated', 'public_qr'));

alter table public.orders
  drop constraint if exists orders_authenticated_requires_customer_user,
  add constraint orders_authenticated_requires_customer_user
    check (
      order_source <> 'authenticated'
      or customer_user_id is not null
    );

alter table public.orders
  drop constraint if exists orders_public_qr_requires_anonymous_customer,
  add constraint orders_public_qr_requires_anonymous_customer
    check (
      order_source <> 'public_qr'
      or customer_user_id is null
    );

alter table public.orders
  drop constraint if exists orders_public_qr_starts_pending,
  add constraint orders_public_qr_starts_pending
    check (
      order_source <> 'public_qr'
      or status = 'pending'
    );

create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  customer_name text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  created_order public.orders;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number text;
  normalized_customer_name text;
begin
  normalized_table_number := nullif(trim(table_number), '');
  normalized_customer_name := nullif(trim(customer_name), '');

  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);

  if requested_count < 1 then
    raise exception 'Order must include at least one item.';
  end if;

  if requested_count > 50 then
    raise exception 'Order cannot include more than 50 line items.';
  end if;

  select id
  into target_restaurant_id
  from public.restaurants
  where slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  with normalized_items as (
    select
      case
        when line_item ? 'menu_item_id'
          and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (line_item->>'menu_item_id')::uuid
        else null
      end as menu_item_id,
      case
        when line_item ? 'quantity'
          and (line_item->>'quantity') ~ '^[0-9]+$'
          then (line_item->>'quantity')::integer
        else null
      end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1
    from normalized_items
    where menu_item_id is null
      or quantity is null
      or quantity < 1
      or quantity > 99
  ),
  valid_items as (
    select
      normalized_items.menu_item_id,
      normalized_items.quantity,
      menu_items.price
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
    order_source
  )
  values (
    target_restaurant_id,
    null,
    'pending',
    computed_total,
    normalized_customer_name,
    normalized_table_number,
    'public_qr'
  )
  returning * into created_order;

  insert into public.order_items (
    restaurant_id,
    order_id,
    menu_item_id,
    quantity,
    price
  )
  select
    target_restaurant_id,
    created_order.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity
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
    'created_at', created_order.created_at
  );
end;
$$;

revoke all on function public.create_public_qr_order(text, text, text, jsonb) from public;
grant execute on function public.create_public_qr_order(text, text, text, jsonb) to anon;
grant execute on function public.create_public_qr_order(text, text, text, jsonb) to authenticated;
