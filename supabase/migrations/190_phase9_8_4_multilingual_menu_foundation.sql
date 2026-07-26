-- Phase 9.8.4: multilingual presentation foundation only.
-- This migration creates no translations, menu items, recipes, inventory,
-- orders, payments, QR controls, or publishing behavior.

create table if not exists public.menu_item_localizations (
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  language text not null check (language in ('en', 'om', 'am')),
  name text,
  description text,
  name_origin text check (name_origin in ('source', 'owner', 'ai_translation')),
  description_origin text check (description_origin in ('source', 'owner', 'ai_translation')),
  name_owner_edited boolean not null default false,
  description_owner_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (menu_item_id, language),
  check (name is not null or description is not null),
  check (not name_owner_edited or name is not null),
  check (not description_owner_edited or description is not null)
);

comment on table public.menu_item_localizations is
  'Optional localized presentation for one canonical menu item. Price, recipe, inventory, and availability remain on the canonical item.';
comment on column public.menu_item_localizations.name_owner_edited is
  'Future translation services must never overwrite a true owner-edited field.';
comment on column public.menu_item_localizations.description_owner_edited is
  'Future translation services must never overwrite a true owner-edited field.';

create table if not exists public.menu_category_localizations (
  category_id uuid not null references public.categories(id) on delete cascade,
  language text not null check (language in ('en', 'om', 'am')),
  name text,
  description text,
  name_origin text check (name_origin in ('source', 'owner', 'ai_translation')),
  description_origin text check (description_origin in ('source', 'owner', 'ai_translation')),
  name_owner_edited boolean not null default false,
  description_owner_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (category_id, language),
  check (name is not null or description is not null),
  check (not name_owner_edited or name is not null),
  check (not description_owner_edited or description is not null)
);

comment on table public.menu_category_localizations is
  'Optional localized presentation for one canonical menu category.';

drop trigger if exists menu_item_localizations_set_updated_at
  on public.menu_item_localizations;
create trigger menu_item_localizations_set_updated_at
before update on public.menu_item_localizations
for each row execute function public.set_updated_at();

drop trigger if exists menu_category_localizations_set_updated_at
  on public.menu_category_localizations;
create trigger menu_category_localizations_set_updated_at
before update on public.menu_category_localizations
for each row execute function public.set_updated_at();

alter table public.menu_item_localizations enable row level security;
alter table public.menu_category_localizations enable row level security;

drop policy if exists menu_item_localizations_staff_select
  on public.menu_item_localizations;
create policy menu_item_localizations_staff_select
on public.menu_item_localizations
for select
to authenticated
using (
  exists (
    select 1
    from public.menu_items
    where menu_items.id = menu_item_localizations.menu_item_id
      and public.has_staff_role(
        menu_items.restaurant_id,
        array['owner', 'manager']::public.restaurant_staff_role[]
      )
  )
);

drop policy if exists menu_category_localizations_staff_select
  on public.menu_category_localizations;
create policy menu_category_localizations_staff_select
on public.menu_category_localizations
for select
to authenticated
using (
  exists (
    select 1
    from public.categories
    where categories.id = menu_category_localizations.category_id
      and public.has_staff_role(
        categories.restaurant_id,
        array['owner', 'manager']::public.restaurant_staff_role[]
      )
  )
);

revoke all on public.menu_item_localizations from public, anon, authenticated;
revoke all on public.menu_category_localizations from public, anon, authenticated;
grant select on public.menu_item_localizations to authenticated;
grant select on public.menu_category_localizations to authenticated;

-- Keep the existing public QR contract and add optional localization maps.
-- No language is selected in SQL; presentation resolves the requested
-- language through one shared client resolver and falls back to source text.
create or replace function public.get_public_qr_menu(target_restaurant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target_restaurant as (
    select id, name, slug, total_tables, branding, ordering_settings,
           currency_code, currency_symbol, locale
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
            'locale', coalesce(restaurants.locale, 'am-ET')
          )
          from target_restaurant restaurants
        ),
        'tables',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'table_number', table_number,
              'label', label,
              'qr_path', qr_path
            )
            order by table_number
          )
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
              'hero_image_url', coalesce(
                nullif(btrim(categories.hero_image_url), ''),
                public.resolve_menu_category_hero_image(categories.name)
              ),
              'localizations', coalesce((
                select jsonb_object_agg(
                  localization.language,
                  jsonb_build_object(
                    'name', localization.name,
                    'description', localization.description
                  )
                )
                from public.menu_category_localizations localization
                where localization.category_id = categories.id
              ), '{}'::jsonb)
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
          select jsonb_agg(
            jsonb_build_object(
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
              'category_image_url', coalesce(
                nullif(btrim(categories.hero_image_url), ''),
                public.resolve_menu_category_hero_image(categories.name)
              ),
              'effective_image_url', coalesce(
                nullif(btrim(menu_items.image_url), ''),
                nullif(btrim(categories.hero_image_url), ''),
                public.resolve_menu_category_hero_image(categories.name)
              ),
              'available', menu_items.available,
              'localizations', coalesce((
                select jsonb_object_agg(
                  localization.language,
                  jsonb_build_object(
                    'name', localization.name,
                    'description', localization.description
                  )
                )
                from public.menu_item_localizations localization
                where localization.menu_item_id = menu_items.id
              ), '{}'::jsonb)
            )
            order by menu_items.display_order, menu_items.name
          )
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

