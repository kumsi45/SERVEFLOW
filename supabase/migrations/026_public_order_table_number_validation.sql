-- SERVEFLOW public order table number validation.
-- Enforces restaurant table_count at the server/database boundary.

create or replace function public.enforce_order_table_number_bounds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_table_count integer;
  normalized_table_number integer;
begin
  if new.table_number is null or length(trim(new.table_number)) = 0 then
    if new.order_source = 'public_qr' then
      raise exception 'Table number is required to place your order.';
    end if;

    return new;
  end if;

  if trim(new.table_number) !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := trim(new.table_number)::integer;

  select restaurants.table_count
  into configured_table_count
  from public.restaurants
  where restaurants.id = new.restaurant_id
  limit 1;

  if configured_table_count is null then
    configured_table_count := 20;
    update public.restaurants
    set table_count = configured_table_count
    where restaurants.id = new.restaurant_id;
  end if;

  if normalized_table_number < 1 or normalized_table_number > configured_table_count then
    raise exception 'Invalid table number. Please select a table between 1 and %.', configured_table_count;
  end if;

  new.table_number := normalized_table_number::text;
  return new;
end;
$$;

drop trigger if exists enforce_order_table_number_bounds on public.orders;

create trigger enforce_order_table_number_bounds
before insert or update of restaurant_id, table_number, order_source
on public.orders
for each row
execute function public.enforce_order_table_number_bounds();

alter table public.orders
  drop constraint if exists orders_table_number_positive_integer,
  add constraint orders_table_number_positive_integer
    check (
      table_number is null
      or length(trim(table_number)) = 0
      or trim(table_number) ~ '^[1-9][0-9]*$'
    )
    not valid;

revoke all on function public.enforce_order_table_number_bounds() from public, anon, authenticated;
grant execute on function public.enforce_order_table_number_bounds() to service_role;

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
declare
  target_restaurant_id uuid;
  target_table_count integer;
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

  if normalized_payment_method is null then
    raise exception 'Payment method is required.';
  end if;

  if normalized_payment_method not in (
    'Cash',
    'Telebirr',
    'CBE Birr',
    'Mobile Banking',
    'Chapa',
    'Credit/Debit Card'
  ) then
    raise exception 'Payment method is not supported.';
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

  select id, table_count
  into target_restaurant_id, target_table_count
  from public.restaurants
  where slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  if target_table_count is null then
    target_table_count := 20;
    update public.restaurants
    set table_count = target_table_count
    where id = target_restaurant_id;
  end if;

  if normalized_table_number < 1 or normalized_table_number > target_table_count then
    raise exception 'Invalid table number. Please select a table between 1 and %.', target_table_count;
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
    payment_method,
    order_source
  )
  values (
    target_restaurant_id,
    null,
    'pending_payment',
    computed_total,
    normalized_customer_name,
    normalized_table_number::text,
    normalized_payment_method,
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
    'payment_method', created_order.payment_method,
    'created_at', created_order.created_at
  );
end;
$$;

revoke all on function public.create_public_qr_order(text, text, text, text, jsonb) from public;
grant execute on function public.create_public_qr_order(text, text, text, text, jsonb) to anon;
grant execute on function public.create_public_qr_order(text, text, text, text, jsonb) to authenticated;

create or replace function public.get_public_qr_menu(target_restaurant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target_restaurant as (
    select id, name, slug, table_count
    from public.restaurants
    where slug = target_restaurant_slug
    limit 1
  )
  select
    case
      when not exists (select 1 from target_restaurant) then null
      else jsonb_build_object(
        'restaurant',
        (
          select jsonb_build_object(
            'id', restaurants.id,
            'name', restaurants.name,
            'slug', restaurants.slug,
            'table_count', restaurants.table_count,
            'logo_url', null
          )
          from target_restaurant restaurants
        ),
        'categories',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', categories.id,
                'restaurant_id', categories.restaurant_id,
                'name', categories.name
              )
              order by categories.name
            )
            from public.categories
            where categories.restaurant_id = (select id from target_restaurant)
          ),
          '[]'::jsonb
        ),
        'items',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', menu_items.id,
                'restaurant_id', menu_items.restaurant_id,
                'category_id', menu_items.category_id,
                'name', menu_items.name,
                'description', null,
                'price', menu_items.price,
                'image_url', menu_items.image_url,
                'available', menu_items.available
              )
              order by menu_items.name
            )
            from public.menu_items
            where menu_items.restaurant_id = (select id from target_restaurant)
          ),
          '[]'::jsonb
        )
      )
    end;
$$;

revoke all on function public.get_public_qr_menu(text) from public;
grant execute on function public.get_public_qr_menu(text) to anon;
grant execute on function public.get_public_qr_menu(text) to authenticated;
