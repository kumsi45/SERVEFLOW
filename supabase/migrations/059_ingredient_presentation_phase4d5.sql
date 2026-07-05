-- SERVEFLOW Phase 4D.5 Professional Ingredient Presentation.
-- Ingredients remain stored as text arrays for future filtering. No ordering or kitchen changes.

alter table public.menu_items
  add column if not exists ingredients text[];

alter table public.restaurant_starter_template_items
  add column if not exists ingredients text[];

create or replace function public.clean_menu_text_array(input_values text[])
returns text[]
language sql
immutable
as $$
  with cleaned as (
    select btrim(value) as value, min(ordinality) as first_position
    from unnest(coalesce(input_values, '{}'::text[])) with ordinality as entries(value, ordinality)
    where nullif(btrim(value), '') is not null
    group by btrim(value)
  )
  select nullif(array_agg(value order by first_position), '{}'::text[])
  from cleaned;
$$;

create or replace function public.text_array_has_blank_entry(input_values text[])
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from unnest(coalesce(input_values, '{}'::text[])) as entries(value)
    where nullif(btrim(value), '') is null
  );
$$;

revoke all on function public.clean_menu_text_array(text[]) from public, anon, authenticated;
revoke all on function public.text_array_has_blank_entry(text[]) from public, anon, authenticated;
grant execute on function public.text_array_has_blank_entry(text[]) to authenticated;

update public.menu_items
set ingredients = public.clean_menu_text_array(ingredients)
where ingredients is not null;

update public.restaurant_starter_template_items
set ingredients = public.clean_menu_text_array(ingredients)
where ingredients is not null;

alter table public.menu_items
  drop constraint if exists menu_items_ingredients_individual_entries,
  add constraint menu_items_ingredients_individual_entries
    check (
      ingredients is null
      or (
        cardinality(ingredients) > 0
        and not public.text_array_has_blank_entry(ingredients)
      )
    );

alter table public.restaurant_starter_template_items
  drop constraint if exists restaurant_starter_template_items_ingredients_individual_entries,
  add constraint restaurant_starter_template_items_ingredients_individual_entries
    check (
      ingredients is null
      or (
        cardinality(ingredients) > 0
        and not public.text_array_has_blank_entry(ingredients)
      )
    );

create index if not exists menu_items_ingredients_gin_idx
on public.menu_items using gin (ingredients);

create index if not exists restaurant_starter_template_items_ingredients_gin_idx
on public.restaurant_starter_template_items using gin (ingredients);

comment on column public.menu_items.ingredients is 'Individual ingredient names stored as text[] for professional display and future filtering.';
comment on column public.restaurant_starter_template_items.ingredients is 'Individual starter-template ingredient names stored as text[] for professional display and future filtering.';
