-- ServeFlow Phase 8.3.3: derived raw-ingredient recipe cost only.
-- No stock, deduction, menu, kitchen, order, purchasing, profit, or selling-price behavior.

alter table public.inventory_items
  add column if not exists purchase_price numeric(18,6) not null default 0
    check (purchase_price >= 0);

comment on column public.inventory_items.purchase_price is
  'Latest purchase price for one quantity of the inventory item unit; recipe costs are derived from this value.';

create or replace function public.recipe_unit_base_factor(unit_name text)
returns numeric language sql immutable strict set search_path = public as $$
  select case lower(btrim(unit_name))
    when 'kilogram' then 1000 when 'kg' then 1000
    when 'gram' then 1 when 'g' then 1
    when 'liter' then 1000 when 'litre' then 1000 when 'l' then 1000
    when 'milliliter' then 1 when 'millilitre' then 1 when 'ml' then 1
    when 'dozen' then 12
    when 'piece' then 1 when 'pieces' then 1 when 'pcs' then 1
    else null
  end
$$;

create or replace function public.recipe_unit_family(unit_name text)
returns text language sql immutable strict set search_path = public as $$
  select case lower(btrim(unit_name))
    when 'kilogram' then 'mass' when 'kg' then 'mass' when 'gram' then 'mass' when 'g' then 'mass'
    when 'liter' then 'volume' when 'litre' then 'volume' when 'l' then 'volume'
    when 'milliliter' then 'volume' when 'millilitre' then 'volume' when 'ml' then 'volume'
    when 'dozen' then 'count' when 'piece' then 'count' when 'pieces' then 'count' when 'pcs' then 'count'
    else lower(btrim(unit_name))
  end
$$;

create or replace function public.recipe_unit_conversion_ratio(from_unit text, to_unit text)
returns numeric language sql immutable strict set search_path = public as $$
  select case
    when lower(btrim(from_unit)) = lower(btrim(to_unit)) then 1::numeric
    when public.recipe_unit_family(from_unit) = public.recipe_unit_family(to_unit)
      and public.recipe_unit_base_factor(from_unit) is not null
      and public.recipe_unit_base_factor(to_unit) is not null
    then public.recipe_unit_base_factor(from_unit) / public.recipe_unit_base_factor(to_unit)
    else null
  end
$$;

create or replace function public.get_recipe_cost(target_restaurant_id uuid, target_recipe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.recipe_can_read(target_restaurant_id) then
    raise exception 'Recipe cost access denied.';
  end if;
  if not exists (
    select 1 from public.recipes recipe where recipe.id = target_recipe_id
      and recipe.restaurant_id = target_restaurant_id and recipe.deleted_at is null
  ) then raise exception 'Recipe not found.'; end if;

  with calculated as (
    select ingredient.id, ingredient.inventory_item_id, item.name inventory_item_name,
      ingredient.quantity_required, ingredient.unit_id, ingredient_unit.name unit_name,
      item.purchase_price, item_unit.name purchase_unit_name,
      public.recipe_unit_conversion_ratio(ingredient_unit.name, item_unit.name) conversion_ratio,
      case when public.recipe_unit_conversion_ratio(ingredient_unit.name, item_unit.name) is null then null
        else item.purchase_price * public.recipe_unit_conversion_ratio(ingredient_unit.name, item_unit.name) end unit_cost,
      case when public.recipe_unit_conversion_ratio(ingredient_unit.name, item_unit.name) is null then null
        else ingredient.quantity_required * item.purchase_price
          * public.recipe_unit_conversion_ratio(ingredient_unit.name, item_unit.name) end ingredient_cost
    from public.recipe_ingredients ingredient
    join public.inventory_items item on item.id = ingredient.inventory_item_id
      and item.restaurant_id = ingredient.restaurant_id
    join public.inventory_units ingredient_unit on ingredient_unit.id = ingredient.unit_id
      and ingredient_unit.restaurant_id = ingredient.restaurant_id
    left join public.inventory_units item_unit on item_unit.id = item.unit_id
      and item_unit.restaurant_id = item.restaurant_id
    where ingredient.restaurant_id = target_restaurant_id and ingredient.recipe_id = target_recipe_id
  )
  select jsonb_build_object(
    'recipe_id', target_recipe_id,
    'currency', 'ETB',
    'total_cost', coalesce(sum(ingredient_cost), 0),
    'complete', count(*) filter (where ingredient_cost is null) = 0,
    'ingredients', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'inventory_item_id', inventory_item_id, 'inventory_item_name', inventory_item_name,
      'quantity_required', quantity_required, 'unit_id', unit_id, 'unit_name', unit_name,
      'purchase_price', purchase_price, 'purchase_unit_name', purchase_unit_name,
      'unit_cost', unit_cost, 'ingredient_cost', ingredient_cost
    ) order by inventory_item_name), '[]'::jsonb)
  ) into result from calculated;
  return result;
end;
$$;

revoke all on function public.recipe_unit_base_factor(text), public.recipe_unit_family(text),
  public.recipe_unit_conversion_ratio(text,text), public.get_recipe_cost(uuid,uuid) from public, anon;
grant execute on function public.get_recipe_cost(uuid,uuid) to authenticated, service_role;
