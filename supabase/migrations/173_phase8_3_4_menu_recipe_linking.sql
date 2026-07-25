-- ServeFlow Phase 8.3.4: optional menu item to recipe relationship only.
-- No inventory deduction, stock mutation, kitchen, ordering, purchasing, profit, or report behavior.

alter table public.menu_items add column if not exists recipe_id uuid;

alter table public.menu_items
  add constraint menu_items_recipe_same_restaurant
  foreign key (restaurant_id, recipe_id)
  references public.recipes(restaurant_id, id) on delete restrict;

create index if not exists menu_items_recipe_idx
  on public.menu_items(restaurant_id, recipe_id) where recipe_id is not null;

create or replace function public.menu_recipe_can_manage(target_restaurant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_staff_role(target_restaurant_id,
    array['owner','manager']::public.restaurant_staff_role[])
$$;

create or replace function public.menu_recipe_validate_row()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.recipe_id is not null and not exists (
    select 1 from public.recipes recipe
    where recipe.id = new.recipe_id and recipe.restaurant_id = new.restaurant_id
      and recipe.status = 'active' and recipe.deleted_at is null
  ) then raise exception 'Only an active recipe from this restaurant may be linked.'; end if;
  return new;
end;
$$;

drop trigger if exists menu_recipe_validate_trigger on public.menu_items;
create trigger menu_recipe_validate_trigger before insert or update of recipe_id, restaurant_id
on public.menu_items for each row execute function public.menu_recipe_validate_row();

create or replace function public.list_active_menu_recipes(
  target_restaurant_id uuid, search_text text default null, result_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.recipe_can_read(target_restaurant_id) then raise exception 'Recipe access denied.'; end if;
  if result_limit not between 1 and 100 then raise exception 'Invalid recipe result limit.'; end if;
  select coalesce(jsonb_agg(to_jsonb(matches) order by matches.name), '[]'::jsonb) into result
  from (
    select recipe.id, recipe.recipe_code, recipe.name
    from public.recipes recipe
    where recipe.restaurant_id = target_restaurant_id and recipe.status = 'active'
      and recipe.deleted_at is null
      and (nullif(btrim(search_text), '') is null or recipe.name ilike '%' || btrim(search_text) || '%'
        or recipe.recipe_code ilike '%' || btrim(search_text) || '%')
    order by recipe.name limit result_limit
  ) matches;
  return result;
end;
$$;

create or replace function public.link_menu_item_recipe(
  target_restaurant_id uuid, target_menu_item_id uuid, target_recipe_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.menu_items;
begin
  if not public.menu_recipe_can_manage(target_restaurant_id) then
    raise exception 'Only owners and managers may link menu recipes.';
  end if;
  update public.menu_items set recipe_id = target_recipe_id
  where id = target_menu_item_id and restaurant_id = target_restaurant_id
    and archived_at is null returning * into saved;
  if saved.id is null then raise exception 'Menu item not found.'; end if;
  return to_jsonb(saved);
end;
$$;

create or replace function public.get_recipe_used_by(
  target_restaurant_id uuid, target_recipe_id uuid
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.recipe_can_read(target_restaurant_id) then raise exception 'Recipe access denied.'; end if;
  if not exists (select 1 from public.recipes recipe where recipe.id = target_recipe_id
    and recipe.restaurant_id = target_restaurant_id and recipe.deleted_at is null)
  then raise exception 'Recipe not found.'; end if;
  select jsonb_build_object('count', count(*), 'items', coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id, 'name', item.name, 'available', item.available
  ) order by item.name), '[]'::jsonb)) into result
  from public.menu_items item
  where item.restaurant_id = target_restaurant_id and item.recipe_id = target_recipe_id
    and item.archived_at is null;
  return result;
end;
$$;

revoke all on function public.menu_recipe_can_manage(uuid), public.menu_recipe_validate_row(),
  public.list_active_menu_recipes(uuid,text,integer), public.link_menu_item_recipe(uuid,uuid,uuid),
  public.get_recipe_used_by(uuid,uuid) from public, anon;
grant execute on function public.list_active_menu_recipes(uuid,text,integer),
  public.link_menu_item_recipe(uuid,uuid,uuid), public.get_recipe_used_by(uuid,uuid)
  to authenticated, service_role;

