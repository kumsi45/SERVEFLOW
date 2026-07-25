-- ServeFlow Phase 8.3.5: ready-to-serve menu item architecture.
-- This prepares direct menu-item inventory links for a future deduction path only.
-- No inventory deduction, stock mutation, order, kitchen, purchasing, profit, or report behavior.

alter table public.menu_items add column if not exists direct_inventory_item_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_direct_inventory_item_same_restaurant') then
    alter table public.menu_items
      add constraint menu_items_direct_inventory_item_same_restaurant
      foreign key (restaurant_id, direct_inventory_item_id)
      references public.inventory_items(restaurant_id, id) on delete restrict;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_one_deduction_source') then
    alter table public.menu_items
      add constraint menu_items_one_deduction_source
      check (recipe_id is null or direct_inventory_item_id is null);
  end if;
end $$;

create index if not exists menu_items_direct_inventory_item_idx
  on public.menu_items(restaurant_id, direct_inventory_item_id)
  where direct_inventory_item_id is not null;

create or replace function public.menu_ready_to_serve_validate_row()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.direct_inventory_item_id is not null and not exists (
    select 1 from public.inventory_items item
    where item.id = new.direct_inventory_item_id
      and item.restaurant_id = new.restaurant_id
      and item.status = 'active'
      and item.active = true
  ) then raise exception 'Only an active inventory item from this restaurant may be linked directly.'; end if;
  return new;
end;
$$;

drop trigger if exists menu_ready_to_serve_validate_trigger on public.menu_items;
create trigger menu_ready_to_serve_validate_trigger
before insert or update of direct_inventory_item_id, restaurant_id
on public.menu_items for each row execute function public.menu_ready_to_serve_validate_row();

create or replace function public.list_active_direct_menu_inventory_items(
  target_restaurant_id uuid, search_text text default null, result_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.inventory_admin_has_access(target_restaurant_id) then
    raise exception 'Inventory item access denied.';
  end if;
  if result_limit not between 1 and 100 then raise exception 'Invalid inventory item result limit.'; end if;
  select coalesce(jsonb_agg(to_jsonb(matches) order by matches.name), '[]'::jsonb) into result
  from (
    select item.id, item.name, item.sku, item.barcode
    from public.inventory_items item
    where item.restaurant_id = target_restaurant_id
      and item.status = 'active'
      and item.active = true
      and (
        nullif(btrim(search_text), '') is null
        or item.name ilike '%' || btrim(search_text) || '%'
        or item.sku ilike '%' || btrim(search_text) || '%'
        or item.barcode ilike '%' || btrim(search_text) || '%'
      )
    order by item.name
    limit result_limit
  ) matches;
  return result;
end;
$$;

drop function if exists public.link_menu_item_recipe(uuid,uuid,uuid);
create or replace function public.link_menu_item_recipe(
  target_restaurant_id uuid,
  target_menu_item_id uuid,
  target_recipe_id uuid default null,
  target_direct_inventory_item_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.menu_items;
begin
  if not public.menu_recipe_can_manage(target_restaurant_id) then
    raise exception 'Only owners and managers may link menu recipes.';
  end if;
  update public.menu_items
  set recipe_id = target_recipe_id,
      direct_inventory_item_id = target_direct_inventory_item_id
  where id = target_menu_item_id and restaurant_id = target_restaurant_id
    and archived_at is null returning * into saved;
  if saved.id is null then raise exception 'Menu item not found.'; end if;
  return to_jsonb(saved);
end;
$$;

revoke all on function public.menu_ready_to_serve_validate_row(),
  public.list_active_direct_menu_inventory_items(uuid,text,integer),
  public.link_menu_item_recipe(uuid,uuid,uuid,uuid)
  from public, anon;
grant execute on function public.list_active_direct_menu_inventory_items(uuid,text,integer),
  public.link_menu_item_recipe(uuid,uuid,uuid,uuid)
  to authenticated, service_role;
