-- Phase 2.1: expose pre-auth waiter-terminal table status as aggregate counts only.
-- No row-level table/order fields are returned to anonymous clients.

drop function if exists public.get_waiter_terminal_context(text);

create function public.get_waiter_terminal_context(
    target_restaurant_slug text
)
returns table (
    restaurant_id uuid,
    restaurant_slug text,
    restaurant_name text,
    logo_url text,
    currency_code text,
    currency_symbol text,
    locale text,
    total_tables integer,
    available_tables integer,
    occupied_tables integer,
    other_tables integer
)
language sql
stable
security definer
set search_path = public
as $$
with normalized_input as (
    select
        lower(trim(target_restaurant_slug)) as raw_value,
        regexp_replace(lower(trim(target_restaurant_slug)), '[^a-z0-9]+', '-', 'g') as slug_value
),
target_restaurant as (
    select restaurants.*
    from public.restaurants restaurants
    cross join normalized_input
    where restaurants.active = true
      and (
          restaurants.slug = normalized_input.raw_value
          or lower(trim(restaurants.name)) = normalized_input.raw_value
          or restaurants.slug = trim(both '-' from normalized_input.slug_value)
      )
    order by
        case
            when restaurants.slug = normalized_input.raw_value then 0
            when lower(trim(restaurants.name)) = normalized_input.raw_value then 1
            else 2
        end
    limit 1
),
active_tables as (
    select tables.id, tables.table_number
    from public.restaurant_tables tables
    join target_restaurant on target_restaurant.id = tables.restaurant_id
    where tables.active = true
),
occupied_tables as (
    select distinct active_tables.id
    from active_tables
    join target_restaurant on true
    join public.orders orders
      on orders.restaurant_id = target_restaurant.id
     and orders.dining_session_status = 'open'
     and orders.table_released_at is null
     and orders.status::text <> 'cancelled'
     and (
        orders.table_id = active_tables.id
        or orders.table_number = active_tables.table_number::text
     )
),
table_counts as (
    select
        count(active_tables.id)::integer as total_tables,
        count(occupied_tables.id)::integer as occupied_tables
    from active_tables
    left join occupied_tables on occupied_tables.id = active_tables.id
)
select
    target_restaurant.id,
    target_restaurant.slug,
    target_restaurant.name,
    target_restaurant.branding->>'logo_url',
    coalesce(target_restaurant.currency_code, 'ETB'),
    coalesce(target_restaurant.currency_symbol, 'Br'),
    coalesce(target_restaurant.locale, 'am-ET'),
    coalesce(table_counts.total_tables, 0),
    greatest(coalesce(table_counts.total_tables, 0) - coalesce(table_counts.occupied_tables, 0), 0),
    coalesce(table_counts.occupied_tables, 0),
    0
from target_restaurant
cross join table_counts;
$$;

revoke all on function public.get_waiter_terminal_context(text)
from public, anon, authenticated;

grant execute on function public.get_waiter_terminal_context(text)
to service_role;

grant execute on function public.get_waiter_terminal_context(text)
to anon, authenticated;

comment on function public.get_waiter_terminal_context(text) is
  'Returns safe pre-auth waiter terminal context plus aggregate active/available/occupied table counts only.';
