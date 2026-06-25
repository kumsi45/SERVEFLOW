-- SERVEFLOW owner reports, settings, and managed restaurant tables.

alter table public.restaurants
  add column if not exists total_tables integer not null default 20,
  add column if not exists profile jsonb not null default '{}'::jsonb,
  add column if not exists business_hours jsonb not null default '{}'::jsonb,
  add column if not exists ordering_settings jsonb not null default '{}'::jsonb,
  add column if not exists branding jsonb not null default '{}'::jsonb,
  add column if not exists notification_settings jsonb not null default '{}'::jsonb,
  add column if not exists security_settings jsonb not null default '{}'::jsonb,
  add column if not exists subscription_plan text not null default 'starter',
  add column if not exists billing_status text not null default 'trial';

update public.restaurants
set total_tables = coalesce(table_count, total_tables, 20)
where total_tables is null
   or total_tables < 1;

update public.restaurants
set table_count = total_tables
where table_count is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_total_tables_bounds'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_total_tables_bounds
        check (total_tables between 1 and 500);
  end if;
end;
$$;

create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number integer not null check (table_number between 1 and 500),
  label text not null,
  qr_path text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, table_number)
);

alter table public.restaurant_tables
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists restaurant_id uuid,
  add column if not exists table_number integer,
  add column if not exists label text,
  add column if not exists qr_path text,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.restaurant_tables
set
  label = coalesce(nullif(trim(label), ''), 'Table ' || table_number),
  qr_path = coalesce(nullif(trim(qr_path), ''), '/r/' || restaurants.slug || '/order?table=' || restaurant_tables.table_number)
from public.restaurants
where restaurant_tables.restaurant_id = restaurants.id
  and restaurant_tables.table_number is not null
  and (restaurant_tables.label is null or trim(restaurant_tables.label) = '' or restaurant_tables.qr_path is null or trim(restaurant_tables.qr_path) = '');

alter table public.restaurant_tables
  alter column id set not null,
  alter column restaurant_id set not null,
  alter column table_number set not null,
  alter column label set not null,
  alter column qr_path set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_tables_pkey'
      and conrelid = 'public.restaurant_tables'::regclass
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_pkey primary key (id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_tables_restaurant_id_fkey'
      and conrelid = 'public.restaurant_tables'::regclass
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_restaurant_id_fkey
        foreign key (restaurant_id) references public.restaurants(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_tables_table_number_check'
      and conrelid = 'public.restaurant_tables'::regclass
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_table_number_check
        check (table_number between 1 and 500);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_tables_restaurant_id_id_key'
      and conrelid = 'public.restaurant_tables'::regclass
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_restaurant_id_id_key unique (restaurant_id, id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_tables_restaurant_id_table_number_key'
      and conrelid = 'public.restaurant_tables'::regclass
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_restaurant_id_table_number_key unique (restaurant_id, table_number);
  end if;
end;
$$;

create index if not exists restaurant_tables_restaurant_id_idx
on public.restaurant_tables (restaurant_id);

drop trigger if exists restaurant_tables_set_updated_at on public.restaurant_tables;

create trigger restaurant_tables_set_updated_at
before update on public.restaurant_tables
for each row
execute function public.set_updated_at();

alter table public.restaurant_tables enable row level security;

grant select, insert, update, delete on public.restaurant_tables to authenticated;
grant select on public.restaurant_tables to anon;

drop policy if exists restaurant_tables_select_owner_staff_or_public on public.restaurant_tables;
drop policy if exists restaurant_tables_select_public_active on public.restaurant_tables;
drop policy if exists restaurant_tables_select_owner_same_restaurant on public.restaurant_tables;

create policy restaurant_tables_select_public_active
on public.restaurant_tables
for select
to anon, authenticated
using (active = true);

create policy restaurant_tables_select_owner_same_restaurant
on public.restaurant_tables
for select
to authenticated
using (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]));

drop policy if exists restaurant_tables_manage_owner_same_restaurant on public.restaurant_tables;
create policy restaurant_tables_manage_owner_same_restaurant
on public.restaurant_tables
for all
to authenticated
using (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]))
with check (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]));

create or replace function public.sync_restaurant_tables(target_restaurant_id uuid, requested_total_tables integer)
returns setof public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  table_no integer;
  restaurant_slug text;
  bounded_total integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to configure tables.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may configure tables.';
  end if;

  bounded_total := greatest(1, least(500, requested_total_tables));

  select slug into restaurant_slug
  from public.restaurants
  where id = target_restaurant_id;

  if restaurant_slug is null then
    raise exception 'Restaurant not found.';
  end if;

  update public.restaurants
  set total_tables = bounded_total,
      table_count = bounded_total
  where id = target_restaurant_id;

  for table_no in 1..bounded_total loop
    insert into public.restaurant_tables (restaurant_id, table_number, label, qr_path, active)
    values (
      target_restaurant_id,
      table_no,
      'Table ' || table_no,
      '/r/' || restaurant_slug || '/order?table=' || table_no,
      true
    )
    on conflict (restaurant_id, table_number)
    do update set
      label = excluded.label,
      qr_path = excluded.qr_path,
      active = true,
      updated_at = now();
  end loop;

  update public.restaurant_tables
  set active = false,
      updated_at = now()
  where restaurant_id = target_restaurant_id
    and table_number > bounded_total;

  return query
  select *
  from public.restaurant_tables
  where restaurant_id = target_restaurant_id
    and active = true
  order by table_number;
end;
$$;

revoke all on function public.sync_restaurant_tables(uuid, integer) from public, anon;
grant execute on function public.sync_restaurant_tables(uuid, integer) to authenticated;

insert into public.restaurant_tables (restaurant_id, table_number, label, qr_path, active)
select
  restaurants.id,
  table_no,
  'Table ' || table_no,
  '/r/' || restaurants.slug || '/order?table=' || table_no,
  true
from public.restaurants
cross join lateral generate_series(1, restaurants.total_tables) as table_no
on conflict (restaurant_id, table_number) do nothing;

create or replace function public.update_restaurant_configuration(
  target_restaurant_id uuid,
  restaurant_name text,
  requested_total_tables integer,
  profile_payload jsonb,
  business_hours_payload jsonb,
  ordering_settings_payload jsonb,
  branding_payload jsonb,
  notification_settings_payload jsonb,
  security_settings_payload jsonb
)
returns public.restaurants
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_restaurant public.restaurants;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update settings.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may update settings.';
  end if;

  if restaurant_name is null or length(trim(restaurant_name)) < 2 then
    raise exception 'Restaurant name must be at least 2 characters.';
  end if;

  update public.restaurants
  set
    name = trim(restaurant_name),
    profile = coalesce(profile_payload, '{}'::jsonb),
    business_hours = coalesce(business_hours_payload, '{}'::jsonb),
    ordering_settings = coalesce(ordering_settings_payload, '{}'::jsonb),
    branding = coalesce(branding_payload, '{}'::jsonb),
    notification_settings = coalesce(notification_settings_payload, '{}'::jsonb),
    security_settings = coalesce(security_settings_payload, '{}'::jsonb)
  where id = target_restaurant_id
  returning * into updated_restaurant;

  if updated_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  perform public.sync_restaurant_tables(target_restaurant_id, requested_total_tables);

  select * into updated_restaurant
  from public.restaurants
  where id = target_restaurant_id;

  return updated_restaurant;
end;
$$;

revoke all on function public.update_restaurant_configuration(uuid, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_restaurant_configuration(uuid, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.get_owner_reporting_center(
  target_restaurant_id uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  report jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view reports.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may view reports.';
  end if;

  with scoped_orders as (
    select *
    from public.orders
    where restaurant_id = target_restaurant_id
      and created_at >= range_start
      and created_at < range_end
  ),
  revenue_orders as (
    select *
    from scoped_orders
    where payment_verified_at is not null
       or status::text in ('paid', 'preparing', 'ready', 'completed')
  ),
  item_rows as (
    select
      oi.menu_item_id,
      coalesce(mi.name, 'Menu item') as name,
      coalesce(c.name, 'Uncategorized') as category_name,
      oi.quantity,
      oi.price,
      oi.quantity * oi.price as line_total
    from public.order_items oi
    join scoped_orders o on o.id = oi.order_id and o.restaurant_id = oi.restaurant_id
    left join public.menu_items mi on mi.id = oi.menu_item_id and mi.restaurant_id = oi.restaurant_id
    left join public.categories c on c.id = mi.category_id and c.restaurant_id = mi.restaurant_id
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'revenue', coalesce((select sum(total_price) from revenue_orders), 0),
      'orders', (select count(*) from scoped_orders),
      'average_order_value', coalesce((select avg(total_price) from revenue_orders), 0),
      'completed_orders', (select count(*) from scoped_orders where status::text = 'completed'),
      'cancelled_orders', (select count(*) from scoped_orders where status::text = 'cancelled'),
      'unique_customers', (select count(distinct nullif(customer_name, '')) from scoped_orders)
    ),
    'sales_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', day::date, 'revenue', revenue, 'orders', orders) order by day)
      from (
        select date_trunc('day', created_at) as day, sum(total_price) as revenue, count(*) as orders
        from revenue_orders
        group by 1
      ) daily
    ), '[]'::jsonb),
    'orders_by_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', status::text, 'orders', count) order by status)
      from (
        select status, count(*) as count
        from scoped_orders
        group by status
      ) statuses
    ), '[]'::jsonb),
    'menu_performance', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'category', category_name, 'quantity', quantity, 'revenue', revenue) order by revenue desc)
      from (
        select name, category_name, sum(quantity) as quantity, sum(line_total) as revenue
        from item_rows
        group by name, category_name
        order by revenue desc
        limit 25
      ) menu
    ), '[]'::jsonb),
    'staff_performance', coalesce((
      select jsonb_agg(jsonb_build_object('name', display_name, 'role', role, 'orders_completed', orders_completed, 'payments_verified', payments_verified) order by orders_completed desc, payments_verified desc)
      from (
        select
          rs.display_name,
          rs.role::text as role,
          count(o.id) filter (where o.completed_by = rs.id) as orders_completed,
          count(o.id) filter (where o.payment_verified_by = rs.id) as payments_verified
        from public.restaurant_staff rs
        left join scoped_orders o on o.restaurant_id = rs.restaurant_id
        where rs.restaurant_id = target_restaurant_id
        group by rs.id, rs.display_name, rs.role
      ) staff
    ), '[]'::jsonb),
    'table_usage', coalesce((
      select jsonb_agg(jsonb_build_object('table_number', table_number, 'orders', orders, 'revenue', revenue) order by table_number)
      from (
        select
          rt.table_number,
          count(o.id) as orders,
          coalesce(sum(o.total_price) filter (
            where o.payment_verified_at is not null
               or o.status::text in ('paid', 'preparing', 'ready', 'completed')
          ), 0) as revenue
        from public.restaurant_tables rt
        left join scoped_orders o
          on o.restaurant_id = rt.restaurant_id
         and o.table_number = rt.table_number::text
        where rt.restaurant_id = target_restaurant_id
          and rt.active = true
        group by rt.table_number
      ) tables
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object('customer_name', customer_name, 'orders', orders, 'revenue', revenue, 'last_order_at', last_order_at) order by revenue desc)
      from (
        select
          coalesce(nullif(customer_name, ''), 'Guest') as customer_name,
          count(*) as orders,
          coalesce(sum(total_price), 0) as revenue,
          max(created_at) as last_order_at
        from scoped_orders
        group by coalesce(nullif(customer_name, ''), 'Guest')
        order by revenue desc
        limit 25
      ) customers
    ), '[]'::jsonb),
    'ai_insights', jsonb_build_array(
      jsonb_build_object('title', 'Peak sales window', 'detail', 'Use the hourly order chart to staff cashier and kitchen roles around proven demand.'),
      jsonb_build_object('title', 'Menu focus', 'detail', 'Promote top revenue items and review low-performing items for photos, price, or availability.'),
      jsonb_build_object('title', 'Table coverage', 'detail', 'Tables with low QR usage may need clearer table signage or staff prompts.')
    )
  )
  into report;

  return report;
end;
$$;

revoke all on function public.get_owner_reporting_center(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_owner_reporting_center(uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.enforce_order_table_number_bounds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_table_number integer;
  configured_total integer;
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

  select r.total_tables into configured_total
  from public.restaurants r
  where r.id = new.restaurant_id;

  if configured_total is null then
    configured_total := 20;
    update public.restaurants r
    set total_tables = configured_total,
        table_count = configured_total
    where r.id = new.restaurant_id;
    perform public.sync_restaurant_tables(new.restaurant_id, configured_total);
  end if;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = new.restaurant_id
      and rt.table_number = normalized_table_number
      and rt.active = true
  ) then
    raise exception 'Invalid table number. Please select a table between 1 and %.', configured_total;
  end if;

  new.table_number := normalized_table_number::text;
  return new;
end;
$$;

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
  target_total_tables integer;
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
      and rt.active = true
  ) then
    raise exception 'Invalid table number. Please select a table between 1 and %.', coalesce(target_total_tables, 20);
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
    select id, name, slug, total_tables, branding
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
            'table_count', restaurants.total_tables,
            'total_tables', restaurants.total_tables,
            'logo_url', restaurants.branding->>'logo_url'
          )
          from target_restaurant restaurants
        ),
        'tables',
        coalesce((
          select jsonb_agg(jsonb_build_object('table_number', table_number, 'label', label, 'qr_path', qr_path) order by table_number)
          from public.restaurant_tables
          where restaurant_id = (select id from target_restaurant)
            and active = true
        ), '[]'::jsonb),
        'categories',
        coalesce((
          select jsonb_agg(jsonb_build_object('id', categories.id, 'restaurant_id', categories.restaurant_id, 'name', categories.name) order by categories.name)
          from public.categories
          where categories.restaurant_id = (select id from target_restaurant)
        ), '[]'::jsonb),
        'items',
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', menu_items.id,
            'restaurant_id', menu_items.restaurant_id,
            'category_id', menu_items.category_id,
            'name', menu_items.name,
            'description', menu_items.description,
            'price', menu_items.price,
            'image_url', menu_items.image_url,
            'available', menu_items.available
          ) order by menu_items.name)
          from public.menu_items
          where menu_items.restaurant_id = (select id from target_restaurant)
        ), '[]'::jsonb)
      )
    end;
$$;

revoke all on function public.get_public_qr_menu(text) from public;
grant execute on function public.get_public_qr_menu(text) to anon;
grant execute on function public.get_public_qr_menu(text) to authenticated;
