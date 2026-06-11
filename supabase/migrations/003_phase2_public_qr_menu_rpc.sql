-- SERVEFLOW Phase 2 public QR menu access.
-- This does not change or weaken existing Phase 1 RLS policies.
-- Public reads are limited to a single restaurant resolved by slug.

create or replace function public.get_public_qr_menu(target_restaurant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target_restaurant as (
    select id, name, slug
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
