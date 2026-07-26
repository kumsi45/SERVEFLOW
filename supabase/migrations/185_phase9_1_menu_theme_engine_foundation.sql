-- Phase 9.1: one restaurant-level menu theme selector for the rendering engine.

alter table public.restaurants
  add column if not exists menu_theme text not null default 'modern';

alter table public.restaurants
  drop constraint if exists restaurants_menu_theme_check;

alter table public.restaurants
  add constraint restaurants_menu_theme_check
  check (menu_theme in ('modern', 'luxury', 'premium_grid', 'coffee'));

comment on column public.restaurants.menu_theme is
  'Rendering-only QR menu theme. It does not alter ordering or menu business behavior.';

create or replace function public.get_public_qr_menu(target_restaurant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target_restaurant as (
    select id, name, slug, total_tables, branding, ordering_settings, currency_code, currency_symbol, locale, menu_theme
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
            'cover_url', restaurants.branding->>'cover_url',
            'ordering_settings', coalesce(restaurants.ordering_settings, '{}'::jsonb),
            'currency_code', coalesce(restaurants.currency_code, 'ETB'),
            'currency_symbol', coalesce(restaurants.currency_symbol, 'Br'),
            'locale', coalesce(restaurants.locale, 'am-ET'),
            'menu_theme', coalesce(restaurants.menu_theme, 'modern')
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
          select jsonb_agg(
            jsonb_build_object(
              'id', categories.id,
              'restaurant_id', categories.restaurant_id,
              'name', categories.name,
              'description', categories.description,
              'display_order', categories.display_order,
              'hero_image_url', coalesce(nullif(btrim(categories.hero_image_url), ''), public.resolve_menu_category_hero_image(categories.name))
            )
            order by categories.display_order, categories.name
          )
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
            'ingredients', menu_items.ingredients,
            'allergens', menu_items.allergens,
            'preparation_time_minutes', menu_items.preparation_time_minutes,
            'spice_level', menu_items.spice_level,
            'dietary_tags', menu_items.dietary_tags,
            'calories', menu_items.calories,
            'protein_g', menu_items.protein_g,
            'carbohydrates_g', menu_items.carbohydrates_g,
            'fat_g', menu_items.fat_g,
            'fiber_g', menu_items.fiber_g,
            'sugar_g', menu_items.sugar_g,
            'sodium_mg', menu_items.sodium_mg,
            'price', menu_items.price,
            'image_url', menu_items.image_url,
            'category_image_url', coalesce(nullif(btrim(categories.hero_image_url), ''), public.resolve_menu_category_hero_image(categories.name)),
            'effective_image_url', coalesce(nullif(btrim(menu_items.image_url), ''), nullif(btrim(categories.hero_image_url), ''), public.resolve_menu_category_hero_image(categories.name)),
            'available', menu_items.available
          ) order by menu_items.display_order, menu_items.name)
          from public.menu_items
          join public.categories
            on categories.restaurant_id = menu_items.restaurant_id
           and categories.id = menu_items.category_id
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
