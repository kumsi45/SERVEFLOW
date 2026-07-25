-- ServeFlow Phase 8.3.2: recipe ingredient definitions only.
-- No stock mutation, deduction, costing, menu, kitchen, order, or purchasing behavior.

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  recipe_id uuid not null,
  inventory_item_id uuid not null,
  quantity_required numeric(12,3) not null check (quantity_required > 0),
  unit_id uuid not null,
  optional_notes text check (optional_notes is null or char_length(optional_notes) <= 500),
  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_ingredients_recipe_restaurant_fk foreign key (restaurant_id, recipe_id)
    references public.recipes(restaurant_id, id) on delete cascade,
  constraint recipe_ingredients_item_restaurant_fk foreign key (restaurant_id, inventory_item_id)
    references public.inventory_items(restaurant_id, id) on delete restrict,
  constraint recipe_ingredients_unit_restaurant_fk foreign key (restaurant_id, unit_id)
    references public.inventory_units(restaurant_id, id) on delete restrict,
  constraint recipe_ingredients_recipe_item_unique unique (restaurant_id, recipe_id, inventory_item_id)
);

create index if not exists recipe_ingredients_recipe_order_idx
  on public.recipe_ingredients(restaurant_id, recipe_id, sort_order, created_at);
create index if not exists recipe_ingredients_item_idx
  on public.recipe_ingredients(restaurant_id, inventory_item_id);

alter table public.recipe_ingredients enable row level security;

drop policy if exists recipe_ingredients_read on public.recipe_ingredients;
drop policy if exists recipe_ingredients_manage on public.recipe_ingredients;
create policy recipe_ingredients_read on public.recipe_ingredients for select to authenticated
  using (public.recipe_can_read(restaurant_id));
create policy recipe_ingredients_manage on public.recipe_ingredients for all to authenticated
  using (public.recipe_can_manage(restaurant_id))
  with check (public.recipe_can_manage(restaurant_id));

create or replace function public.recipe_ingredient_validate_row()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.quantity_required is null or new.quantity_required <= 0 then
    raise exception 'Ingredient quantity must be greater than zero.';
  end if;
  if not exists (
    select 1 from public.recipes recipe
    where recipe.id = new.recipe_id and recipe.restaurant_id = new.restaurant_id
      and recipe.deleted_at is null
  ) then raise exception 'Recipe is invalid for this restaurant.'; end if;
  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.inventory_item_id and item.restaurant_id = new.restaurant_id
      and item.status = 'active'
  ) then raise exception 'Only active inventory items may be ingredients.'; end if;
  if not exists (
    select 1 from public.inventory_units unit
    where unit.id = new.unit_id and unit.restaurant_id = new.restaurant_id
      and unit.status = 'active'
  ) then raise exception 'Ingredient unit is invalid for this restaurant.'; end if;
  new.optional_notes := nullif(btrim(coalesce(new.optional_notes, '')), '');
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists recipe_ingredient_validate_trigger on public.recipe_ingredients;
create trigger recipe_ingredient_validate_trigger before insert or update on public.recipe_ingredients
for each row execute function public.recipe_ingredient_validate_row();

create or replace function public.manage_recipe_ingredient(recipe_action text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_restaurant_id uuid := nullif(payload->>'restaurant_id', '')::uuid;
  target_recipe_id uuid := nullif(payload->>'recipe_id', '')::uuid;
  target_ingredient_id uuid := nullif(payload->>'ingredient_id', '')::uuid;
  saved public.recipe_ingredients;
  action text := lower(btrim(recipe_action));
begin
  if target_restaurant_id is null or not public.recipe_can_manage(target_restaurant_id) then
    raise exception 'Only owners and managers may manage recipe ingredients.';
  end if;
  if action = 'create' then
    insert into public.recipe_ingredients(
      restaurant_id, recipe_id, inventory_item_id, quantity_required, unit_id, optional_notes, sort_order
    ) values (
      target_restaurant_id, target_recipe_id, nullif(payload->>'inventory_item_id', '')::uuid,
      (payload->>'quantity_required')::numeric, nullif(payload->>'unit_id', '')::uuid,
      payload->>'optional_notes', coalesce((payload->>'sort_order')::integer, 1000)
    ) returning * into saved;
  elsif action = 'update' then
    update public.recipe_ingredients set
      inventory_item_id = nullif(payload->>'inventory_item_id', '')::uuid,
      quantity_required = (payload->>'quantity_required')::numeric,
      unit_id = nullif(payload->>'unit_id', '')::uuid,
      optional_notes = payload->>'optional_notes',
      sort_order = coalesce((payload->>'sort_order')::integer, sort_order)
    where id = target_ingredient_id and recipe_id = target_recipe_id
      and recipe_ingredients.restaurant_id = target_restaurant_id
    returning * into saved;
  elsif action = 'delete' then
    delete from public.recipe_ingredients
    where id = target_ingredient_id and recipe_id = target_recipe_id
      and recipe_ingredients.restaurant_id = target_restaurant_id
    returning * into saved;
  else raise exception 'Unsupported recipe ingredient action.'; end if;
  if saved.id is null then raise exception 'Recipe ingredient not found.'; end if;
  return to_jsonb(saved);
exception
  when unique_violation then raise exception 'This inventory item is already an ingredient in the recipe.';
  when invalid_text_representation then raise exception 'Ingredient, quantity, and unit are required.';
end;
$$;

create or replace function public.duplicate_recipe_with_ingredients(
  target_restaurant_id uuid, target_recipe_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare duplicated jsonb; duplicated_id uuid;
begin
  if not public.recipe_can_manage(target_restaurant_id) then
    raise exception 'Only owners and managers may duplicate recipes.';
  end if;
  duplicated := public.manage_recipe('duplicate', jsonb_build_object(
    'restaurant_id', target_restaurant_id, 'recipe_id', target_recipe_id
  ));
  duplicated_id := (duplicated->>'id')::uuid;
  insert into public.recipe_ingredients(
    restaurant_id, recipe_id, inventory_item_id, quantity_required, unit_id,
    optional_notes, sort_order
  )
  select restaurant_id, duplicated_id, inventory_item_id, quantity_required, unit_id,
    optional_notes, sort_order
  from public.recipe_ingredients
  where restaurant_id = target_restaurant_id and recipe_id = target_recipe_id;
  return duplicated;
end;
$$;

revoke all on public.recipe_ingredients from public, anon;
grant select, insert, update, delete on public.recipe_ingredients to authenticated;
revoke all on function public.recipe_ingredient_validate_row(),
  public.manage_recipe_ingredient(text,jsonb), public.duplicate_recipe_with_ingredients(uuid,uuid)
  from public, anon;
grant execute on function public.manage_recipe_ingredient(text,jsonb),
  public.duplicate_recipe_with_ingredients(uuid,uuid) to authenticated, service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'recipe_ingredients')
  then alter publication supabase_realtime add table public.recipe_ingredients; end if;
end $$;

