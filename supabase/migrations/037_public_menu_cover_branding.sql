-- Keep public menu branding on the restaurants.branding object for both logo and cover.

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
            'logo_url', restaurants.branding->>'logo_url',
            'cover_url', restaurants.branding->>'cover_url'
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
            and exists (
              select 1
              from public.menu_items
              where menu_items.restaurant_id = categories.restaurant_id
                and menu_items.category_id = categories.id
                and menu_items.available = true
                and menu_items.archived_at is null
            )
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
            and menu_items.available = true
            and menu_items.archived_at is null
        ), '[]'::jsonb)
      )
    end;
$$;

revoke all on function public.get_public_qr_menu(text) from public;
grant execute on function public.get_public_qr_menu(text) to anon;
grant execute on function public.get_public_qr_menu(text) to authenticated;
